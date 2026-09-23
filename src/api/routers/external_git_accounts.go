package routers

import (
	"context"
	"errors"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/providers"
	"grepdocs/api/session"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ExternalAccountsHandler struct {
	dbPool           *pgxpool.Pool
	sessionMgr       *session.SessionManager
	providerRegistry *providers.Registry
}

// Errors returned by resolveAccount; callers map them to HTTP responses.
var (
	errAccountNotFound  = errors.New("external account not found")
	errAccountAmbiguous = errors.New("multiple external accounts for provider")
)

// ExternalAccountsRoutes initializes the external git accounts routes
func ExternalAccountsRoutes(pool *pgxpool.Pool, sm *session.SessionManager, pr *providers.Registry) chi.Router {
	h := &ExternalAccountsHandler{
		dbPool:           pool,
		sessionMgr:       sm,
		providerRegistry: pr,
	}

	r := chi.NewRouter()

	// All routes require authentication
	r.Use(middleware.RequireAuth(sm))

	// List all external accounts for authenticated user
	r.Get("/", h.listExternalAccounts)

	// Provider OAuth flow
	r.Get("/{provider}/login", h.providerLogin)
	r.Get("/{provider}/callback", h.providerCallback)
	r.Get("/{provider}/repositories", h.listExternalRepositories)

	// Delete external account
	r.Delete("/{id}", h.deleteExternalAccount)

	return r
}

// listExternalAccounts returns all external git accounts for the authenticated user
func (h *ExternalAccountsHandler) listExternalAccounts(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	accounts, err := q.GetExternalGitAccountsByUserID(r.Context(), userID)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Sanitize response - don't send tokens to client
	sanitizedAccounts := make([]map[string]interface{}, len(accounts))
	for i, acc := range accounts {
		sanitizedAccounts[i] = map[string]interface{}{
			"id":                acc.ID,
			"provider":          acc.Provider,
			"provider_user_id":  acc.ProviderUserID,
			"linked_at":         acc.LinkedAt,
			"last_refreshed_at": acc.LastRefreshedAt,
			"token_expires_at":  acc.TokenExpiresAt,
			"label":             acc.Label,
		}
	}

	httpx.WriteJSON(w, http.StatusOK, sanitizedAccounts)
}

// providerLogin initiates the OAuth flow for a git provider
func (h *ExternalAccountsHandler) providerLogin(w http.ResponseWriter, r *http.Request) {
	providerParam := chi.URLParam(r, "provider")
	provider, ok := h.providerRegistry.Lookup(providerParam)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+providerParam)
		return
	}

	// Generate state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Store state in session for verification in callback
	sess, _ := session.GetSession(h.sessionMgr, r)
	sess.SetOAuthStateToken(state)

	url := provider.AuthCodeURL(state)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// providerCallback handles the OAuth callback from a git provider
func (h *ExternalAccountsHandler) providerCallback(w http.ResponseWriter, r *http.Request) {
	providerParam := chi.URLParam(r, "provider")
	provider, ok := h.providerRegistry.Lookup(providerParam)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+providerParam)
		return
	}

	userID, _ := middleware.CurrentUserID(r)

	// Verify state (single-use: retrieved and cleared from the session)
	sess, _ := session.GetSession(h.sessionMgr, r)
	sessState := sess.GetOAuthStateToken()
	if sessState == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Oauth state token not found in session")
		return
	}

	state := r.URL.Query().Get("state")
	if state != sessState {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid state parameter")
		return
	}

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Code not found in URL")
		return
	}

	// Exchange code for token
	token, err := provider.Exchange(r.Context(), code)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid or expired authorization code")
		return
	}

	// Fetch provider user info
	provUser, err := provider.FetchUser(r.Context(), token.AccessToken)
	if errors.Is(err, providers.ErrInvalidToken) {
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Invalid or revoked access token")
		return
	}
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Store external account
	q := dal.New(h.dbPool)

	// Calculate token expiration (GitHub tokens don't expire by default, set to far future)
	expiresAt := time.Now().AddDate(1, 0, 0) // 1 year from now
	if !token.Expiry.IsZero() {
		expiresAt = token.Expiry
	}

	refreshToken := ""
	if token.RefreshToken != "" {
		refreshToken = token.RefreshToken
	}

	_, err = q.UpsertExternalGitAccount(r.Context(), dal.UpsertExternalGitAccountParams{
		UserID:         userID,
		Provider:       provider.Name(),
		ProviderUserID: provUser.ProviderUserID,
		AccessToken:    token.AccessToken,
		RefreshToken:   refreshToken,
		TokenExpiresAt: &expiresAt,
	})
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Redirect to frontend success page
	redirectURL := os.Getenv("FRONTEND_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:3000"
	}
	http.Redirect(w, r, redirectURL+"/settings/accounts?linked="+provider.Name(), http.StatusTemporaryRedirect)
}

