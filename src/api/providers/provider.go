package providers

import (
	"context"

	"golang.org/x/oauth2"
)

type User struct {
	ProviderUserId string
	Login          string
	Email          string
	Name           string
}

type Repository struct {
	Provider       string
	ProviderRepoId string
	Name           string
	FullName       string
	Description    string
	IsPrivate      bool
	HtmlUrl        string
	DefaultBranch  string
}

type Provider interface {
	Name() string
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (*oauth2.Token, error)
	FetchUser(ctx context.Context, accessToken string) (User, error)
	ListRepositories(ctx context.Context, accessToken string) ([]Repository, error)
}
