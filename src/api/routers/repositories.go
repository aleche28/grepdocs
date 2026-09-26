package routers

import (
	"errors"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/session"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type repoHandler struct {
	dbPool *pgxpool.Pool
	sm     *session.SessionManager
}

func RepositoriesRoutes(pool *pgxpool.Pool, sm *session.SessionManager) chi.Router {
	h := &repoHandler{dbPool: pool, sm: sm}
	r := chi.NewRouter()
	r.Use(middleware.RequireAuth(sm))

	r.Get("/", h.listRepositories)
	r.Get("/{id}", h.getRepositoryByID)

	return r
}

func (h *repoHandler) listRepositories(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	repos, err := q.GetRepositoriesByUserID(r.Context(), uid)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, repos)
}

func (h *repoHandler) getRepositoryByID(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	if len(idParam) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "empty id param")
		return
	}

	id, err := strconv.ParseInt(idParam, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id param")
		return
	}

	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	repo, err := q.GetRepositoryByIDAndUserID(r.Context(), dal.GetRepositoryByIDAndUserIDParams{
		ID:     id,
		UserID: uid,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "repository not found for current user")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, repo)
}
