package routers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/httpx"
	"grepdocs/api/models"
	"grepdocs/api/session"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
)

type AuthHandler struct {
	oauthConfig *oauth2.Config
	dbPool      *pgxpool.Pool
	sessionMgr  *session.SessionManager
}

// AuthRoutes initializes the authentication routes
func AuthRoutes(config *oauth2.Config, pool *pgxpool.Pool, sm *session.SessionManager) chi.Router {
	h := &AuthHandler{
		oauthConfig: config,
		dbPool:      pool,
		sessionMgr:  sm,
	}

	r := chi.NewRouter()

	r.Get("/google/login", h.googleLogin)
	r.Get("/google/callback", h.googleCallback)
	r.Post("/logout", h.logout)

	return r
}

// googleLogin initiates the Google OAuth flow
func (h *AuthHandler) googleLogin(w http.ResponseWriter, r *http.Request) {
	// TODO: here add the option to specify the redirect URL as a query parameter,
	// and validate it against a whitelist of allowed URLs to prevent open redirect vulnerabilities
	// Generate a random state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Store state in session for verification in callback
	sess, _ := session.GetSession(h.sessionMgr, r)
	sess.SetOAuthStateToken(state)
	sess.SetUIRedirectPage("/")

	// offline to get a refresh token for long-term access
	url := h.oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// googleCallback handles the OAuth callback from Google
func (h *AuthHandler) googleCallback(w http.ResponseWriter, r *http.Request) {
	// Get state from session
	sess, _ := session.GetSession(h.sessionMgr, r)
	oauthState := sess.GetOAuthStateToken()
	if oauthState == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Oauth state token not found in session")
		return
	}

	// Extract and compare state
	state := r.URL.Query().Get("state")
	if state == "" || state != oauthState {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid state parameter")
		return
	}

	// Extract the authorization code from the URL
	code := r.URL.Query().Get("code")
	if code == "" {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Code not found in URL")
		return
	}

	// Exchange the code for an access token
	token, err := h.oauthConfig.Exchange(r.Context(), code)
	if err != nil {
		log.Printf("oauth token exchange failed: %v", err)
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid or expired authorization code")
		return
	}

	// Fetch user info from Google
	userInfo, err := fetchGoogleUserInfo(r.Context(), token.AccessToken)
	if err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	// Get or create user in database
	q := dal.New(h.dbPool)
	user, err := q.GetUserByGoogleId(r.Context(), userInfo.Id)
	// TODO: fix this because if the error is not "not found", it still tries to create the user,
	// even if it might already exist
	if err != nil {
		// User does not exist: create it
		user, err = q.CreateUser(r.Context(), dal.CreateUserParams{
			Fullname: userInfo.FullName,
			Email:    userInfo.Email,
			GoogleID: userInfo.Id,
		})
		if err != nil {
			httpx.WriteInternalError(w, err)
			return
		}
	}

	// Update last login timestamp
	err = q.UpdateUserLastLogin(r.Context(), user.ID)
	if err != nil {
		// Log error but don't fail the login
		fmt.Printf("Failed to update last login for user %d: %v\n", user.ID, err)
	}

	// authenticate user and save id in session
	sess.SetUserID(user.ID)

	// Regenerate session ID to prevent fixation
	if err := h.sessionMgr.Regenerate(r.Context(), sess); err != nil {
		httpx.WriteInternalError(w, err)
		return
	}

	redirectPath := sess.GetUIRedirectPage()
	if !isValidRedirectPath(redirectPath) {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "Invalid UI redirect path: "+redirectPath)
		return
	}

	redirectURL := os.Getenv("FRONTEND_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:3000" // Default for development
	}
	http.Redirect(w, r, redirectURL+redirectPath, http.StatusTemporaryRedirect)
}

// logout handles user logout
func (h *AuthHandler) logout(w http.ResponseWriter, r *http.Request) {
	session, ok := session.GetSession(h.sessionMgr, r)
	if ok {
		h.sessionMgr.Destroy(r.Context(), session)
		http.SetCookie(w, h.sessionMgr.ClearCookie())
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "Logged out successfully",
	})
}

// Helper functions

// generateStateToken generates a random state token for CSRF protection
func generateStateToken() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// fetchGoogleUserInfo fetches user information from Google using the access token
func fetchGoogleUserInfo(ctx context.Context, accessToken string) (*models.GoogleUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user data: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google API returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	var userInfo models.GoogleUserInfo
	err = json.Unmarshal(body, &userInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to parse user data: %w", err)
	}

	return &userInfo, nil
}

func isValidRedirectPath(path string) bool {
	// Must start with / and not contain //
	return strings.HasPrefix(path, "/") && !strings.Contains(path, "//")
}
