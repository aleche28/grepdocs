package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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

// srvURL reconstructs the base URL of the request's server from its Host header.
func srvURL(r *http.Request) string {
	return "http://" + r.Host
}
