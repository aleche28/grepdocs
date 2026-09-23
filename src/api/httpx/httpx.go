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
)

func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("httpx: failed to encode JSON response: %v", err)
	}
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func WriteInternalError(w http.ResponseWriter, err error) {
	log.Printf("internal error: %v", err)
	WriteError(w, http.StatusInternalServerError, CodeInternal, "An internal error occurred")
}
