package routers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/models"
	"grepdocs/api/session"
	"io"
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

	r.Get("/whoami", h.whoAmI)
	r.Get("/google/login", h.googleLogin)
	r.Get("/google/callback", h.googleCallback)
	r.Post("/logout", h.logout)

	return r
}

// whoAmI returns the current authenticated user information
func (h *AuthHandler) whoAmI(w http.ResponseWriter, r *http.Request) {
	session := session.GetSession(h.sessionMgr, r)
	if !session.IsAuthenticated() {
		http.Error(w, "Not authenticated", http.StatusUnauthorized)
		return
	}

	uid := session.GetUserId()
	ctx := context.Background()
	q := dal.New(h.dbPool)

	user, err := q.GetUserById(ctx, uid)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":       user.ID,
		"email":    user.Email,
		"fullname": user.Fullname,
		"username": user.Username,
	})
}

// googleLogin initiates the Google OAuth flow
func (h *AuthHandler) googleLogin(w http.ResponseWriter, r *http.Request) {
	// TODO: here add the option to specify the redirect URL as a query parameter,
	// and validate it against a whitelist of allowed URLs to prevent open redirect vulnerabilities
	// Generate a random state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		http.Error(w, "Failed to generate state token", http.StatusInternalServerError)
		return
	}

	// Store state in session for verification in callback
	session := session.GetSession(h.sessionMgr, r)
	session.SetOAuthStateToken(state)
	session.SetUIRedirectPage("/")

	// offline to get a refresh token for long-term access
	url := h.oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// googleCallback handles the OAuth callback from Google
func (h *AuthHandler) googleCallback(w http.ResponseWriter, r *http.Request) {
	// Get state from session
	session := session.GetSession(h.sessionMgr, r)
	oauthState := session.GetOAuthStateToken()
	if oauthState == "" {
		http.Error(w, "Oauth state token not found in session", http.StatusBadRequest)
		return
	}

	// Extract and compare state
	state := r.URL.Query().Get("state")
	if state == "" || state != oauthState {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Extract the authorization code from the URL
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Code not found in URL", http.StatusBadRequest)
		return
	}

	// Exchange the code for an access token
	ctx := context.Background()
	token, err := h.oauthConfig.Exchange(ctx, code)
	if err != nil {
		http.Error(w, "Failed to exchange token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch user info from Google
	userInfo, err := fetchGoogleUserInfo(token.AccessToken)
	if err != nil {
		http.Error(w, "Failed to fetch user data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get or create user in database
	q := dal.New(h.dbPool)
	user, err := q.GetUserByGoogleId(ctx, userInfo.Id)

	// TODO: fix this because if the error is not "not found", it still tries to create the user,
	// even if it might already exist
	if err != nil {
		// User does not exist: create it
		user, err = q.CreateUser(ctx, dal.CreateUserParams{
			Fullname: userInfo.FullName,
			Email:    userInfo.Email,
			GoogleID: userInfo.Id,
		})
		if err != nil {
			http.Error(w, "Failed to create new user: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Update last login timestamp
	err = q.UpdateUserLastLogin(ctx, user.ID)
	if err != nil {
		// Log error but don't fail the login
		fmt.Printf("Failed to update last login for user %d: %v\n", user.ID, err)
	}

	// authenticate user and save id in session
	session.SetUserId(user.ID)

	// Regenerate session ID to prevent fixation
	if err := h.sessionMgr.Migrate(ctx, session); err != nil {
		http.Error(w, "Session error", http.StatusInternalServerError)
		return
	}

	redirectPath := session.GetUIRedirectPage()
	if !isValidRedirectPath(redirectPath) {
		http.Error(w, "Invalid UI redirect path: "+redirectPath, http.StatusBadRequest)
	}

	redirectURL := os.Getenv("FRONTEND_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:3000" // Default for development
	}
	http.Redirect(w, r, redirectURL+redirectPath, http.StatusTemporaryRedirect)
}

// logout handles user logout
func (h *AuthHandler) logout(w http.ResponseWriter, r *http.Request) {
	session.GetSession(h.sessionMgr, r).SetUserId(-1)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
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
func fetchGoogleUserInfo(accessToken string) (*models.GoogleUserInfo, error) {
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
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
