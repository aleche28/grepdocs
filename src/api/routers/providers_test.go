package routers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"grepdocs/api/providers"
)

// displayProvider has a name and display name but is not an Installer; the
// embedded interface is nil, so calling any other Provider method panics
type displayProvider struct {
	providers.Provider
	name, display string
}

func (p displayProvider) Name() string        { return p.name }
func (p displayProvider) DisplayName() string { return p.display }

func TestToProviderDTO(t *testing.T) {
	url := "https://github.com/apps/grepdocs/installations/new"

	tests := []struct {
		name string
		prov providers.Provider
		want providerDTO
	}{
		{
			name: "installer with url",
			prov: providers.NewGitHub(providers.GitHubOptions{AppSlug: "grepdocs"}),
			want: providerDTO{Name: "github", DisplayName: "GitHub", InstallURL: &url},
		},
		{
			name: "installer with empty url",
			prov: providers.NewGitHub(providers.GitHubOptions{}),
			want: providerDTO{Name: "github", DisplayName: "GitHub"},
		},
		{
			name: "not an installer",
			prov: displayProvider{name: "plain", display: "Plain"},
			want: providerDTO{Name: "plain", DisplayName: "Plain"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := toProviderDTO(tc.prov)
			if got.Name != tc.want.Name || got.DisplayName != tc.want.DisplayName {
				t.Errorf("toProviderDTO() = {%q, %q}, want {%q, %q}", got.Name, got.DisplayName, tc.want.Name, tc.want.DisplayName)
			}
			switch {
			case tc.want.InstallURL == nil && got.InstallURL != nil:
				t.Errorf("InstallURL = %q, want nil", *got.InstallURL)
			case tc.want.InstallURL != nil && (got.InstallURL == nil || *got.InstallURL != *tc.want.InstallURL):
				t.Errorf("InstallURL = %v, want %q", got.InstallURL, *tc.want.InstallURL)
			}
		})
	}
}

func TestListProviders(t *testing.T) {
	tests := []struct {
		name     string
		registry *providers.Registry
		wantBody string
	}{
		{
			name: "sorted by name, null install_url",
			registry: providers.NewRegistry(
				providers.NewGitHub(providers.GitHubOptions{AppSlug: "grepdocs"}),
				displayProvider{name: "bitbucket", display: "Bitbucket"},
			),
			wantBody: `[{"name":"bitbucket","display_name":"Bitbucket","install_url":null},` +
				`{"name":"github","display_name":"GitHub","install_url":"https://github.com/apps/grepdocs/installations/new"}]`,
		},
		{
			name:     "empty registry is an empty array",
			registry: providers.NewRegistry(),
			wantBody: `[]`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := &ProvidersHandler{providerRegistry: tc.registry}
			rec := httptest.NewRecorder()
			h.listProviders(rec, httptest.NewRequest(http.MethodGet, "/api/providers", nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}
			if got := rec.Body.String(); strings.TrimSuffix(got, "\n") != tc.wantBody {
				t.Errorf("body = %s\nwant   %s", got, tc.wantBody)
			}
		})
	}
}
