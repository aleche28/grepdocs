package session

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"grepdocs/api/models"
)

type fakeStore struct {
	mu       sync.Mutex
	sessions map[string]*models.Session
	writes   int
	destroys int
	needsGC  bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{sessions: make(map[string]*models.Session)}
}

func (s *fakeStore) Read(_ context.Context, id string) (*models.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id], nil
}

func (s *fakeStore) Write(_ context.Context, session *models.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.Id] = session
	s.writes++
	return nil
}

func (s *fakeStore) Destroy(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
	s.destroys++
	return nil
}

func (s *fakeStore) Gc(context.Context, time.Duration, time.Duration) error { return nil }

func (s *fakeStore) NeedsGC() bool { return s.needsGC }

func (s *fakeStore) has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.sessions[id]
	return ok
}

func (s *fakeStore) destroyCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.destroys
}

func newTestManager(store SessionStore) *SessionManager {
	return NewSessionManager(store, time.Hour, time.Hour, 12*time.Hour, "session", false)
}

func sessionCookie(t *testing.T, rr *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rr.Result().Cookies() {
		if c.Name == "session" {
			return c
		}
	}
	t.Fatal("no session cookie in response")
	return nil
}

func TestNewSession(t *testing.T) {
	s := newSession()

	if s.Id == "" {
		t.Error("Id is empty")
	}
	if s.Data == nil {
		t.Error("Data is nil")
	}
	if s.CreatedAt.IsZero() || s.LastActivityAt.IsZero() {
		t.Error("timestamps are zero")
	}
}

func TestGenerateSessionIdIsUnique(t *testing.T) {
	if generateSessionId() == generateSessionId() {
		t.Fatal("generateSessionId returned duplicate ids")
	}
}

func TestHandleCreatesSessionAndCookie(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	var captured *models.Session
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = sm.GetSession(r)
		w.Write([]byte("ok"))
	})

	rr := httptest.NewRecorder()
	sm.Handle(next).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))

	if captured == nil {
		t.Fatal("no session attached to request context")
	}
	if captured.Id == "" {
		t.Error("session Id is empty")
	}
	if !store.has(captured.Id) {
		t.Error("session was not persisted to the store")
	}

	cookie := sessionCookie(t, rr)
	if cookie.Value != captured.Id {
		t.Errorf("cookie value = %q, want %q", cookie.Value, captured.Id)
	}
	if !cookie.HttpOnly {
		t.Error("cookie is not HttpOnly")
	}
	if cookie.Path != "/" {
		t.Errorf("cookie Path = %q, want /", cookie.Path)
	}
}

func TestHandleLoadsExistingSession(t *testing.T) {
	store := newFakeStore()
	existing := &models.Session{
		Id:             "existing-id",
		Data:           map[string]any{},
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
		UserID:         42,
		Authenticated:  true,
	}
	store.sessions[existing.Id] = existing

	sm := newTestManager(store)

	var captured *models.Session
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = sm.GetSession(r)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: existing.Id})

	sm.Handle(next).ServeHTTP(httptest.NewRecorder(), req)

	if captured == nil {
		t.Fatal("no session attached to request context")
	}
	if captured.Id != existing.Id {
		t.Errorf("session Id = %q, want %q", captured.Id, existing.Id)
	}
	if captured.GetUserID() != 42 {
		t.Errorf("UserID = %d, want 42", captured.GetUserID())
	}
}

func TestHandleReplacesExpiredSession(t *testing.T) {
	tests := []struct {
		name       string
		createdAt  time.Time
		lastActive time.Time
	}{
		{name: "idle expired", createdAt: time.Now(), lastActive: time.Now().Add(-2 * time.Hour)},
		{name: "absolute expired", createdAt: time.Now().Add(-13 * time.Hour), lastActive: time.Now()},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			expired := &models.Session{
				Id:             "expired-id",
				Data:           map[string]any{},
				CreatedAt:      tc.createdAt,
				LastActivityAt: tc.lastActive,
				UserID:         42,
				Authenticated:  true,
			}
			store.sessions[expired.Id] = expired

			sm := newTestManager(store)

			var captured *models.Session
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				captured, _ = sm.GetSession(r)
			})

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.AddCookie(&http.Cookie{Name: "session", Value: expired.Id})

			sm.Handle(next).ServeHTTP(httptest.NewRecorder(), req)

			if captured == nil {
				t.Fatal("no session attached to request context")
			}
			if captured.Id == expired.Id {
				t.Error("expired session was reused")
			}
			if captured.IsAuthenticated() {
				t.Error("new session should not be authenticated")
			}
			if store.destroyCount() == 0 {
				t.Error("expired session was not destroyed")
			}
			if store.has(expired.Id) {
				t.Error("expired session still present in store")
			}
		})
	}
}

func TestHandleWritesCookieBeforeBody(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		w.Write([]byte("body"))
	})

	rr := httptest.NewRecorder()
	sm.Handle(next).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))

	sessionCookie(t, rr)
}

func TestRegenerate(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	s := newSession()
	if err := store.Write(context.Background(), s); err != nil {
		t.Fatalf("seed store: %v", err)
	}
	oldID := s.Id

	if err := sm.Regenerate(context.Background(), s); err != nil {
		t.Fatalf("Regenerate: %v", err)
	}

	if s.Id == oldID {
		t.Error("Regenerate did not change the session id")
	}
	if store.has(oldID) {
		t.Error("old session still present in store")
	}
	if store.destroyCount() == 0 {
		t.Error("old session was not destroyed")
	}
}

func TestSaveUpdatesLastActivityAndPersists(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	s := newSession()
	s.LastActivityAt = time.Now().Add(-time.Minute)

	if err := sm.save(context.Background(), s); err != nil {
		t.Fatalf("save: %v", err)
	}

	if time.Since(s.LastActivityAt) > time.Second {
		t.Error("save did not refresh LastActivityAt")
	}
	if !store.has(s.Id) {
		t.Error("save did not persist the session")
	}
}

func TestGetSession(t *testing.T) {
	sm := newTestManager(newFakeStore())

	if _, ok := sm.GetSession(httptest.NewRequest(http.MethodGet, "/", nil)); ok {
		t.Error("GetSession on a bare request returned a session")
	}
}

func TestDestroy(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	s := newSession()
	store.sessions[s.Id] = s

	sm.Destroy(context.Background(), s)

	if store.has(s.Id) {
		t.Error("Destroy left the session in the store")
	}
}

func TestClearCookie(t *testing.T) {
	sm := newTestManager(newFakeStore())

	c := sm.ClearCookie()
	if c.Name != "session" {
		t.Errorf("Name = %q, want session", c.Name)
	}
	if c.Value != "" {
		t.Errorf("Value = %q, want empty", c.Value)
	}
	if c.MaxAge != -1 {
		t.Errorf("MaxAge = %d, want -1", c.MaxAge)
	}
	if !c.HttpOnly {
		t.Error("cookie is not HttpOnly")
	}
}
