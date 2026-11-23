package routers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"grepdocs/api/credentials"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/providers"
	"grepdocs/api/secrets"
	"grepdocs/api/session"
)

type ExternalAccountsHandler struct {
	dbPool           *pgxpool.Pool
	sessionMgr       *session.SessionManager
	providerRegistry *providers.Registry
	cipher           secrets.Cipher
	creds            *credentials.Service
}

// ExternalAccountsRoutes initializes the external git accounts routes
func ExternalAccountsRoutes(
	pool *pgxpool.Pool,
	sm *session.SessionManager,
	pr *providers.Registry,
	cipher secrets.Cipher,
	creds *credentials.Service,
) chi.Router {
	h := &ExternalAccountsHandler{
		dbPool:           pool,
		sessionMgr:       sm,
		providerRegistry: pr,
		cipher:           cipher,
		creds:            creds,
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
	sanitizedAccounts := make([]map[string]any, len(accounts))
	now := time.Now()
	for i, acc := range accounts {
		sanitizedAccounts[i] = map[string]any{
			"id":                       acc.ID,
			"provider":                 acc.Provider,
			"provider_user_id":         acc.ProviderUserID,
			"provider_login":           textOrNil(acc.ProviderLogin),
			"linked_at":                acc.LinkedAt,
			"last_refreshed_at":        acc.LastRefreshedAt,
			"token_expires_at":         acc.TokenExpiresAt,
			"refresh_token_expires_at": acc.RefreshTokenExpiresAt,
			"label":                    acc.Label,
			"needs_relink":             h.creds.NeedsReauth(acc, now),
		}
	}

	httpx.WriteJSON(w, http.StatusOK, sanitizedAccounts)
}

// providerLogin starts the OAuth flow that links a provider account. With
// account_id, it re-links that account: the target is stored in the session
// next to the state, and the callback refuses any other identity.
//
// This is a full-page navigation, so every failure except an unregistered
// provider redirects to the accounts page instead of answering JSON.
func (h *ExternalAccountsHandler) providerLogin(w http.ResponseWriter, r *http.Request) {
	providerParam := chi.URLParam(r, "provider")
	provider, ok := h.providerRegistry.Lookup(providerParam)
	if !ok {
		// the UI only links providers listed by GET /providers
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+providerParam)
		return
	}

	userID, _ := middleware.CurrentUserID(r)

	opts := providers.AuthOptions{SelectAccount: true}
	var relinkID int64
	if r.URL.Query().Has("account_id") {
		// a malformed id cannot name one of the user's accounts: same code as an
		// unknown one, since a 400 would strand the user on JSON
		id, err := parsePositiveID(r.URL.Query().Get("account_id"))
		if err != nil {
			redirectLinkOutcome(w, r, linkFailure(linkErrAccountNotFound))
			return
		}

		target, err := h.creds.ResolveAccount(r.Context(), userID, provider.Name(), id)
		switch {
		case errors.Is(err, credentials.ErrAccountNotFound):
			redirectLinkOutcome(w, r, linkFailure(linkErrAccountNotFound))
			return
		case err != nil:
			//nolint:gosec // G706: id is a parsed int64, err comes from the database
			log.Printf("accounts: resolving re-link target %d: %v", id, err)
			redirectLinkOutcome(w, r, linkFailure(linkErrServerError))
			return
		}
		relinkID = target.ID
		if login := textOrNil(target.ProviderLogin); login != nil {
			opts.LoginHint = *login
		}
	}

	// Generate state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		log.Printf("accounts: generating oauth state: %v", err)
		redirectLinkOutcome(w, r, linkFailure(linkErrServerError))
		return
	}

	// Store state and re-link target for the callback; a plain link (relinkID == 0)
	// clears a target left over from an abandoned re-link
	sess, _ := session.GetSession(h.sessionMgr, r)
	sess.SetOAuthStateToken(state)
	sess.SetRelinkAccountID(relinkID)

	authURL := provider.AuthCodeURL(state, opts)
	//nolint:gosec // G710: the URL is built by the provider from its own config, not from input
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// providerCallback handles the OAuth callback from a git provider. Every
// outcome redirects to the accounts page with the codes in account_link.go;
// the real error is only logged.
func (h *ExternalAccountsHandler) providerCallback(w http.ResponseWriter, r *http.Request) {
	// both single-use: read them before any early return, so neither outlives
	// this flow
	sess, _ := session.GetSession(h.sessionMgr, r)
	sessState := sess.GetOAuthStateToken()
	relinkID := sess.GetRelinkAccountID()

	providerParam := chi.URLParam(r, "provider")
	provider, ok := h.providerRegistry.Lookup(providerParam)
	if !ok {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+providerParam)
		return
	}

	userID, _ := middleware.CurrentUserID(r)

	redirectLinkOutcome(w, r, h.linkCallback(r.Context(), provider, userID, r.URL.Query(), sessState, relinkID))
}

