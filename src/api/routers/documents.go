package routers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/models"
	"grepdocs/api/session"
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
	r.Get("/{id}/raw", h.getRawDocumentByID)

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

	httpx.WriteJSON(w, http.StatusOK, toDocumentListDTO(docs))
}

func (h *DocumentsHandler) getDocumentByID(w http.ResponseWriter, r *http.Request) {
	doc, ok := h.loadDocument(w, r)
	if !ok {
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toDocumentDetailsDTO(doc))
}

func (h *DocumentsHandler) getRawDocumentByID(w http.ResponseWriter, r *http.Request) {
	doc, ok := h.loadDocument(w, r)
	if !ok {
		return
	}

	httpx.WriteRaw(w, http.StatusOK, "text/markdown; charset=utf-8", []byte(doc.Content))
}

// loadDocument fetches the caller's document named by the {id} URL param. When it returns false,
// it has already written the error response.
func (h *DocumentsHandler) loadDocument(w http.ResponseWriter, r *http.Request) (dal.GetDocumentByIDAndUserIDRow, bool) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return dal.GetDocumentByIDAndUserIDRow{}, false
	}

	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	doc, err := q.GetDocumentByIDAndUserID(r.Context(), dal.GetDocumentByIDAndUserIDParams{
		ID:     id,
		UserID: uid,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "document not found")
		return dal.GetDocumentByIDAndUserIDRow{}, false
	case err != nil:
		httpx.WriteInternalError(w, err)
		return dal.GetDocumentByIDAndUserIDRow{}, false
	}

	return doc, true
}

// parseRepositoryIDParam parses the optional repo_id filter; an empty param means no filter.
func parseRepositoryIDParam(param string) (pgtype.Int8, error) {
	if param == "" {
		return pgtype.Int8{}, nil
	}
	id, err := parsePositiveID(param)
	if err != nil {
		return pgtype.Int8{}, err
	}
	return pgtype.Int8{Int64: id, Valid: true}, nil
}

func toDocumentListDTO(docs []dal.ListUserDocumentsRow) []models.Document {
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

func toDocumentDetailsDTO(d dal.GetDocumentByIDAndUserIDRow) models.DocumentDetails {
	doc := models.Document{
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
		doc.UpstreamCommit = &d.RepoCommit.String
	}
	return models.DocumentDetails{Document: doc, Content: d.Content}
}
