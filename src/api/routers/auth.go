package routers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/models"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
)

var (
	googleOauthConfig *oauth2.Config
	dbPool            *pgxpool.Pool
)

// AuthRoutes initializes the authentication routes
func AuthRoutes(config *oauth2.Config, pool *pgxpool.Pool) chi.Router {
	googleOauthConfig = config
	dbPool = pool

	r := chi.NewRouter()

	r.Get("/whoami", whoAmI)
	r.Get("/google/login", googleLogin)
	r.Get("/google/callback", googleCallback)
	r.Post("/logout", logout)

	return r
}

// whoAmI returns the current authenticated user information
func whoAmI(w http.ResponseWriter, r *http.Request) {
	// Get user ID from session/context
	userIDStr := getUserIDFromSession(r)
	if userIDStr == "" {
		http.Error(w, "Not authenticated", http.StatusUnauthorized)
		return
	}

	userID, err := strconv.ParseInt(userIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	ctx := context.Background()
	q := dal.New(dbPool)

	user, err := q.GetUserById(ctx, userID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":       user.ID,
		"email":    user.Email,
		"fullname": user.Fullname,
		"username": user.Username,
	})
}

// googleLogin initiates the Google OAuth flow
func googleLogin(w http.ResponseWriter, r *http.Request) {
	// Generate a random state token for CSRF protection
	state, err := generateStateToken()
	if err != nil {
		http.Error(w, "Failed to generate state token", http.StatusInternalServerError)
		return
	}

	// Store state in session/cookie for verification in callback
	// For now, using a cookie
	// TODO: use a proper session store in production
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		Secure:   os.Getenv("ENV") == "production", // Only secure in production
		SameSite: http.SameSiteLaxMode,
	})

	url := googleOauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// googleCallback handles the OAuth callback from Google
func googleCallback(w http.ResponseWriter, r *http.Request) {
	// Get state from cookie
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil {
		http.Error(w, "State cookie not found", http.StatusBadRequest)
		return
	}

	// Extract and compare state
	state := r.URL.Query().Get("state")
	if state == "" || state != stateCookie.Value {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Clear the state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	// Extract the authorization code from the URL
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Code not found in URL", http.StatusBadRequest)
		return
	}

	// Exchange the code for an access token
	ctx := context.Background()
	token, err := googleOauthConfig.Exchange(ctx, code)
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
	q := dal.New(dbPool)
	user, err := q.GetUserByGoogleId(ctx, userInfo.Id)

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
		fmt.Printf("Failed to update last login for user %s: %v\n", user.ID, err)
	}

	// Create session for the user
	err = createUserSession(w, r, user.ID)
	if err != nil {
		http.Error(w, "Failed to create session: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to dashboard/home page
	redirectURL := os.Getenv("FRONTEND_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:3000" // Default for development
	}
	http.Redirect(w, r, redirectURL+"/homepage", http.StatusTemporaryRedirect)
}

// logout handles user logout
func logout(w http.ResponseWriter, r *http.Request) {
	// Clear the session
	destroyUserSession(w, r)

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
	resp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + accessToken)
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

// Session management functions (placeholder implementations)
// You should replace these with a proper session management library like gorilla/sessions

func createUserSession(w http.ResponseWriter, r *http.Request, userID int64) error {
	// TODO: Implement proper session management
	// For now, using a simple cookie (NOT SECURE FOR PRODUCTION)
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    strconv.FormatInt(userID, 10), // TODO: In production, use a random session ID that maps to user ID
		Path:     "/",
		MaxAge:   86400 * 7, // 7 days
		HttpOnly: true,
		Secure:   os.Getenv("ENV") == "production",
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

func destroyUserSession(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement proper session destruction
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}

func getUserIDFromSession(r *http.Request) string {
	// TODO: Implement proper session retrieval
	cookie, err := r.Cookie("session_id")
	if err != nil {
		return ""
	}
	return cookie.Value
}
