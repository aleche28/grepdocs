package routers

import (
	"encoding/json"
	"errors"
	"grepdocs/api/httpx"
	"grepdocs/api/providers"
	"net/http"
	"net/http/httptest"
	"testing"
)

// plainProvider implements providers.Provider but not providers.Installer
type plainProvider struct{ providers.Provider }

func TestInstallDetails(t *testing.T) {
	tests := []struct {
		name string
		prov providers.Provider
		want string // "" means nil details
	}{
		{name: "installer with slug", prov: providers.NewGitHub(providers.GitHubOptions{AppSlug: "grepdocs"}), want: "https://github.com/apps/grepdocs/installations/new"},
		{name: "installer without slug", prov: providers.NewGitHub(providers.GitHubOptions{})},
		{name: "not an installer", prov: plainProvider{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := installDetails(tc.prov)
			if tc.want == "" {
				if got != nil {
					t.Fatalf("installDetails() = %v, want nil", got)
				}
				return
			}
			if got["install_url"] != tc.want {
				t.Errorf("installDetails() = %v, want install_url %q", got, tc.want)
			}
		})
	}
}

func TestWriteProviderError(t *testing.T) {
	github := providers.NewGitHub(providers.GitHubOptions{AppSlug: "grepdocs"})

	tests := []struct {
		name          string
		err           error
		prov          providers.Provider
		authenticated bool
		wantHandled   bool
		wantStatus    int
		wantCode      string
		wantDetails   bool
	}{
		{name: "not found with token adds install link", err: providers.ErrNotFound, prov: github, authenticated: true, wantHandled: true, wantStatus: http.StatusNotFound, wantCode: httpx.CodeNotFound, wantDetails: true},
		{name: "not found anonymously", err: providers.ErrNotFound, prov: github, wantHandled: true, wantStatus: http.StatusNotFound, wantCode: httpx.CodeNotFound},
		{name: "not found, provider without installer", err: providers.ErrNotFound, prov: plainProvider{}, authenticated: true, wantHandled: true, wantStatus: http.StatusNotFound, wantCode: httpx.CodeNotFound},
		{name: "wrapped invalid token", err: errors.Join(errors.New("ctx"), providers.ErrInvalidToken), prov: github, authenticated: true, wantHandled: true, wantStatus: http.StatusForbidden, wantCode: httpx.CodeForbidden},
		{name: "rate limited", err: providers.ErrRateLimited, prov: github, authenticated: true, wantHandled: true, wantStatus: http.StatusTooManyRequests, wantCode: httpx.CodeRateLimited},
		{name: "unknown error", err: errors.New("boom"), prov: github, authenticated: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()

			handled := writeProviderError(rr, tc.err, tc.prov, tc.authenticated)
			if handled != tc.wantHandled {
				t.Fatalf("writeProviderError() = %v, want %v", handled, tc.wantHandled)
			}
			if !tc.wantHandled {
				if rr.Body.Len() != 0 {
					t.Errorf("unhandled error wrote a body: %s", rr.Body)
				}
				return
			}

			if rr.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tc.wantStatus)
			}
			var env struct {
				Error struct {
					Code    string         `json:"code"`
					Details map[string]any `json:"details"`
				} `json:"error"`
			}
			if err := json.NewDecoder(rr.Body).Decode(&env); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if env.Error.Code != tc.wantCode {
				t.Errorf("error.code = %q, want %q", env.Error.Code, tc.wantCode)
			}
			if gotDetails := env.Error.Details != nil; gotDetails != tc.wantDetails {
				t.Errorf("error.details = %v, want present = %v", env.Error.Details, tc.wantDetails)
			}
		})
	}
}
