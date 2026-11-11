package routers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"grepdocs/api/httpx"
)

// parsePositiveID parses s as a database ID: a base-10 int64 greater than zero.
func parsePositiveID(s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, err
	}
	if id <= 0 {
		return 0, errors.New("id must be positive")
	}
	return id, nil
}

// parseIDParam reads and parses the {id} URL param, writing a 400 on failure.
func parseIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := parsePositiveID(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.CodeBadRequest, "invalid id param")
		return 0, false
	}
	return id, true
}
