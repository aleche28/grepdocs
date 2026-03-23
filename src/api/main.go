package main

import (
	"context"
	"grepdocs/api/routers"
	"grepdocs/api/session"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
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

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Unable to create database pool: %v", err)
	}
	defer pool.Close()

	// TODO: maybe in the future migrate to "github.com/alexedwards/scs/v2" to manage session
	rss := session.NewRedisSessionStore(
		"redis:6379",
		"",
		1*time.Hour,
		12*time.Hour,
	)

	// Credits: https://themsaid.com/building-secure-session-manager-in-go
	sm := session.NewSessionManager(
		rss,
		30*time.Hour,
		1*time.Hour,
		12*time.Hour,
		"session",
	)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("pong"))
		})

		r.Mount("/auth", routers.AuthRoutes(&AppConfig.GoogleLoginConfig, pool, sm))
		r.Mount("/users", routers.UserRoutes(pool, sm))
		r.Mount("/ext-accounts", routers.ExternalAccountsRoutes(pool, sm))
	})

	server := &http.Server{
		Addr:    ":3000",
		Handler: sm.Handle(r),
	}

	log.Fatal(server.ListenAndServe())
}
