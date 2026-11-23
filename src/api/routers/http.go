package routers

import (
	"net/http"
	"os"
	"time"
)

// shared client for outbound calls
var httpClient = &http.Client{Timeout: 10 * time.Second}

// frontendURL is the UI origin the OAuth flows redirect back to
func frontendURL() string {
	if u := os.Getenv("FRONTEND_URL"); u != "" {
		return u
	}
	return "http://localhost:5173" // default for development
}