// linkCallback runs the callback once the session values are read: it checks
// the state, exchanges the code, and stores the account. relinkID is the
// re-link target, or 0 for a plain link. Once a token is issued, every failure
// that does not store it revokes it, so no live token is left unaccounted for.
func (h *ExternalAccountsHandler) linkCallback(
	ctx context.Context,
	provider providers.Provider,
	userID int64,
	query url.Values,
	sessState string,
	relinkID int64,
) linkOutcome {
	if sessState == "" || query.Get("state") != sessState {
		return linkFailure(linkErrInvalidState)
	}

	// read before code: a cancel comes back with error and no code
	if errParam := query.Get("error"); errParam != "" {
		//nolint:gosec // G706: %q escapes control characters in the provider's error param
		log.Printf("accounts: %s authorization returned error %q", provider.Name(), errParam)
		return linkFailure(providerAuthError(errParam))
	}

	code := query.Get("code")
	if code == "" {
		return linkFailure(linkErrLinkFailed)
	}

	token, err := provider.Exchange(ctx, code)
	if err != nil {
		//nolint:gosec // G706: the name comes from the registry, err from the token exchange
		log.Printf("accounts: %s code exchange: %v", provider.Name(), err)
		return linkFailure(linkErrLinkFailed)
	}

	// A token now exists: finish detached from the request. Otherwise a client
	// disconnect could cancel the store after it committed, and discard would
	// revoke the token just stored.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), linkFinishTimeout)
	defer cancel()

	// discard revokes the issued token, which is never stored on this path
	discard := func(o linkOutcome) linkOutcome {
		if err := h.creds.RevokeAccessToken(ctx, provider.Name(), token.AccessToken); err != nil {
			//nolint:gosec // G706: the name comes from the registry, err from the revoke call
			log.Printf("accounts: revoking discarded %s token: %v", provider.Name(), err)
		}
		return o
	}

	provUser, err := provider.FetchUser(ctx, token.AccessToken)
	switch {
	case errors.Is(err, providers.ErrInvalidToken):
		//nolint:gosec // G706: the name comes from the registry, err from the user call
		log.Printf("accounts: %s rejected the new token: %v", provider.Name(), err)
		return discard(linkFailure(linkErrLinkFailed))
	case err != nil:
		//nolint:gosec // G706: the name comes from the registry, err from the user call
		log.Printf("accounts: fetching %s user: %v", provider.Name(), err)
		return discard(linkFailure(linkErrServerError))
	}

	account, existing, failCode, err := h.storeAccount(ctx, provider, userID, relinkID, provUser, token)
	switch {
	case err != nil:
		//nolint:gosec // G706: the name comes from the registry, err from the database
		log.Printf("accounts: storing %s account: %v", provider.Name(), err)
		return discard(linkFailure(linkErrServerError))
	case failCode == linkErrIdentityMismatch:
		return discard(linkOutcome{Error: failCode, AccountID: relinkID})
	case failCode != "":
		return discard(linkFailure(failCode))
	}

	if existing.ID > 0 {
		// DB first, then revoke: the replaced token is no longer stored
		if err := h.creds.Revoke(ctx, existing); err != nil {
			// just log, account has been successfully re-linked anyway
			log.Printf("accounts: revoking replaced token of account %d: %v", existing.ID, err)
		}
		return linkSuccess(linkResultRelinked, account.ID)
	}
	return linkSuccess(linkResultLinked, account.ID)
}

