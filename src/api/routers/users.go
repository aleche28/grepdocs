package routers

import (
	"context"
	"grepdocs/api/dal"
	"grepdocs/api/session"
	"net/http"
	"strconv"

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
	// r.Use(AuthMiddleware) // TODO: Add authentication middleware

	r.Get("/me", h.getAuthenticatedUser(pool)) // TODO: this probably duplicates the /whoami in auth.go
	r.Get("/{id}", h.getUserByID(pool))

	return r
}

// getAuthenticatedUser returns the currently authenticated user
func (h *UserHandler) getAuthenticatedUser(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := session.GetSession(h.sessionMgr, r)
		if !session.IsAuthenticated() {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		uid := session.GetUserId()
		ctx := context.Background()
		q := dal.New(h.dbPool)

		user, err := q.GetUserById(ctx, uid)
		if err != nil {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		respondJSON(w, http.StatusOK, user)
	}
}

// getUserByID returns a user by their ID
func (h *UserHandler) getUserByID(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := session.GetSession(h.sessionMgr, r)
		if !session.IsAuthenticated() {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		idParam := chi.URLParam(r, "id")
		userID, err := strconv.ParseInt(idParam, 10, 64)
		if err != nil {
			http.Error(w, "Invalid user ID", http.StatusBadRequest)
			return
		}

		// TODO: should check user role for permissions to view this user

		ctx := context.Background()
		q := dal.New(pool)

		user, err := q.GetUserById(ctx, userID)
		if err != nil {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}

		respondJSON(w, http.StatusOK, user)
	}
}
