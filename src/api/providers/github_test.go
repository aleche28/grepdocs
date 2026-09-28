package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClassifyGitHubResponse(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		rateLimit  string
		wantErr    error
		wantAnyErr bool
	}{
		{name: "401 unauthorized is invalid token", status: http.StatusUnauthorized, wantErr: ErrInvalidToken},
		{name: "403 with exhausted rate limit is rate limited", status: http.StatusForbidden, rateLimit: "0", wantErr: ErrRateLimited},
		{name: "403 without rate limit is invalid token", status: http.StatusForbidden, rateLimit: "42", wantErr: ErrInvalidToken},
		{name: "429 is rate limited", status: http.StatusTooManyRequests, wantErr: ErrRateLimited},
		{name: "500 is generic error", status: http.StatusInternalServerError, wantAnyErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := &http.Response{StatusCode: tc.status, Header: http.Header{}}
			if tc.rateLimit != "" {
				res.Header.Set("X-RateLimit-Remaining", tc.rateLimit)
			}

			err := classifyGitHubResponse(res)
			switch {
			case tc.wantErr != nil:
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("classifyGitHubResponse() = %v, want %v", err, tc.wantErr)
				}
			case tc.wantAnyErr:
				if err == nil {
					t.Fatal("classifyGitHubResponse() = nil, want error")
				}
				if errors.Is(err, ErrInvalidToken) || errors.Is(err, ErrRateLimited) {
					t.Fatalf("classifyGitHubResponse() = %v, want generic error", err)
				}
			}
		})
	}
}

