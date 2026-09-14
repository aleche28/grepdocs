package routers

import (
	"context"
	"grepdocs/api/dal"
	"grepdocs/api/middleware"
	"grepdocs/api/session"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserHandler struct {
	dbPool     *pgxpool.Pool
	sessionMgr *session.SessionManager
}

// UserRoutes initializes the user management routes
func UserRoutes(pool *pgxpool.Pool, sm *session.SessionManager) chi.Router {
	h := &UserHandler{
		dbPool:     pool,
		sessionMgr: sm,
	}

	r := chi.NewRouter()

	// All routes require authentication
	r.Use(middleware.RequireAuth(sm))

	r.Get("/me", h.getAuthenticatedUser)

	return r
}

// getAuthenticatedUser returns the currently authenticated user
func (h *UserHandler) getAuthenticatedUser(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	ctx := context.Background()
	q := dal.New(h.dbPool)

	user, err := q.GetUserById(ctx, uid)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"id":         user.ID,
		"fullname":   user.Fullname,
		"username":   user.Username,
		"email":      user.Email,
		"created_at": user.CreatedAt,
	})
}
