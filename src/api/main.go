package main

import (
	"grepdocs/api/routers"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type Config struct {
	GoogleLoginConfig oauth2.Config
}

var AppConfig Config

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}

	clientId := os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	redirectUrl := os.Getenv("GOOGLE_REDIRECT_URL")

	AppConfig.GoogleLoginConfig = oauth2.Config{
		ClientID:     clientId,
		ClientSecret: clientSecret,
		RedirectURL:  redirectUrl,
		Scopes: []string{
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
			"openid",
		},
		Endpoint: google.Endpoint,
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("pong"))
		})

		r.Mount("/auth", routers.AuthRoutes(&AppConfig.GoogleLoginConfig))
	})

	http.ListenAndServe(":3000", r)
}