// deleteExternalAccount removes an external git account
func (h *ExternalAccountsHandler) deleteExternalAccount(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.CurrentUserID(r)

	accountIDStr := chi.URLParam(r, "id")
	accountID, err := strconv.ParseInt(accountIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid account ID")
		return
	}

	q := dal.New(h.dbPool)

	// Verify the account belongs to the user
	account, err := q.GetExternalGitAccountById(r.Context(), accountID)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "Account not found")
		return
	}

	if account.UserID != userID {
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Forbidden")
		return
	}

	// Delete the account
	err = q.DeleteExternalGitAccount(r.Context(), accountID)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "External account unlinked successfully",
	})
}

// listExternalRepositories returns all external git accounts repositories for the authenticated user
func (h *ExternalAccountsHandler) listExternalRepositories(w http.ResponseWriter, r *http.Request) {
	providerParam := chi.URLParam(r, "provider")
	provider, ok := h.providerRegistry.Lookup(providerParam)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+providerParam)
		return
	}

	userID, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	accountIDParam := r.URL.Query().Get("account_id")
	var accountID int64
	if accountIDParam != "" {
		parsed, err := strconv.ParseInt(accountIDParam, 10, 64)
		if err != nil || parsed <= 0 {
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid account_id param: should be a positive int")
			return
		}
		accountID = parsed
	}

	account, err := resolveAccount(r.Context(), q, userID, provider.Name(), accountID)
	switch {
	case errors.Is(err, errAccountNotFound):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "No account found for provider "+provider.Name())
		return
	case errors.Is(err, errAccountAmbiguous):
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Multiple accounts found for provider "+provider.Name()+", please specify account_id to select one")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	if account.AccessToken == "" || (account.TokenExpiresAt != nil && account.TokenExpiresAt.Before(time.Now())) {
		// No refresh flow yet: the user must re-link the account
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Empty access token or expired")
		return
	}

	repos, err := provider.ListRepositories(r.Context(), account.AccessToken)
	switch {
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

	httpx.WriteJSON(w, http.StatusOK, repos)
}

// resolveAccount selects the external account an account-scoped request refers
// to. With a positive accountID it loads that account and verifies it belongs to
// userID and matches provider. Otherwise it resolves the single account for
// (userID, provider), returning errAccountAmbiguous when more than one exists so
// the caller can require an explicit account_id.
func resolveAccount(ctx context.Context, q *dal.Queries, userID int64, provider string, accountID int64) (dal.ExternalGitAccount, error) {
	if accountID > 0 {
		account, err := q.GetExternalGitAccountById(ctx, accountID)
		if errors.Is(err, pgx.ErrNoRows) {
			return dal.ExternalGitAccount{}, errAccountNotFound
		}
		if err != nil {
			return dal.ExternalGitAccount{}, err
		}
		if account.UserID != userID || account.Provider != provider {
			return dal.ExternalGitAccount{}, errAccountNotFound
		}
		return account, nil
	}

	accounts, err := q.GetExternalGitAccountsByUserIDAndProvider(ctx, dal.GetExternalGitAccountsByUserIDAndProviderParams{
		UserID:   userID,
		Provider: provider,
	})
	if err != nil {
		return dal.ExternalGitAccount{}, err
	}

	switch len(accounts) {
	case 0:
		return dal.ExternalGitAccount{}, errAccountNotFound
	case 1:
		return accounts[0], nil
	default:
		return dal.ExternalGitAccount{}, errAccountAmbiguous
	}
}
