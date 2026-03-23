package session

import (
	"grepdocs/api/models"
	"net/http"
	"time"
)

type sessionResponseWriter struct {
	http.ResponseWriter
	sessionMgr *SessionManager
	request    *http.Request
	done       bool
}

func (w *sessionResponseWriter) Write(b []byte) (int, error) {
	writeCookieIfNecessary(w)

	return w.ResponseWriter.Write(b)
}

func (w *sessionResponseWriter) WriteHeader(code int) {
	writeCookieIfNecessary(w)

	w.ResponseWriter.WriteHeader(code)
}

func (w *sessionResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func writeCookieIfNecessary(w *sessionResponseWriter) {
	if w.done {
		return
	}

	session, ok := w.request.Context().Value(w.sessionMgr.sessionKey).(*models.Session)
	if !ok {
		panic("session not found in request context")
	}

	cookie := &http.Cookie{
		Name:     w.sessionMgr.cookieName,
		Value:    session.Id,
		Domain:   "localhost",
		HttpOnly: true,
		Path:     "/",
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(w.sessionMgr.idleExpiration),
		MaxAge:   int(w.sessionMgr.idleExpiration / time.Second),
	}

	http.SetCookie(w.ResponseWriter, cookie)

	w.done = true
}
