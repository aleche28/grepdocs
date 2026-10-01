package credentials

import (
	"context"
	"errors"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
	"grepdocs/api/secrets"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrAccountNotFound  = errors.New("external account not found")
	ErrAccountAmbiguous = errors.New("multiple external accounts for provider")
	ErrReauthRequired   = errors.New("empty access token or expired")
)

type Service struct {
	pool     *pgxpool.Pool
	cipher   secrets.Cipher
	registry *providers.Registry
}

func New(pool *pgxpool.Pool, cipher secrets.Cipher, registry *providers.Registry) *Service {
	return &Service{
		pool:     pool,
		cipher:   cipher,
		registry: registry,
	}
}

// ForAccount get and decrypts the access token linked to the passed account
func (s *Service) ForAccount(ctx context.Context, account dal.ExternalGitAccount) (string, error) {
	if account.AccessToken == "" || (account.TokenExpiresAt != nil && account.TokenExpiresAt.Before(time.Now())) {
		// No refresh flow yet: the user must re-link the account
		return "", ErrReauthRequired
	}

	decrypted, err := s.cipher.Decrypt(account.AccessToken)
	if err != nil {
		return "", err
	}
	return decrypted, nil
}

// ForRepository get and decrypts the access token required for the passed repo
func (s *Service) ForRepository(ctx context.Context, repo dal.Repository) (string, error) {
	token := ""
	if repo.IsPrivate || repo.AccountID.Valid {
		acc, err := s.ResolveAccount(ctx, repo.UserID, repo.Provider, repo.AccountID.Int64)
		if err != nil {
			return "", err
		}

		token, err = s.ForAccount(ctx, acc)
		if err != nil {
			return "", err
		}
	}
	return token, nil
}

// ResolveAccount selects the external account an account-scoped request refers
// to. With a positive accountID it loads that account and verifies it belongs to
// userID and matches provider. Otherwise it resolves the single account for
// (userID, provider), returning ErrAccountAmbiguous when more than one exists so
// the caller can require an explicit account_id.
func (s *Service) ResolveAccount(ctx context.Context, userID int64, provider string, accountID int64) (dal.ExternalGitAccount, error) {
	q := dal.New(s.pool)
	if accountID > 0 {
		account, err := q.GetExternalGitAccountById(ctx, accountID)
		if errors.Is(err, pgx.ErrNoRows) {
			return dal.ExternalGitAccount{}, ErrAccountNotFound
		}
		if err != nil {
			return dal.ExternalGitAccount{}, err
		}
		if account.UserID != userID || account.Provider != provider {
			return dal.ExternalGitAccount{}, ErrAccountNotFound
		}
		return account, nil
	}

	accounts, err := q.GetExternalGitAccountsByUserIDAndProvider(ctx, dal.GetExternalGitAccountsByUserIDAndProviderParams{
		UserID:   userID,
		Provider: provider,
	})
	if err != nil {
		return dal.ExternalGitAccount{}, err
	}

	switch len(accounts) {
	case 0:
		return dal.ExternalGitAccount{}, ErrAccountNotFound
	case 1:
		return accounts[0], nil
	default:
		return dal.ExternalGitAccount{}, ErrAccountAmbiguous
	}
}
