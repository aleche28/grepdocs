package routers

import (
	"context"
	"encoding/json"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/models"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
)

var googleOauthConfig *oauth2.Config

func AuthRoutes(config *oauth2.Config) chi.Router {
	googleOauthConfig = config
	r := chi.NewRouter()
	r.Get("/whoami", whoAmI)
	r.Get("/google/login", googleLogin)
	r.Get("/google/callback", googleCallback)

	return r
}

func whoAmI(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("alessio"))
}

func googleLogin(w http.ResponseWriter, r *http.Request) {
	url := googleOauthConfig.AuthCodeURL("randomstate")
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

func googleCallback(w http.ResponseWriter, r *http.Request) {
	// Extract and compare state: should be the same as the sent one
	state := r.URL.Query().Get("state")
	if state != "randomstate" {
		http.Error(w, "Received state does not match the sent state value", http.StatusBadRequest)
		return
	}

	// Extract the authorization code from the URL
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Code not found in URL", http.StatusBadRequest)
		return
	}

	// Exchange the code for an access token
	token, err := googleOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		http.Error(w, "Failed to exchange token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + token.AccessToken)
	if err != nil {
		http.Error(w, "Failed to fetch user data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	defer resp.Body.Close()

	// Read the response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read response body: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var userInfo models.GoogleUserInfo
	err = json.Unmarshal(body, &userInfo)
	if err != nil {
		http.Error(w, "Failed to parse user data: "+err.Error(), http.StatusInternalServerError)
		return
	}

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))

	q := dal.New(pool)

	user, err := q.GetUserByGoogleId(ctx, userInfo.Id)
	if err != nil {
		// user does not exist: create it
		newUser, err := q.CreateUser(ctx, dal.CreateUserParams{
			Fullname:  userInfo.FullName,
			Email:     userInfo.Email,
			GoogleID:  userInfo.Id,
			CreatedAt: time.Now(),
		})
		if err != nil {
			http.Error(w, "Failed to create new user: "+err.Error(), http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, "User created successfully! Hello, %s", newUser.Email)
		return
	}

	// Successfully retrieved user info
	fmt.Fprintf(w, "Login successful! Hello, %s", user.Email)
}
