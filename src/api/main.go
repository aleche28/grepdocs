package main

import (
	"context"
	"encoding/base64"
	"errors"
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

	"grepdocs/api/credentials"
	"grepdocs/api/providers"
	"grepdocs/api/reposync"
	"grepdocs/api/routers"
	"grepdocs/api/secrets"
	"grepdocs/api/session"
	"grepdocs/api/syncqueue"
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

	encKey, err := base64.StdEncoding.DecodeString(os.Getenv("TOKEN_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatalf("TOKEN_ENCRYPTION_KEY must be base64-encoded: %v", err)
	}

	tokenCipher, err := secrets.NewAESGCMCipher(encKey)
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

	isProduction := os.Getenv("ENV") == "production"

	// Credits: https://themsaid.com/building-secure-session-manager-in-go
	sm := session.NewSessionManager(
		rss,
		30*time.Hour,
		1*time.Hour,
		12*time.Hour,
		"session",
		isProduction, // Secure cookie only in production, where the API is served over HTTPS
	)

	registry := providers.NewRegistry(providers.NewGitHub(providers.GitHubOptions{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GITHUB_REDIRECT_URL"),
		AppSlug:      os.Getenv("GITHUB_APP_SLUG"),
	}))

	credSvc := credentials.New(pool, tokenCipher, registry)
	syncSvc := reposync.New(pool, credSvc, registry)
	syncPool := syncqueue.New(syncSvc)

	// Graceful shutdown on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	syncPool.Start(ctx)

	ids, err := syncSvc.ResetStuck(ctx)
	if err != nil {
		log.Printf("reset stuck repo sync, continuing without reset: %v", err)
	} else {
		// in a goroutine to avoid slowing down the server start:
		// rare scenario where queue size is decreased between restarts
		// and it was full at shutdown, which would cause the EnqueueWait
		// to actually wait, blocking the thread before calling ListenAndServe
		go func() {
			for _, id := range ids {
				if err := syncPool.EnqueueWait(ctx, id); err != nil {
					//nolint:gosec // G706: id is an int64 from the database
					log.Printf("re-enqueue repo %d: %v", id, err)
					return // ctx cancelled: the rest stay queued, the next startup resets them
				}
			}
		}()
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte("pong")) // a failed write means the client is gone
		})

		r.Mount("/auth", routers.AuthRoutes(&AppConfig.GoogleLoginConfig, pool, sm))
		r.Mount("/users", routers.UserRoutes(pool, sm))
		r.Mount("/accounts", routers.ExternalAccountsRoutes(pool, sm, registry, tokenCipher, credSvc))
		r.Mount("/repositories", routers.RepositoriesRoutes(pool, sm, registry, credSvc, syncPool))

		// Swagger UI for local testing; it calls the API with the browser's session cookie
		if !isProduction {
			r.Mount("/docs", routers.DocsRoutes())
		}
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
		log.Printf("Graceful shutdown failed: %v", err)
	}

	syncPool.Shutdown()
}