// storeAccount encrypts the tokens and upserts the account for the identity
// provUser. It also returns the row it replaced (zero ID for a new identity),
// whose tokens the caller revokes.
//
// For a re-link (relinkID > 0) it first locks the target row and checks it with
// checkRelinkTarget; when that fails, it stores nothing and returns the code as
// failCode. Check and write share one transaction, so the target cannot be
// unlinked in between (the write would then insert a new account): an unlink
// waits for the lock, then deletes the re-linked row and revokes its tokens.
func (h *ExternalAccountsHandler) storeAccount(
	ctx context.Context,
	provider providers.Provider,
	userID int64,
	relinkID int64,
	provUser providers.User,
	token providers.Token,
) (account, existing dal.ExternalGitAccount, failCode string, err error) {
	encAccTok, err := h.cipher.Encrypt(token.AccessToken)
	if err != nil {
		return account, existing, "", err
	}

	encRefTok := ""
	if len(token.RefreshToken) > 0 {
		encRefTok, err = h.cipher.Encrypt(token.RefreshToken)
		if err != nil {
			return account, existing, "", err
		}
	}

	tx, err := h.dbPool.Begin(ctx)
	if err != nil {
		return account, existing, "", err
	}
	defer tx.Rollback(ctx)

	q := dal.New(tx)

	if relinkID > 0 {
		target, err := q.GetExternalGitAccountByIdForUpdate(ctx, relinkID)
		found := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return account, existing, "", err
		}
		if failCode = checkRelinkTarget(target, found, userID, provider.Name(), provUser.ProviderUserID); failCode != "" {
			return account, existing, failCode, nil
		}
	}

	existing, err = q.GetExternalGitAccountByIdentity(ctx, dal.GetExternalGitAccountByIdentityParams{
		UserID:         userID,
		Provider:       provider.Name(),
		ProviderUserID: provUser.ProviderUserID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return account, existing, "", err
	}

	account, err = q.UpsertExternalGitAccount(ctx, dal.UpsertExternalGitAccountParams{
		UserID:                userID,
		Provider:              provider.Name(),
		ProviderUserID:        provUser.ProviderUserID,
		ProviderLogin:         pgtype.Text{String: provUser.Login, Valid: provUser.Login != ""},
		AccessToken:           encAccTok,
		RefreshToken:          encRefTok,
		TokenExpiresAt:        token.Expiry,
		RefreshTokenExpiresAt: token.RefreshExpiry,
	})
	if err != nil {
		return account, existing, "", err
	}
	return account, existing, "", tx.Commit(ctx)
}

// redirectLinkOutcome ends a linking flow on the UI's accounts page
func redirectLinkOutcome(w http.ResponseWriter, r *http.Request, o linkOutcome) {
	http.Redirect(w, r, linkRedirectURL(frontendURL(), o), http.StatusTemporaryRedirect)
}

// deleteExternalAccount removes an external git account
func (h *ExternalAccountsHandler) deleteExternalAccount(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.CurrentUserID(r)

	accountID, ok := parseIDParam(w, r)
	if !ok {
		return
	}

	q := dal.New(h.dbPool)

	// Delete the account
	account, err := q.DeleteExternalGitAccountByIdAndUserId(r.Context(), dal.DeleteExternalGitAccountByIdAndUserIdParams{
		ID:     accountID,
		UserID: userID,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// 404 doesn't leak existence of another user's account
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "Account not found")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	// Revoke tokens
	err = h.creds.Revoke(r.Context(), account)
	if err != nil {
		// just log, account has been successfully unlinked anyway
		log.Printf("error with token revocation: %v", err)
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

	accountIDParam := r.URL.Query().Get("account_id")
	var accountID int64
	if accountIDParam != "" {
		parsed, err := parsePositiveID(accountIDParam)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid account_id param: should be a positive int")
			return
		}
		accountID = parsed
	}

	account, err := h.creds.ResolveAccount(r.Context(), userID, provider.Name(), accountID)
	switch {
	case errors.Is(err, credentials.ErrAccountNotFound):
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "No account found for provider "+provider.Name())
		return
	case errors.Is(err, credentials.ErrAccountAmbiguous):
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Multiple accounts found for provider "+provider.Name()+", please specify account_id to select one")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	tok, err := h.creds.ForAccount(r.Context(), account)
	switch {
	case errors.Is(err, credentials.ErrReauthRequired):
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Invalid or expired token, re-link your account")
		return
	case err != nil:
		httpx.WriteInternalError(w, err)
		return
	}

	repos, err := provider.ListRepositories(r.Context(), tok)
	switch {
	case errors.Is(err, providers.ErrAppNotInstalled):
		httpx.WriteErrorWithDetails(w, http.StatusForbidden, httpx.CodeAppNotInstalled,
			"The app is not installed on any of your accounts, install it to grant repository access",
			installDetails(provider))
		return
	case errors.Is(err, providers.ErrInvalidToken):
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

// textOrNil returns t's value, or nil (JSON null) when it is NULL or empty: an
// empty login would render as a bare "@" in the UI, so it counts as unknown.
func textOrNil(t pgtype.Text) *string {
	if !t.Valid || t.String == "" {
		return nil
	}
	return &t.String
}
