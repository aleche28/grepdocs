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

func TestWriteErrorWithDetails(t *testing.T) {
	tests := []struct {
		name        string
		details     map[string]any
		wantDetails bool
	}{
		{name: "with details", details: map[string]any{"install_url": "https://example.com"}, wantDetails: true},
		{name: "nil details", details: nil},
		{name: "empty details", details: map[string]any{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()

			WriteErrorWithDetails(rr, http.StatusForbidden, CodeAppNotInstalled, "boom", tc.details)

			res := rr.Result()
			defer res.Body.Close()

			if res.StatusCode != http.StatusForbidden {
				t.Errorf("status = %d, want %d", res.StatusCode, http.StatusForbidden)
			}

			var env struct {
				Error map[string]any `json:"error"`
			}
			if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if env.Error["code"] != CodeAppNotInstalled || env.Error["message"] != "boom" {
				t.Errorf("error = %v, want code %q and message %q", env.Error, CodeAppNotInstalled, "boom")
			}

			details, ok := env.Error["details"].(map[string]any)
			switch {
			case tc.wantDetails && (!ok || details["install_url"] != "https://example.com"):
				t.Errorf("error.details = %v, want install_url", env.Error["details"])
			case !tc.wantDetails && env.Error["details"] != nil:
				t.Errorf("error.details = %v, want the key omitted", env.Error["details"])
			}
		})
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
