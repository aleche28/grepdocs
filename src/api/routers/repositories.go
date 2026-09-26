package routers

import (
	"encoding/json"
	"errors"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/models"
	"grepdocs/api/providers"
	"grepdocs/api/secrets"
	"grepdocs/api/session"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgUniqueViolation is the PostgreSQL SQLSTATE for a unique constraint violation.
const pgUniqueViolation = "23505"

type RepositoriesHandler struct {
	dbPool           *pgxpool.Pool
	sessionMgr       *session.SessionManager
	providerRegistry *providers.Registry
	cipher           secrets.Cipher
}

func RepositoriesRoutes(pool *pgxpool.Pool, sm *session.SessionManager, reg *providers.Registry, cipher secrets.Cipher) chi.Router {
	h := &RepositoriesHandler{
		dbPool:           pool,
		sessionMgr:       sm,
		providerRegistry: reg,
		cipher:           cipher,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequireAuth(sm))

	r.Get("/", h.listRepositories)
	r.Post("/", h.trackNewRepository)
	r.Get("/{id}", h.getRepositoryByID)
	r.Patch("/{id}", h.updateRepository)

	return r
}

func (h *RepositoriesHandler) listRepositories(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	// TODO: add optional provider and account_id filters
	repos, err := q.GetRepositoriesByUserID(r.Context(), uid)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	dtos := make([]models.Repository, len(repos))
	for i, repo := range repos {
		dtos[i] = toRepositoryDTO(repo)
	}

	httpx.WriteJSON(w, http.StatusOK, dtos)
}

func (h *RepositoriesHandler) trackNewRepository(w http.ResponseWriter, r *http.Request) {
	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	var reqBody models.CreateRepositoryRequest
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid request body")
		return
	}

	if reqBody.Provider == "" || reqBody.Owner == "" || reqBody.Name == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "provider, owner and name are required")
		return
	}

	var acc dal.ExternalGitAccount
	if reqBody.AccountID > 0 {
		var err error
		acc, err = resolveAccount(r.Context(), q, uid, reqBody.Provider, reqBody.AccountID)
		switch {
		case errors.Is(err, errAccountNotFound):
			httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "No account found for provider "+reqBody.Provider)
			return
		case errors.Is(err, errAccountAmbiguous):
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Multiple accounts found for provider "+reqBody.Provider+", please specify account_id to select one")
			return
		case err != nil:
			httpx.WriteInternalError(w, err)
			return
		}
	}

	prov, ok := h.providerRegistry.Lookup(reqBody.Provider)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+reqBody.Provider)
		return
	}

	// A repo can be tracked without an account if the repo is public
	token := ""
	if acc.ID != 0 {
		if acc.AccessToken == "" || (acc.TokenExpiresAt != nil && acc.TokenExpiresAt.Before(time.Now())) {
			// No refresh flow yet: the user must re-link the account
			httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Empty access token or expired")
			return
		}

		decrypted, err := h.cipher.Decrypt(acc.AccessToken)
		if err != nil {
			httpx.WriteInternalError(w, err)
			return
		}
		token = decrypted
	}

	provRepo, err := prov.GetRepository(r.Context(), token, reqBody.Owner, reqBody.Name)
	switch {
	case errors.Is(err, providers.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "repository not found")
		return
	case errors.Is(err, providers.ErrInvalidToken):
		// TODO: if provider impls Refresher, refresh token
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden,
			"The linked account's access token is invalid or revoked, please re-link your account")
		return
	case errors.Is(err, providers.ErrRateLimited):
		httpx.WriteError(w, http.StatusTooManyRequests, httpx.CodeRateLimited,
			"Provider rate limit exceeded, try again later")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	trackedBranch := reqBody.TrackedBranch
	if trackedBranch == "" {
		trackedBranch = provRepo.DefaultBranch
	}

	repo, err := q.CreateRepository(r.Context(), dal.CreateRepositoryParams{
		UserID:         uid,
		AccountID:      pgtype.Int8{Int64: acc.ID, Valid: acc.ID != 0},
		Provider:       reqBody.Provider,
		ProviderRepoID: provRepo.ProviderRepoID,
		Owner:          provRepo.Owner,
		Name:           provRepo.Name,
		FullName:       provRepo.FullName,
		DefaultBranch:  provRepo.DefaultBranch,
		HtmlUrl:        provRepo.HTMLURL,
		IsPrivate:      provRepo.IsPrivate,
		TrackedBranch:  trackedBranch,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			httpx.WriteError(w, http.StatusConflict, httpx.CodeConflict, "repository already tracked")
			return
		}
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, toRepositoryDTO(repo))
}

func (h *RepositoriesHandler) getRepositoryByID(w http.ResponseWriter, r *http.Request) {
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

	httpx.WriteJSON(w, http.StatusOK, toRepositoryDTO(repo))
}

func (h *RepositoriesHandler) updateRepository(w http.ResponseWriter, r *http.Request) {
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

	var reqBody models.UpdateRepositoryRequest
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid request body")
		return
	}

	trackedBranch := repo.TrackedBranch
	if reqBody.TrackedBranch != "" {
		trackedBranch = reqBody.TrackedBranch
	}

	updated, err := q.UpdateRepository(r.Context(), dal.UpdateRepositoryParams{
		ID:            id,
		TrackedBranch: trackedBranch,
		SyncedCommit:  repo.SyncedCommit,
		SyncStatus:    repo.SyncStatus,
		AutoSync:      reqBody.AutoSync,
		LastSyncAt:    repo.LastSyncAt,
	})
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, updated)
}

// private helpers

func toRepositoryDTO(repo dal.Repository) models.Repository {
	dto := models.Repository{
		ID:             repo.ID,
		Provider:       repo.Provider,
		ProviderRepoID: repo.ProviderRepoID,
		Owner:          repo.Owner,
		Name:           repo.Name,
		FullName:       repo.FullName,
		HTMLURL:        repo.HtmlUrl,
		IsPrivate:      repo.IsPrivate,
		DefaultBranch:  repo.DefaultBranch,
		TrackedBranch:  repo.TrackedBranch,
		SyncStatus:     repo.SyncStatus,
		AutoSync:       repo.AutoSync,
		LastSyncAt:     repo.LastSyncAt,
		CreatedAt:      repo.CreatedAt,
		UpdatedAt:      repo.UpdatedAt,
	}

	if repo.AccountID.Valid {
		accountID := repo.AccountID.Int64
		dto.AccountID = &accountID
	}
	if repo.SyncedCommit.Valid {
		syncedCommit := repo.SyncedCommit.String
		dto.SyncedCommit = &syncedCommit
	}

	return dto
}
