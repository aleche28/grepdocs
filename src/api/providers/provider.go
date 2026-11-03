package providers

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInvalidToken    = errors.New("provider token invalid or revoked")
	ErrRateLimited     = errors.New("provider rate limit exceeded")
	ErrNotFound        = errors.New("provider resource not found")
	ErrAppNotInstalled = errors.New("provider app not installed")
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

type Token struct {
	AccessToken   string
	Expiry        *time.Time
	RefreshToken  string
	RefreshExpiry *time.Time
}

type Provider interface {
	Name() string
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (Token, error)
	FetchUser(ctx context.Context, accessToken string) (User, error)
	ListRepositories(ctx context.Context, accessToken string) ([]Repository, error)
	GetRepository(ctx context.Context, accessToken string, owner string, name string) (Repository, error)
	ListBranches(ctx context.Context, accessToken string, owner string, name string) ([]Branch, error)
}

// Refresher is implemented by providers whose token can be refreshed
type Refresher interface {
	Refresh(ctx context.Context, refreshToken string) (Token, error)
}

// Installer is implemented by providers whose access depends on an app installation
type Installer interface {
	InstallURL() string
}

// Revoker is implemented by providers who can revoke tokens
type Revoker interface {
	Revoke(ctx context.Context, accessToken string) error
}
