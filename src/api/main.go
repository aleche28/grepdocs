package main

import (
	"context"
	"errors"
	"grepdocs/api/providers"
	"grepdocs/api/routers"
	"grepdocs/api/secrets"
	"grepdocs/api/session"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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

	enckey := os.Getenv("TOKEN_ENCRYPTION_KEY")
	if enckey == "" {
		log.Fatal("TOKEN_ENCRYPTION_KEY is not set")
	}

	tokenCipher, err := secrets.NewAESGCMCipher(enckey)
	if err != nil {
		log.Fatal(err)
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

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379" // Default for development
	}

	// TODO: maybe in the future migrate to "github.com/alexedwards/scs/v2" to manage session
	rss := session.NewRedisSessionStore(
		redisAddr,
		"",
		1*time.Hour,
		12*time.Hour,
	)

	// Credits: https://themsaid.com/building-secure-session-manager-in-go
	secureCookie := os.Getenv("ENV") == "production"
	sm := session.NewSessionManager(
		rss,
		30*time.Hour,
		1*time.Hour,
		12*time.Hour,
		"session",
		secureCookie,
	)

	registry := providers.NewRegistry(providers.NewGitHub(providers.GitHubOptions{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GITHUB_REDIRECT_URL"),
	}))

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
		r.Mount("/accounts", routers.ExternalAccountsRoutes(pool, sm, registry, tokenCipher))
	})

	// about timeouts: https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/#httplistenandserve-is-doing-it-wrong
	server := &http.Server{
		Addr:              ":3000",
		Handler:           sm.Handle(r),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Graceful shutdown failed: %v", err)
	}
}
