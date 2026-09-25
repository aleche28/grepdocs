package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"grepdocs/api/models"
	"grepdocs/api/session"
)

type fakeStore struct {
	sessions map[string]*models.Session
}

func newFakeStore() *fakeStore {
	return &fakeStore{sessions: make(map[string]*models.Session)}
}

func (s *fakeStore) Read(_ context.Context, id string) (*models.Session, error) {
	return s.sessions[id], nil
}

func (s *fakeStore) Write(_ context.Context, sess *models.Session) error {
	s.sessions[sess.Id] = sess
	return nil
}

func (s *fakeStore) Destroy(_ context.Context, id string) error {
	delete(s.sessions, id)
	return nil
}

func (s *fakeStore) Gc(context.Context, time.Duration, time.Duration) error { return nil }

func (s *fakeStore) NeedsGC() bool { return false }

func newTestManager(store session.SessionStore) *session.SessionManager {
	return session.NewSessionManager(store, time.Hour, time.Hour, 12*time.Hour, "session", false)
}

func TestRequireAuthRejectsUnauthenticated(t *testing.T) {
	store := newFakeStore()
	sm := newTestManager(store)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	rr := httptest.NewRecorder()
	sm.Handle(RequireAuth(sm)(next)).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))

	if called {
		t.Error("protected handler ran for an unauthenticated request")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuthAllowsAuthenticated(t *testing.T) {
	store := newFakeStore()
	sess := &models.Session{
		Id:             "sess-1",
		Data:           map[string]any{},
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
	sess.SetUserID(7)
	store.sessions[sess.Id] = sess

	sm := newTestManager(store)

	var gotID int64
	var gotOK bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID, gotOK = CurrentUserID(r)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.Id})

	rr := httptest.NewRecorder()
	sm.Handle(RequireAuth(sm)(next)).ServeHTTP(rr, req)

	if !gotOK {
		t.Fatal("CurrentUserID not present in context")
	}
	if gotID != 7 {
		t.Errorf("CurrentUserID = %d, want 7", gotID)
	}
}

func TestCurrentUserIDMissing(t *testing.T) {
	if _, ok := CurrentUserID(httptest.NewRequest(http.MethodGet, "/", nil)); ok {
		t.Error("CurrentUserID returned ok on a bare request")
	}
}
