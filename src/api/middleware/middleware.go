package middleware

import (
	"context"
	"grepdocs/api/session"
	"net/http"
)

type ctxKey int

const uidKey ctxKey = iota

func RequireAuth(sm *session.SessionManager) func(http.Handler) http.Handler {
	// wrap closure with session manager, so that the middleware can access it
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sess, ok := session.GetSession(sm, r)
			if !ok || !sess.IsAuthenticated() {
				http.Error(w, "Not authenticated", http.StatusUnauthorized)
				return
			}

			// store userId in context
			ctx := context.WithValue(r.Context(), uidKey, sess.GetUserId())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func CurrentUserId(r *http.Request) (int64, bool) {
	v := r.Context().Value(uidKey)
	if id, ok := v.(int64); ok {
		return id, ok
	}
	return 0, false
}
