package providers

import (
	"context"
	"errors"

	"golang.org/x/oauth2"
)

var (
	ErrInvalidToken = errors.New("provider token invalid or revoked")
	ErrRateLimited  = errors.New("provider rate limit exceeded")
	ErrNotFound     = errors.New("provider resource not found")
)

type User struct {
	ProviderUserID string `json:"provider_user_id"`
	Login          string `json:"login"`
	Email          string `json:"email"`
	Name           string `json:"name"`
}

type Repository struct {
	Provider       string `json:"provider"`
	ProviderRepoID string `json:"provider_repo_id"`
	Owner          string `json:"owner"`
	Name           string `json:"name"`
	FullName       string `json:"full_name"`
	IsPrivate      bool   `json:"is_private"`
	HTMLURL        string `json:"html_url"`
	DefaultBranch  string `json:"default_branch"`
}

type Branch struct {
	Name      string `json:"name"`
	Commit    string `json:"commit"`
	Protected bool   `json:"protected"`
}

type Provider interface {
	Name() string
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (*oauth2.Token, error)
	FetchUser(ctx context.Context, accessToken string) (User, error)
	ListRepositories(ctx context.Context, accessToken string) ([]Repository, error)
	GetRepository(ctx context.Context, accessToken string, owner string, name string) (Repository, error)
	ListBranches(ctx context.Context, accessToken string, owner string, name string) ([]Branch, error)
}

// Refresher is implemented by providers whose token can be refreshed (not GitHub)
type Refresher interface {
	Refresh(ctx context.Context, refreshToken string) (*oauth2.Token, error)
}
