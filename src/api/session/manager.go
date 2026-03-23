package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"grepdocs/api/models"
	"io"
	"net/http"
	"time"
)

type SessionStore interface {
	Read(ctx context.Context, id string) (*models.Session, error)
	Write(ctx context.Context, session *models.Session) error
	Destroy(ctx context.Context, id string) error
	Gc(ctx context.Context, idleExpiration, absoluteExpiration time.Duration) error
	NeedsGC() bool
}

type sessionContextKey struct{}

type SessionManager struct {
	store              SessionStore
	idleExpiration     time.Duration
	absoluteExpiration time.Duration
	cookieName         string
	sessionKey         sessionContextKey
}

func newSession() *models.Session {
	return &models.Session{
		Id:             generateSessionId(),
		Data:           make(map[string]any),
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
}

func NewSessionManager(
	store SessionStore,
	gcInterval time.Duration,
	idleExpiration time.Duration,
	absoluteExpiration time.Duration,
	cookieName string,
) *SessionManager {

	m := &SessionManager{
		store:              store,
		idleExpiration:     idleExpiration,
		absoluteExpiration: absoluteExpiration,
		cookieName:         cookieName,
		sessionKey:         sessionContextKey{},
	}

	// start the periodic goroutine for garbage collection, if needed
	if m.store.NeedsGC() {
		go m.gc(context.Background(), gcInterval)
	}

	return m
}

func (m *SessionManager) validate(ctx context.Context, session *models.Session) bool {
	if time.Since(session.CreatedAt) > m.absoluteExpiration ||
		time.Since(session.LastActivityAt) > m.idleExpiration {

		err := m.store.Destroy(ctx, session.Id)
		if err != nil {
			panic(err)
		}

		return false
	}

	return true
}

func (m *SessionManager) start(ctx context.Context, r *http.Request) (*models.Session, *http.Request) {
	var session *models.Session

	cookie, err := r.Cookie(m.cookieName)
	if err == nil {
		session, err = m.store.Read(ctx, cookie.Value)
		if err != nil {
			fmt.Errorf("Failed to read session from store: %v", err)
		}
	}

	if session == nil || !m.validate(ctx, session) {
		// no existing session: create it
		session = newSession()
	}

	// attach to context
	cws := context.WithValue(r.Context(), m.sessionKey, session)
	r = r.WithContext(cws)

	return session, r
}

func (m *SessionManager) save(ctx context.Context, session *models.Session) error {
	session.LastActivityAt = time.Now()

	err := m.store.Write(ctx, session)
	if err != nil {
		return err
	}

	return nil
}

// migrate regenerates session id, preventing session fixation
func (m *SessionManager) Migrate(ctx context.Context, session *models.Session) error {
	// TODO: add mutex to session if necessary

	err := m.store.Destroy(ctx, session.Id)
	if err != nil {
		return err
	}

	session.Id = generateSessionId()

	return nil
}

func (m *SessionManager) gc(ctx context.Context, period time.Duration) {
	ticker := time.NewTicker(period)

	for range ticker.C {
		m.store.Gc(ctx, m.idleExpiration, m.absoluteExpiration)
	}
}

func (m *SessionManager) Handle(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// start session and create new request with session
		session, rws := m.start(r.Context(), r)

		// create a new response writer: basically used as a wrapper
		// for a normal writer, but ensuring that the session cookie
		// is written BEFORE any body or status code
		sw := &sessionResponseWriter{
			ResponseWriter: w,
			sessionMgr:     m,
			request:        rws,
		}

		// ensures that caches, such as CDN or browser caches, differentiate
		// responses based on the presence or value of the Cookie header
		w.Header().Add("Vary", "Cookie")

		// instructs caches not to store responses that include the Set-Cookie header
		w.Header().Add("Cache-Control", `no-cache="Set-Cookie"`)

		// call next handler passing NEW response writer and request
		next.ServeHTTP(sw, rws)

		m.save(rws.Context(), session)

		// write the session cookie to the response if not already written
		writeCookieIfNecessary(sw)
	})
}

func GetSession(sm *SessionManager, r *http.Request) *models.Session {
	session, ok := r.Context().Value(sm.sessionKey).(*models.Session)
	if !ok {
		panic("Session not found in request context")
	}

	return session
}

func generateSessionId() string {
	id := make([]byte, 32)

	_, err := io.ReadFull(rand.Reader, id)
	if err != nil {
		panic("Failed to generate session id")
	}

	return base64.RawURLEncoding.EncodeToString(id)
}
