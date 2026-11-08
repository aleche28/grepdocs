package routers

import (
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/models"
	"grepdocs/api/session"
	"net/http"

	"github.com/go-chi/chi/v5"
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
	r.Get("/{id}", h.getDocumentById)
	r.Get("/{id}/raw", h.getRawDocumentById)

	return r
}

func (h *DocumentsHandler) listDocuments(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	docs, err := q.ListUserDocuments(r.Context(), uid)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toDocumentsDTO(docs))
}

func (h *DocumentsHandler) getDocumentById(w http.ResponseWriter, r *http.Request) {
}

func (h *DocumentsHandler) getRawDocumentById(w http.ResponseWriter, r *http.Request) {
}

func toDocumentsDTO(docs []dal.ListUserDocumentsRow) []models.Document {
	dto := make([]models.Document, 0, len(docs))
	for _, d := range docs {
		dto = append(dto, models.Document{
			ID:       d.ID,
			SHA:      d.BlobSha,
			Path:     d.Path,
			SyncedAt: &d.SyncedAt,
			RepoId:   d.RepositoryID,
		})
	}
	return dto
}
