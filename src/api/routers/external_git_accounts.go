package routers

import (
	"context"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/middleware"
	"grepdocs/api/session"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

type ExternalAccountsHandler struct {
	dbPool               *pgxpool.Pool
	sessionMgr           *session.SessionManager
	githubOauthConfig    *oauth2.Config
	bitbucketOauthConfig *oauth2.Config
}

const providerGithub = "github"

// Bound the size of GitHub API response bodies before decoding
const maxGitHubResponseBytes = 8 * 1024 * 1024

// Safety cap for pagination (100 pages * 100 repos = 10000 repos)
const maxGitHubPages = 100

// ExternalAccountsRoutes initializes the external git accounts routes
func ExternalAccountsRoutes(pool *pgxpool.Pool, sm *session.SessionManager) chi.Router {
	// Initialize OAuth configs
	ghConfig := &oauth2.Config{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GITHUB_REDIRECT_URL"),
		Scopes:       []string{"repo", "user:email"},
		Endpoint:     github.Endpoint,
	}

	h := &ExternalAccountsHandler{
		dbPool:            pool,
		sessionMgr:        sm,
		githubOauthConfig: ghConfig,
	}

	// TODO: Initialize Bitbucket OAuth config similarly

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
		}
	}

	httpx.WriteJSON(w, http.StatusOK, sanitizedAccounts)
}

// providerLogin initiates the OAuth flow for a git provider
func (h *ExternalAccountsHandler) providerLogin(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != providerGithub {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+provider)
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

	url := h.githubOauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// providerCallback handles the OAuth callback from a git provider
func (h *ExternalAccountsHandler) providerCallback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != providerGithub {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+provider)
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
	token, err := h.githubOauthConfig.Exchange(r.Context(), code)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid or expired authorization code")
		return
	}

	// Fetch GitHub user info
	githubUser, err := fetchGitHubUserInfo(r.Context(), token.AccessToken)
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

	_, err = q.CreateExternalGitAccount(r.Context(), dal.CreateExternalGitAccountParams{
		UserID:         userID,
		Provider:       provider,
		ProviderUserID: strconv.FormatInt(githubUser.ID, 10),
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
	http.Redirect(w, r, redirectURL+"/settings/accounts?linked="+provider, http.StatusTemporaryRedirect)
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
	provider := chi.URLParam(r, "provider")
	if provider != providerGithub {
		httpx.WriteError(w, http.StatusNotImplemented, httpx.CodeNotImplemented, "Provider not supported: "+provider)
		return
	}

	userID, _ := middleware.CurrentUserID(r)
	q := dal.New(h.dbPool)

	account, err := q.GetExternalGitAccountByUserIDAndProvider(r.Context(), dal.GetExternalGitAccountByUserIDAndProviderParams{
		UserID:   userID,
		Provider: provider,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, httpx.CodeNotFound, "No account found for provider "+provider)
		return
	}

	if account.AccessToken == "" || (account.TokenExpiresAt != nil && account.TokenExpiresAt.Before(time.Now())) {
		// No refresh flow yet: the user must re-link the account
		httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "Empty access token or expired")
		return
	}

	// this should be under a layer to abstract providers' implementations
	repos, status, err := fetchGithubUserRepos(r.Context(), account.AccessToken)
	if err != nil {
		// 401/403 mean the stored token is no longer valid; without a
		// refresh flow the user must re-link the account
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			httpx.WriteError(w, http.StatusForbidden, httpx.CodeForbidden, "GitHub access token is invalid or revoked, please re-link your account")
			return
		}
		httpx.WriteInternalError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, repos)
}

// Helper functions

type GitHubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// newGitHubRequest creates an authenticated GET request against the GitHub API
func newGitHubRequest(ctx context.Context, url, accessToken string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "token "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")

	return req, nil
}

func fetchGitHubUserInfo(ctx context.Context, accessToken string) (*GitHubUser, error) {
	req, err := newGitHubRequest(ctx, "https://api.github.com/user", accessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user data: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user data: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("github API returned status: %d", resp.StatusCode)
	}

	var user GitHubUser
	err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&user)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to parse user data: %w", err)
	}

	return &user, nil
}

// TODO: GitHubRepo is the GitHub API mapping; define a dedicated response DTO later
type GitHubRepo struct {
	Id            int64  `json:"id"`
	NodeId        string `json:"node_id"`
	Name          string `json:"name"`      // ex: Hello-World
	FullName      string `json:"full_name"` // ex: octocat/Hello-World
	Private       bool   `json:"private"`
	HtmlUrl       string `json:"html_url"` // ex: https://github.com/octocat/Hello-World
	Description   string `json:"description"`
	Url           string `json:"url"` // ex: https://api.github.com/repos/octocat/Hello-World
	DefaultBranch string `json:"default_branch"`
}

// nextGitHubPage returns the URL of the next page from the response Link header,
// or "" when there are no more pages
func nextGitHubPage(resp *http.Response) string {
	link := resp.Header.Get("Link")
	if link == "" {
		return ""
	}

	for _, part := range strings.Split(link, ",") {
		for _, tag := range strings.Split(part, ";") {
			if strings.Contains(tag, `rel="next"`) {
				return strings.Trim(strings.Split(part, ";")[0], " \t<>")
			}
		}
	}

	return ""
}

// fetchGithubUserRepos fetches all repositories of the authenticated user across
// GitHub pagination. On a non-200 response the HTTP status is returned so the
// caller can distinguish invalid tokens from other failures.
func fetchGithubUserRepos(ctx context.Context, accessToken string) ([]GitHubRepo, int, error) {
	perPage := 100
	page := 1
	baseUrl := "https://api.github.com/user/repos"
	var repos []GitHubRepo
	reqUrl := fmt.Sprintf("%s?per_page=%d&page=%d", baseUrl, perPage, page)

	for {
		req, err := newGitHubRequest(ctx, reqUrl, accessToken)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to fetch user github repos: %w", err)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to fetch user github repos: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			// TODO: distinguish rate-limit (403 with X-RateLimit-Remaining: 0)
			// from invalid tokens without surfacing 429 for internal calls
			resp.Body.Close()
			return nil, resp.StatusCode, fmt.Errorf("github API returned status: %d", resp.StatusCode)
		}

		var res []GitHubRepo
		err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&res)
		resp.Body.Close()
		if err != nil {
			return nil, 0, fmt.Errorf("failed to parse user repos: %w", err)
		}

		repos = append(repos, res...)

		reqUrl = nextGitHubPage(resp)
		if reqUrl == "" {
			break
		}
		page++
		if page > maxGitHubPages {
			break
		}
	}

	return repos, 0, nil
}
