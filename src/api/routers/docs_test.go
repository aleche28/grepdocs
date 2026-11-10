package routers

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"grepdocs/api/openapi"
)

// newDocsServer mounts DocsRoutes the way main.go does, so specPath is checked against the mount
func newDocsServer() http.Handler {
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Mount("/docs", DocsRoutes())
	})
	return r
}

func TestDocsRoutes(t *testing.T) {
	tests := []struct {
		name        string
		path        string
		contentType string
		wantBody    func(body []byte) bool
	}{
		{
			name:        "swagger ui",
			path:        "/api/docs",
			contentType: "text/html; charset=utf-8",
			wantBody:    func(b []byte) bool { return strings.Contains(string(b), `url: "`+specPath+`"`) },
		},
		{
			name:        "swagger ui with trailing slash",
			path:        "/api/docs/",
			contentType: "text/html; charset=utf-8",
			wantBody:    func(b []byte) bool { return strings.Contains(string(b), "SwaggerUIBundle") },
		},
		{
			name:        "spec",
			path:        specPath,
			contentType: "application/yaml",
			wantBody:    func(b []byte) bool { return bytes.Equal(b, openapi.Spec) },
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			newDocsServer().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, tc.path, nil))

			res := rr.Result()
			defer res.Body.Close()

			if res.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusOK)
			}
			if ct := res.Header.Get("Content-Type"); ct != tc.contentType {
				t.Errorf("Content-Type = %q, want %q", ct, tc.contentType)
			}
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			if !tc.wantBody(body) {
				t.Errorf("unexpected body: %.200s", body)
			}
		})
	}
}

func TestEmbeddedSpec(t *testing.T) {
	if !bytes.HasPrefix(openapi.Spec, []byte("openapi: 3.1")) {
		t.Errorf("embedded spec does not start with an OpenAPI 3.1 version: %.40q", openapi.Spec)
	}
}
