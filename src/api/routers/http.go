package routers

import (
	"net/http"
	"os"
	"strings"
	"time"
)

// shared client for outbound calls
var httpClient = &http.Client{Timeout: 10 * time.Second}

// frontendURL is the UI origin the OAuth flows redirect back to, without a
// trailing slash: callers append a path that starts with /, and a // would not
// match any UI route
func frontendURL() string {
	if u := strings.TrimRight(os.Getenv("FRONTEND_URL"), "/"); u != "" {
		return u
	}
	return "http://localhost:5173" // default for development
}
