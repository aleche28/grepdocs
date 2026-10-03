package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const GitHub = "github"

// Bound the size of GitHub API response bodies before decoding
const maxGitHubResponseBytes = 8 * 1024 * 1024

// Safety cap for pagination (100 pages * 100 repos = 10000 repos)
const maxGitHubPages = 100

type GitHubOptions struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	HTTPClient   *http.Client
	BaseURL      string
	// TokenURL overrides GitHub's OAuth token endpoint (used by tests)
	TokenURL string
}

type GitHubProvider struct {
	options      GitHubOptions
	oauth2Config *oauth2.Config
}

// compile-check interface implementations
var (
	_ Provider  = (*GitHubProvider)(nil)
	_ Refresher = (*GitHubProvider)(nil)
)

func NewGitHub(opts GitHubOptions) *GitHubProvider {
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	if opts.BaseURL == "" {
		opts.BaseURL = "https://api.github.com"
	} else {
		// TODO: should validate url
		// TODO: strip final / if present
	}

	endpoint := github.Endpoint
	if opts.TokenURL != "" {
		endpoint.TokenURL = opts.TokenURL
	}

	p := &GitHubProvider{options: opts}
	p.oauth2Config = &oauth2.Config{
		ClientID:     opts.ClientID,
		ClientSecret: opts.ClientSecret,
		RedirectURL:  opts.RedirectURL,
		Scopes:       []string{"repo", "user:email"},
		Endpoint:     endpoint,
	}

	return p
}

func (ghp *GitHubProvider) Name() string { return GitHub }

func (ghp *GitHubProvider) AuthCodeURL(state string) string {
	return ghp.oauth2Config.AuthCodeURL(state, oauth2.AccessTypeOffline)
}

func (ghp *GitHubProvider) Exchange(ctx context.Context, code string) (Token, error) {
	// oauth2 reads the HTTP client from the context; without it, it falls back to http.DefaultClient (no timeout)
	ctx = context.WithValue(ctx, oauth2.HTTPClient, ghp.options.HTTPClient)
	ghtok, err := ghp.oauth2Config.Exchange(ctx, code)
	if err != nil {
		return Token{}, err
	}

	return toToken(ghtok), nil
}

func (ghp *GitHubProvider) FetchUser(ctx context.Context, accessToken string) (User, error) {
	req, err := newGitHubRequest(ctx, ghp.options.BaseURL+"/user", accessToken)
	if err != nil {
		return User{}, fmt.Errorf("failed to fetch user data: %w", err)
	}

	resp, err := ghp.options.HTTPClient.Do(req)
	if err != nil {
		return User{}, fmt.Errorf("failed to fetch user data: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return User{}, classifyGitHubResponse(resp)
	}

	var ghUser githubUser
	err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&ghUser)
	resp.Body.Close()
	if err != nil {
		return User{}, fmt.Errorf("failed to parse user data: %w", err)
	}

	user := User{
		ProviderUserID: strconv.FormatInt(ghUser.ID, 10),
		Login:          ghUser.Login,
		Email:          ghUser.Email,
		Name:           ghUser.Name,
	}
	return user, nil
}

// listExternalRepositories returns all external git accounts repositories for the authenticated user
func (ghp *GitHubProvider) ListRepositories(ctx context.Context, accessToken string) ([]Repository, error) {
	perPage := 100
	page := 1
	var repos []githubRepo
	reqURL := fmt.Sprintf("%s/user/repos?per_page=%d&page=%d", ghp.options.BaseURL, perPage, page)

	for {
		req, err := newGitHubRequest(ctx, reqURL, accessToken)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch user github repos: %w", err)
		}

		resp, err := ghp.options.HTTPClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch user github repos: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, classifyGitHubResponse(resp)
		}

		var res []githubRepo
		err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&res)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to parse user repos: %w", err)
		}

		repos = append(repos, res...)

		reqURL = nextGitHubPage(resp)
		if reqURL == "" {
			break
		}
		page++
		if page > maxGitHubPages {
			break
		}
	}

	return toRepositories(repos), nil
}

func (ghp *GitHubProvider) GetRepository(ctx context.Context, accessToken string, owner string, name string) (Repository, error) {
	reqURL := fmt.Sprintf("%s/repos/%s/%s", ghp.options.BaseURL, url.PathEscape(owner), url.PathEscape(name))
	req, err := newGitHubRequest(ctx, reqURL, accessToken)
	if err != nil {
		return Repository{}, fmt.Errorf("failed to fetch repository: %w", err)
	}

	resp, err := ghp.options.HTTPClient.Do(req)
	if err != nil {
		return Repository{}, fmt.Errorf("failed to fetch repository: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return Repository{}, classifyGitHubResponse(resp)
	}

	var ghRepo githubRepo
	err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&ghRepo)
	resp.Body.Close()
	if err != nil {
		return Repository{}, fmt.Errorf("failed to parse repository data: %w", err)
	}

	repo := Repository{
		Provider:       GitHub,
		ProviderRepoID: strconv.FormatInt(ghRepo.ID, 10),
		Owner:          ghRepo.Owner.Login,
		Name:           ghRepo.Name,
		FullName:       ghRepo.FullName,
		IsPrivate:      ghRepo.Private,
		HTMLURL:        ghRepo.HTMLURL,
		DefaultBranch:  ghRepo.DefaultBranch,
	}
	return repo, nil
}

