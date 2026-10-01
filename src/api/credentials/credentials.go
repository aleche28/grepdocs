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

// Errors returned by Service; callers map them to their own responses
// (HTTP status in handlers, account state in the sync engine).
var (
	ErrAccountNotFound  = errors.New("external account not found")
	ErrAccountAmbiguous = errors.New("multiple external accounts for provider")
	// ErrReauthRequired means the stored token cannot be used and the user
	// must re-link the account.
	ErrReauthRequired = errors.New("account must be re-linked")
)

// Service hands out usable provider access tokens for linked accounts. It owns
// the decryption of stored tokens (and, later, their refresh), so callers never
// read the token columns of external_git_accounts themselves.
type Service struct {
	pool     *pgxpool.Pool
	cipher   secrets.Cipher
	registry *providers.Registry
}

// New returns a Service backed by pool, decrypting stored tokens with cipher.
func New(pool *pgxpool.Pool, cipher secrets.Cipher, registry *providers.Registry) *Service {
	return &Service{
		pool:     pool,
		cipher:   cipher,
		registry: registry,
	}
}

// ForAccount returns the decrypted access token of account. It returns
// ErrReauthRequired when the stored token is empty or expired.
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

// ForRepository returns the access token to use for provider calls on repo:
// the token of its linked account, or of the user's single account for the
// provider when a private repo has none. A public repo with no linked account
// returns "", nil on purpose: providers treat an empty token as an anonymous call.
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
