package httpx

import (
	"encoding/json"
	"log"
	"net/http"
)

const (
	CodeNotAuthenticated = "not_authenticated"
	CodeBadRequest       = "bad_request"
	CodeForbidden        = "forbidden"
	CodeNotFound         = "not_found"
	CodeConflict         = "conflict"
	CodeNotImplemented   = "not_implemented"
	CodeInternal         = "internal"
	CodeRateLimited      = "rate_limited"
	CodeAppNotInstalled  = "app_not_installed"
)

func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("httpx: failed to encode JSON response: %v", err)
	}
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteErrorWithDetails(w, status, code, message, nil)
}

func WriteInternalError(w http.ResponseWriter, err error) {
	log.Printf("internal error: %v", err)
	WriteError(w, http.StatusInternalServerError, CodeInternal, "An internal error occurred")
}

func WriteErrorWithDetails(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]map[string]any{
		"error": {
			"code":    code,
			"message": message,
		},
	}
	if len(details) != 0 {
		body["error"]["details"] = details
	}

	json.NewEncoder(w).Encode(body)
}
