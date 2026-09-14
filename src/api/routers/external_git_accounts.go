package routers

import (
	"context"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/middleware"
	"grepdocs/api/session"
	"io"
	"net/http"
	"os"
	"strconv"
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

	// Delete external account
	r.Delete("/{id}", h.deleteExternalAccount)

	return r
}

// listExternalAccounts returns all external git accounts for the authenticated user
func (h *ExternalAccountsHandler) listExternalAccounts(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.CurrentUserId(r)
	ctx := context.Background()
	q := dal.New(h.dbPool)

	accounts, err := q.GetExternalGitAccountsByUserId(ctx, userID)
	if err != nil {
		http.Error(w, "Failed to fetch accounts: "+err.Error(), http.StatusInternalServerError)
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

	respondJSON(w, http.StatusOK, sanitizedAccounts)
}

// providerLogin initiates the OAuth flow for a git provider
func (h *ExternalAccountsHandler) providerLogin(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "github" {
		http.Error(w, "Provider not supported: "+provider, http.StatusNotImplemented)
		return
	}

	// Generate state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		http.Error(w, "Failed to generate state token", http.StatusInternalServerError)
		return
	}

	// Store state in cookie
	http.SetCookie(w, &http.Cookie{
		Name:     provider + "_oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		Secure:   os.Getenv("ENV") == "production",
		SameSite: http.SameSiteLaxMode,
	})

	url := h.githubOauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// providerCallback handles the OAuth callback from a git provider
func (h *ExternalAccountsHandler) providerCallback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "github" {
		http.Error(w, "Provider not supported: "+provider, http.StatusNotImplemented)
		return
	}

	userID, _ := middleware.CurrentUserId(r)

	// Verify state
	stateCookie, err := r.Cookie(provider + "_oauth_state")
	if err != nil {
		http.Error(w, "State cookie not found", http.StatusBadRequest)
		return
	}

	state := r.URL.Query().Get("state")
	if state == "" || state != stateCookie.Value {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     provider + "_oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Code not found in URL", http.StatusBadRequest)
		return
	}

	// Exchange code for token
	ctx := context.Background()
	token, err := h.githubOauthConfig.Exchange(ctx, code)
	if err != nil {
		http.Error(w, "Failed to exchange token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch GitHub user info
	githubUser, err := fetchGitHubUserInfo(token.AccessToken)
	if err != nil {
		http.Error(w, "Failed to fetch GitHub user: "+err.Error(), http.StatusInternalServerError)
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

	_, err = q.CreateExternalGitAccount(ctx, dal.CreateExternalGitAccountParams{
		UserID:         userID,
		Provider:       provider,
		ProviderUserID: strconv.FormatInt(githubUser.ID, 10),
		AccessToken:    token.AccessToken,
		RefreshToken:   refreshToken,
		TokenExpiresAt: &expiresAt,
	})

	if err != nil {
		http.Error(w, "Failed to link GitHub account: "+err.Error(), http.StatusInternalServerError)
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
	userID, _ := middleware.CurrentUserId(r)

	accountIDStr := chi.URLParam(r, "id")
	accountID, err := strconv.ParseInt(accountIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	ctx := context.Background()
	q := dal.New(h.dbPool)

	// Verify the account belongs to the user
	account, err := q.GetExternalGitAccountById(ctx, accountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	if account.UserID != userID {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Delete the account
	err = q.DeleteExternalGitAccount(ctx, accountID)
	if err != nil {
		http.Error(w, "Failed to delete account: "+err.Error(), http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"message": "External account unlinked successfully",
	})
}

// Helper functions

type GitHubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func fetchGitHubUserInfo(accessToken string) (*GitHubUser, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "token "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github API returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var user GitHubUser
	err = json.Unmarshal(body, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to parse user data: %w", err)
	}

	return &user, nil
}

// respondJSON is a helper to send JSON responses
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
