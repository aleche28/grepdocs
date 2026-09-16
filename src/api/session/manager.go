package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"grepdocs/api/models"
	"io"
	"log"
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
	gcInterval         time.Duration
	idleExpiration     time.Duration
	absoluteExpiration time.Duration
	cookieName         string
	secureCookie       bool
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
	secureCookie bool,
) *SessionManager {
	m := &SessionManager{
		store:              store,
		gcInterval:         gcInterval,
		idleExpiration:     idleExpiration,
		absoluteExpiration: absoluteExpiration,
		cookieName:         cookieName,
		secureCookie:       secureCookie,
		sessionKey:         sessionContextKey{},
	}

	// start the periodic goroutine for garbage collection, if needed
	if m.store.NeedsGC() {
		go m.gc(context.Background(), m.gcInterval)
	}

	return m
}

func (m *SessionManager) isValid(ctx context.Context, session *models.Session) bool {
	if session == nil {
		return false
	}
	return time.Since(session.CreatedAt) <= m.absoluteExpiration &&
		time.Since(session.LastActivityAt) <= m.idleExpiration
}

func (m *SessionManager) destroyExpiredIfNeeded(ctx context.Context, session *models.Session) {
	if session != nil && !m.isValid(ctx, session) {
		if err := m.store.Destroy(ctx, session.Id); err != nil {
			log.Printf("Failed to destroy expired session: %v\n", err)
		}
	}
}

func (m *SessionManager) start(ctx context.Context, r *http.Request) (*models.Session, *http.Request) {
	var session *models.Session

	cookie, err := r.Cookie(m.cookieName)
	if err == nil {
		session, err = m.store.Read(ctx, cookie.Value)
		if err != nil {
			log.Printf("Failed to read session from store: %v\n", err)
		}
	}

	if session == nil || !m.isValid(ctx, session) {
		m.destroyExpiredIfNeeded(ctx, session)
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

	if err := m.store.Write(ctx, session); err != nil {
		return err
	}

	return nil
}

// Regenerate regenerates session id, preventing session fixation
func (m *SessionManager) Regenerate(ctx context.Context, session *models.Session) error {
	if err := m.store.Destroy(ctx, session.Id); err != nil {
		return fmt.Errorf("failed to destroy old session: %w", err)
	}

	session.Id = generateSessionId()
	session.CreatedAt = time.Now()
	session.LastActivityAt = time.Now()

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

		if err := m.save(rws.Context(), session); err != nil {
			log.Printf("Failed to save session: %v\n", err)
		}

		// write the session cookie to the response if not already written
		writeCookieIfNecessary(sw)
	})
}

func (m *SessionManager) GetSession(r *http.Request) (*models.Session, bool) {
	session, ok := r.Context().Value(m.sessionKey).(*models.Session)
	if !ok {
		return nil, false
	}

	return session, true
}

// GetSession retrieves the session from the request context.
func GetSession(sm *SessionManager, r *http.Request) (*models.Session, bool) {
	return sm.GetSession(r)
}

// Destroy invalidates the session in the store
func (m *SessionManager) Destroy(ctx context.Context, session *models.Session) {
	m.store.Destroy(ctx, session.Id)
}

// ClearCookie returns a cookie that immediately expires, removing the session cookie from the browser
func (m *SessionManager) ClearCookie() *http.Cookie {
	return &http.Cookie{
		Name:     m.cookieName,
		Value:    "",
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	}
}

func generateSessionId() string {
	id := make([]byte, 32)

	_, err := io.ReadFull(rand.Reader, id)
	if err != nil {
		panic("Failed to generate session id")
	}

	return base64.RawURLEncoding.EncodeToString(id)
}