func (ghp *GitHubProvider) ListBranches(ctx context.Context, accessToken string, owner string, name string) ([]Branch, error) {
	perPage := 100
	page := 1
	var branches []githubBranch

	reqURL := fmt.Sprintf("%s/repos/%s/%s/branches?per_page=%d&page=%d", ghp.options.BaseURL, url.PathEscape(owner), url.PathEscape(name), perPage, page)

	for {
		req, err := newGitHubRequest(ctx, reqURL, accessToken)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch repository branches: %w", err)
		}

		resp, err := ghp.options.HTTPClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch repository branches: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, classifyGitHubResponse(resp)
		}

		var res []githubBranch
		err = json.NewDecoder(io.LimitReader(resp.Body, maxGitHubResponseBytes)).Decode(&res)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to parse repository branches: %w", err)
		}

		branches = append(branches, res...)

		reqURL = nextGitHubPage(resp)
		if reqURL == "" {
			break
		}
		page++
		if page > maxGitHubPages {
			break
		}
	}

	return toBranches(branches), nil
}

// Refresh exchanges refreshToken for a new token pair. GitHub rotates both
// tokens and invalidates the old refresh token. A refresh token that is expired,
// already used, or revoked yields ErrInvalidToken; any other failure (network,
// GitHub outage, bad client credentials) is returned as a plain error.
func (ghp *GitHubProvider) Refresh(ctx context.Context, refreshToken string) (Token, error) {
	// oauth2 reads the HTTP client from the context; without it, it falls back to http.DefaultClient (no timeout)
	ctx = context.WithValue(ctx, oauth2.HTTPClient, ghp.options.HTTPClient)
	// a token with no access token is invalid, so the source refreshes it right away
	tok, err := ghp.oauth2Config.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil {
		var retrieveErr *oauth2.RetrieveError
		if errors.As(err, &retrieveErr) && retrieveErr.ErrorCode == "bad_refresh_token" {
			return Token{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
		}
		return Token{}, fmt.Errorf("github token refresh: %w", err)
	}
	return toToken(tok), nil
}

// private helpers

type githubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type githubRepo struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`      // ex: Hello-World
	FullName      string `json:"full_name"` // ex: octocat/Hello-World
	Private       bool   `json:"private"`
	HTMLURL       string `json:"html_url"` // ex: https://github.com/octocat/Hello-World
	DefaultBranch string `json:"default_branch"`
	Owner         struct {
		Login string `json:"login"`
	} `json:"owner"`
}

type githubBranch struct {
	Name      string `json:"name"`
	Protected bool   `json:"protected"`
	Commit    struct {
		Sha string `json:"sha"`
	} `json:"commit"`
}

// newGitHubRequest creates an authenticated GET request against the GitHub API
func newGitHubRequest(ctx context.Context, url, accessToken string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	if len(accessToken) > 0 {
		req.Header.Set("Authorization", "token "+accessToken)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")

	return req, nil
}

// nextGitHubPage returns the URL of the next page from the response Link header,
// or "" when there are no more pages
func nextGitHubPage(resp *http.Response) string {
	link := resp.Header.Get("Link")
	if link == "" {
		return ""
	}

	for _, part := range strings.Split(link, ",") {
		for _, tag := range strings.Split(part, ";") {
			if strings.Contains(tag, `rel="next"`) {
				return strings.Trim(strings.Split(part, ";")[0], " \t<>")
			}
		}
	}

	return ""
}

func toRepositories(ghRepos []githubRepo) []Repository {
	repos := make([]Repository, 0, len(ghRepos))
	for _, r := range ghRepos {
		repos = append(repos, Repository{
			Provider:       GitHub,
			ProviderRepoID: strconv.FormatInt(r.ID, 10),
			Owner:          r.Owner.Login,
			Name:           r.Name,
			FullName:       r.FullName,
			IsPrivate:      r.Private,
			HTMLURL:        r.HTMLURL,
			DefaultBranch:  r.DefaultBranch,
		})
	}
	return repos
}

func toBranches(ghBranches []githubBranch) []Branch {
	branches := make([]Branch, 0, len(ghBranches))
	for _, b := range ghBranches {
		branches = append(branches, Branch{
			Name:      b.Name,
			Protected: b.Protected,
			Commit:    b.Commit.Sha,
		})
	}
	return branches
}

func classifyGitHubResponse(res *http.Response) error {
	switch res.StatusCode {
	case http.StatusUnauthorized:
		return ErrInvalidToken
	case http.StatusForbidden:
		// GitHub reuses 403 for revoked tokens and rate limits
		if res.Header.Get("X-RateLimit-Remaining") == "0" {
			return ErrRateLimited
		}
		return ErrInvalidToken
	case http.StatusTooManyRequests:
		return ErrRateLimited
	case http.StatusNotFound:
		return ErrNotFound
	default:
		return fmt.Errorf("github API returned status: %d", res.StatusCode)
	}
}

func toToken(oauthTok *oauth2.Token) Token {
	tok := Token{
		AccessToken:  oauthTok.AccessToken,
		RefreshToken: oauthTok.RefreshToken,
	}

	if !oauthTok.Expiry.IsZero() {
		tok.Expiry = &oauthTok.Expiry
	}

	var intval int64
	switch val := oauthTok.Extra("refresh_token_expires_in").(type) {
	case int64:
		intval = val
	case float64:
		intval = int64(val)
	}
	if intval > 0 {
		t := time.Now().Add(time.Second * time.Duration(intval))
		tok.RefreshExpiry = &t
	}

	return tok
}
