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
	"strings"
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
	r.Delete("/{id}", h.deleteRepository)

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

	prov, ok := h.providerRegistry.Lookup(reqBody.Provider)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+reqBody.Provider)
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
	if err != nil {
		if !writeProviderError(w, err) {
			httpx.WriteInternalError(w, err)
		}
		return
	}

	trackedBranch := reqBody.TrackedBranch
	if trackedBranch == "" {
		trackedBranch = provRepo.DefaultBranch
	} else {
		branches, err := prov.ListBranches(r.Context(), token, provRepo.Owner, provRepo.Name)
		if err != nil {
			if !writeProviderError(w, err) {
				httpx.WriteInternalError(w, err)
			}
			return
		}

		if !branchExists(branches, trackedBranch) {
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "tracked_branch in request body not found in repository branches")
			return
		}
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
	id, ok := parseIDParam(w, r)
	if !ok {
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
	id, ok := parseIDParam(w, r)
	if !ok {
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

	updateParams := &dal.UpdateRepositoryParams{
		ID:            id,
		UserID:        uid,
		TrackedBranch: repo.TrackedBranch,
		SyncedCommit:  repo.SyncedCommit,
		SyncStatus:    repo.SyncStatus,
		AutoSync:      repo.AutoSync,
		LastSyncAt:    repo.LastSyncAt,
	}

	if reqBody.AutoSync != nil {
		updateParams.AutoSync = *reqBody.AutoSync
	}

	if reqBody.TrackedBranch != "" && !strings.EqualFold(reqBody.TrackedBranch, repo.TrackedBranch) {
		updateParams.TrackedBranch = reqBody.TrackedBranch
		// on branch change, reset sync
		updateParams.SyncedCommit = pgtype.Text{}
		updateParams.SyncStatus = "pending"
		updateParams.LastSyncAt = nil

		// check branch existence
		prov, ok := h.providerRegistry.Lookup(repo.Provider)
		if !ok {
			httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+repo.Provider)
			return
		}

		token := ""
		if repo.IsPrivate {
			acc, err := resolveAccount(r.Context(), q, uid, repo.Provider, repo.AccountID.Int64)
			switch {
			case errors.Is(err, errAccountNotFound):
				httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden,
					"No linked "+repo.Provider+" account available to verify the branch, please re-link your account")
				return
			case errors.Is(err, errAccountAmbiguous):
				httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest,
					"Multiple "+repo.Provider+" accounts found, cannot verify the branch")
				return
			case err != nil:
				httpx.WriteInternalError(w, err)
				return
			}

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

		branches, err := prov.ListBranches(r.Context(), token, repo.Owner, repo.Name)
		if err != nil {
			if !writeProviderError(w, err) {
				httpx.WriteInternalError(w, err)
			}
			return
		}

		if !branchExists(branches, updateParams.TrackedBranch) {
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "tracked_branch in request body not found in repository branches")
			return
		}
	}

	updated, err := q.UpdateRepository(r.Context(), *updateParams)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toRepositoryDTO(updated))
}

func (h *RepositoriesHandler) deleteRepository(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	uid, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	_, err := q.GetRepositoryByIDAndUserID(r.Context(), dal.GetRepositoryByIDAndUserIDParams{
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

	if err := q.DeleteRepository(r.Context(), dal.DeleteRepositoryParams{ID: id, UserID: uid}); err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// private helpers

// writeProviderError maps a normalized provider error to an HTTP response,
// returning true when the error was recognized and a response was written.
func writeProviderError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, providers.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "repository not found")
	case errors.Is(err, providers.ErrInvalidToken):
		// TODO: if provider impls Refresher, refresh token
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden,
			"The linked account's access token is invalid or revoked, please re-link your account")
	case errors.Is(err, providers.ErrRateLimited):
		httpx.WriteError(w, http.StatusTooManyRequests, httpx.CodeRateLimited,
			"Provider rate limit exceeded, try again later")
	default:
		return false
	}
	return true
}

func branchExists(branches []providers.Branch, name string) bool {
	for _, b := range branches {
		if strings.EqualFold(b.Name, name) {
			return true
		}
	}
	return false
}

// parseIDParam reads and parses the {id} URL param, writing a 400 on failure.
func parseIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id param")
		return 0, false
	}
	return id, true
}

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
