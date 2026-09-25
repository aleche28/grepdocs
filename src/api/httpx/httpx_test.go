package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type errorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()

	WriteJSON(rr, http.StatusCreated, map[string]string{"hello": "world"})

	res := rr.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusCreated)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var got map[string]string
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got["hello"] != "world" {
		t.Errorf("body = %v, want hello=world", got)
	}
}

func TestWriteError(t *testing.T) {
	rr := httptest.NewRecorder()

	WriteError(rr, http.StatusBadRequest, CodeBadRequest, "boom")

	res := rr.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusBadRequest)
	}

	var env errorEnvelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if env.Error.Code != CodeBadRequest {
		t.Errorf("error.code = %q, want %q", env.Error.Code, CodeBadRequest)
	}
	if env.Error.Message != "boom" {
		t.Errorf("error.message = %q, want %q", env.Error.Message, "boom")
	}
}

func TestWriteInternalErrorDoesNotLeakDetails(t *testing.T) {
	rr := httptest.NewRecorder()

	secret := "connection string: user=admin password=hunter2"
	WriteInternalError(rr, errString(secret))

	res := rr.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", res.StatusCode, http.StatusInternalServerError)
	}

	var env errorEnvelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if env.Error.Code != CodeInternal {
		t.Errorf("error.code = %q, want %q", env.Error.Code, CodeInternal)
	}
	if strings.Contains(env.Error.Message, secret) {
		t.Errorf("error.message leaked internal details: %q", env.Error.Message)
	}
}

type errString string

func (e errString) Error() string { return string(e) }