func TestNextGitHubPage(t *testing.T) {
	tests := []struct {
		name string
		link string
		want string
	}{
		{name: "no header", link: "", want: ""},
		{
			name: "next present",
			link: `<https://api.github.com/user/repos?page=2>; rel="next"`,
			want: "https://api.github.com/user/repos?page=2",
		},
		{
			name: "next among several",
			link: `<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=9>; rel="last"`,
			want: "https://api.github.com/user/repos?page=2",
		},
		{
			name: "last only",
			link: `<https://api.github.com/user/repos?page=9>; rel="last"`,
			want: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := &http.Response{Header: http.Header{}}
			if tc.link != "" {
				res.Header.Set("Link", tc.link)
			}
			if got := nextGitHubPage(res); got != tc.want {
				t.Errorf("nextGitHubPage() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestToRepositories(t *testing.T) {
	got := toRepositories([]githubRepo{{
		ID:            7,
		Name:          "hello-world",
		FullName:      "octocat/hello-world",
		Private:       true,
		HTMLURL:       "https://github.com/octocat/hello-world",
		DefaultBranch: "main",
	}})

	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}

	want := Repository{
		Provider:       GitHub,
		ProviderRepoID: "7",
		Name:           "hello-world",
		FullName:       "octocat/hello-world",
		IsPrivate:      true,
		HTMLURL:        "https://github.com/octocat/hello-world",
		DefaultBranch:  "main",
	}
	if got[0] != want {
		t.Errorf("toRepositories() = %+v, want %+v", got[0], want)
	}
}

func TestFetchUser(t *testing.T) {
	t.Run("happy path", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "token tok" {
				t.Errorf("Authorization = %q, want %q", got, "token tok")
			}
			if r.URL.Path != "/user" {
				t.Errorf("path = %q, want /user", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"id":12345,"login":"octocat","email":"octo@example.com","name":"Mona"}`)
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		user, err := gh.FetchUser(context.Background(), "tok")
		if err != nil {
			t.Fatalf("FetchUser: %v", err)
		}

		want := User{ProviderUserID: "12345", Login: "octocat", Email: "octo@example.com", Name: "Mona"}
		if user != want {
			t.Errorf("FetchUser() = %+v, want %+v", user, want)
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		if _, err := gh.FetchUser(context.Background(), "tok"); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("FetchUser() = %v, want %v", err, ErrInvalidToken)
		}
	})

	t.Run("malformed json", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{not json`)
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		if _, err := gh.FetchUser(context.Background(), "tok"); err == nil {
			t.Fatal("FetchUser() = nil, want decode error")
		}
	})
}

func TestListRepositories(t *testing.T) {
	t.Run("paginates", func(t *testing.T) {
		var pages []string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			page := r.URL.Query().Get("page")
			pages = append(pages, page)
			w.Header().Set("Content-Type", "application/json")

			switch page {
			case "1":
				w.Header().Set("Link", `<`+srvURL(r)+`/user/repos?per_page=100&page=2>; rel="next"`)
				io.WriteString(w, `[{"id":1,"name":"one","full_name":"o/one","default_branch":"main"}]`)
			case "2":
				io.WriteString(w, `[{"id":2,"name":"two","full_name":"o/two","default_branch":"main"}]`)
			default:
				t.Errorf("unexpected page %q", page)
			}
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		repos, err := gh.ListRepositories(context.Background(), "tok")
		if err != nil {
			t.Fatalf("ListRepositories: %v", err)
		}

		if len(repos) != 2 {
			t.Fatalf("len(repos) = %d, want 2", len(repos))
		}
		if repos[0].ProviderRepoID != "1" || repos[1].ProviderRepoID != "2" {
			t.Errorf("repos = %+v, want ids 1 and 2", repos)
		}
		if len(pages) != 2 || pages[0] != "1" || pages[1] != "2" {
			t.Errorf("requested pages = %v, want [1 2]", pages)
		}
	})

	t.Run("rate limited", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		if _, err := gh.ListRepositories(context.Background(), "tok"); !errors.Is(err, ErrRateLimited) {
			t.Fatalf("ListRepositories() = %v, want %v", err, ErrRateLimited)
		}
	})

	t.Run("malformed json", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{not json`)
		}))
		defer srv.Close()

		gh := NewGitHub(GitHubOptions{BaseURL: srv.URL, HTTPClient: srv.Client()})
		if _, err := gh.ListRepositories(context.Background(), "tok"); err == nil {
			t.Fatal("ListRepositories() = nil, want decode error")
		}
	})
}

func TestExchange(t *testing.T) {
	const (
		accessTTL  = 8 * time.Hour
		refreshTTL = 15897600 * time.Second // ~6 months
	)

	// newTokenServer fakes GitHub's OAuth token endpoint, answering every request with the given
	// content type and body
	newTokenServer := func(t *testing.T, contentType, body string) *httptest.Server {
		t.Helper()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/login/oauth/access_token" {
				t.Errorf("request = %s %s, want POST /login/oauth/access_token", r.Method, r.URL.Path)
			}
			if err := r.ParseForm(); err != nil {
				t.Errorf("ParseForm: %v", err)
			}
			if got := r.PostForm.Get("grant_type"); got != "authorization_code" {
				t.Errorf("grant_type = %q, want authorization_code", got)
			}
			if got := r.PostForm.Get("code"); got != "the-code" {
				t.Errorf("code = %q, want the-code", got)
			}
			w.Header().Set("Content-Type", contentType)
			io.WriteString(w, body)
		}))
		t.Cleanup(srv.Close)
		return srv
	}

	exchange := func(t *testing.T, srv *httptest.Server) (Token, error) {
		t.Helper()
		gh := NewGitHub(GitHubOptions{
			ClientID:     "client-id",
			ClientSecret: "client-secret",
			HTTPClient:   srv.Client(),
			TokenURL:     srv.URL + "/login/oauth/access_token",
		})
		return gh.Exchange(context.Background(), "the-code")
	}

	// GitHub answers form-encoded unless the client sends Accept: application/json, which oauth2
	// does not: expires_in is then only reflected in Expiry, and Extra returns int64 values
	t.Run("form-encoded response with expiring tokens", func(t *testing.T) {
		srv := newTokenServer(t, "application/x-www-form-urlencoded",
			"access_token=ghu_access&expires_in=28800&refresh_token=ghr_refresh"+
				"&refresh_token_expires_in=15897600&token_type=bearer&scope=")

		before := time.Now()
		tok, err := exchange(t, srv)
		after := time.Now()
		if err != nil {
			t.Fatalf("Exchange: %v", err)
		}

		if tok.AccessToken != "ghu_access" || tok.RefreshToken != "ghr_refresh" {
			t.Errorf("tokens = %q/%q, want ghu_access/ghr_refresh", tok.AccessToken, tok.RefreshToken)
		}
		assertExpiresIn(t, "Expiry", tok.Expiry, before, after, accessTTL)
		assertExpiresIn(t, "RefreshExpiry", tok.RefreshExpiry, before, after, refreshTTL)
	})

	// With a JSON body, Extra returns float64 values
	t.Run("json response with expiring tokens", func(t *testing.T) {
		srv := newTokenServer(t, "application/json",
			`{"access_token":"ghu_access","expires_in":28800,"refresh_token":"ghr_refresh",`+
				`"refresh_token_expires_in":15897600,"token_type":"bearer","scope":""}`)

		before := time.Now()
		tok, err := exchange(t, srv)
		after := time.Now()
		if err != nil {
			t.Fatalf("Exchange: %v", err)
		}

		assertExpiresIn(t, "Expiry", tok.Expiry, before, after, accessTTL)
		assertExpiresIn(t, "RefreshExpiry", tok.RefreshExpiry, before, after, refreshTTL)
	})

	// Token expiration opted out in the app settings: no expires_in, no refresh token
	t.Run("non-expiring token", func(t *testing.T) {
		srv := newTokenServer(t, "application/x-www-form-urlencoded",
			"access_token=ghu_access&token_type=bearer&scope=")

		tok, err := exchange(t, srv)
		if err != nil {
			t.Fatalf("Exchange: %v", err)
		}

		if tok.Expiry != nil {
			t.Errorf("Expiry = %v, want nil", *tok.Expiry)
		}
		if tok.RefreshToken != "" {
			t.Errorf("RefreshToken = %q, want empty", tok.RefreshToken)
		}
		if tok.RefreshExpiry != nil {
			t.Errorf("RefreshExpiry = %v, want nil", *tok.RefreshExpiry)
		}
	})

	// GitHub reports a bad or reused code with a 200 status and an error in the body
	t.Run("error in 200 response", func(t *testing.T) {
		srv := newTokenServer(t, "application/x-www-form-urlencoded",
			"error=bad_verification_code&error_description=The+code+passed+is+incorrect+or+expired.")

		if _, err := exchange(t, srv); err == nil {
			t.Fatal("Exchange() = nil, want error")
		}
	})
}

// assertExpiresIn checks that got is set and lies within ttl of the [before, after] window in
// which the token was issued
func assertExpiresIn(t *testing.T, name string, got *time.Time, before, after time.Time, ttl time.Duration) {
	t.Helper()
	if got == nil {
		t.Errorf("%s = nil, want ~now+%s", name, ttl)
		return
	}
	if got.Before(before.Add(ttl)) || got.After(after.Add(ttl)) {
		t.Errorf("%s = %v, want between %v and %v", name, *got, before.Add(ttl), after.Add(ttl))
	}
}

// srvURL reconstructs the base URL of the request's server from its Host header.
func srvURL(r *http.Request) string {
	return "http://" + r.Host
}
