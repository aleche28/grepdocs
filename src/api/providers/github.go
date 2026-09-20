package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
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
}

type GitHubProvider struct {
	options      GitHubOptions
	oauth2Config *oauth2.Config
}

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

	p := &GitHubProvider{options: opts}
	p.oauth2Config = &oauth2.Config{
		ClientID:     opts.ClientID,
		ClientSecret: opts.ClientSecret,
		RedirectURL:  opts.RedirectURL,
		Scopes:       []string{"repo", "user:email"},
		Endpoint:     github.Endpoint,
	}

	return p
}

func (ghp *GitHubProvider) Name() string { return GitHub }

func (ghp *GitHubProvider) AuthCodeURL(state string) string {
	return ghp.oauth2Config.AuthCodeURL(state, oauth2.AccessTypeOffline)
}

func (ghp *GitHubProvider) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	token, err := ghp.oauth2Config.Exchange(ctx, code)
	return token, err
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
		return User{}, fmt.Errorf("github API returned status: %d", resp.StatusCode)
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

// private helpers

type githubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// newGitHubRequest creates an authenticated GET request against the GitHub API
func newGitHubRequest(ctx context.Context, url, accessToken string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "token "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")

	return req, nil
}
