package routers

import (
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/models"
	"grepdocs/api/session"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DocumentsHandler struct {
	dbPool     *pgxpool.Pool
	sessionMgr *session.SessionManager
}

func DocumentsRoutes(
	pool *pgxpool.Pool,
	sm *session.SessionManager,
) chi.Router {
	h := &DocumentsHandler{
		dbPool:     pool,
		sessionMgr: sm,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequireAuth(sm))

	r.Get("/", h.listDocuments)
	r.Get("/{id}", h.getDocumentByID)
	r.Get("/{id}/raw", h.getRawDocumentById)

	return r
}

func (h *DocumentsHandler) listDocuments(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	repoID, err := parseRepositoryIDParam(r.URL.Query().Get("repo_id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid repo_id parameter")
		return
	}

	docs, err := q.ListUserDocuments(r.Context(), dal.ListUserDocumentsParams{
		UserID: uid,
		RepoID: repoID,
	})
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toDocumentsDTO(docs))
}

func (h *DocumentsHandler) getDocumentByID(w http.ResponseWriter, r *http.Request) {
}

func (h *DocumentsHandler) getRawDocumentById(w http.ResponseWriter, r *http.Request) {
}

func parseRepositoryIDParam(param string) (pgtype.Int8, error) {
	repoID := pgtype.Int8{Valid: false}
	if len(param) > 0 {
		idInt, err := strconv.ParseInt(param, 10, 64)
		if err != nil {
			return pgtype.Int8{}, err
		}
		repoID.Int64 = idInt
		repoID.Valid = true
	}
	return repoID, nil
}

func toDocumentsDTO(docs []dal.ListUserDocumentsRow) []models.Document {
	dtos := make([]models.Document, 0, len(docs))
	for _, d := range docs {
		dto := models.Document{
			ID:           d.ID,
			SHA:          d.BlobSha,
			Path:         d.Path,
			SyncedAt:     d.SyncedAt,
			RepositoryID: d.RepositoryID,
			Repository:   d.RepoFullname,
			Provider:     d.RepoProvider,
			Branch:       d.RepoBranch,
		}
		if d.RepoCommit.Valid {
			dto.UpstreamCommit = &d.RepoCommit.String
		}
		dtos = append(dtos, dto)
	}
	return dtos
}
