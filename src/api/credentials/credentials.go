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

const refreshMargin = 5 * time.Minute

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
	if !needsRefresh(account, time.Now()) {
		return s.cipher.Decrypt(account.AccessToken)
	}
	if !canRefresh(account, time.Now()) {
		return "", ErrReauthRequired
	}
	return s.refresh(ctx, account.ID)
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

// private helpers

// needsRefresh returns true if access token is empty, expired
// or expires in the next 5 minutes
func needsRefresh(acc dal.ExternalGitAccount, now time.Time) bool {
	return acc.AccessToken == "" ||
		(acc.TokenExpiresAt != nil && acc.TokenExpiresAt.Before(now.Add(refreshMargin)))
}

// canRefresh returns true if a refresh token is set and not expired yet
func canRefresh(acc dal.ExternalGitAccount, now time.Time) bool {
	return acc.RefreshToken != "" &&
		// NOTE: nil expiration date means no expiration
		(acc.RefreshTokenExpiresAt == nil || acc.RefreshTokenExpiresAt.After(now))
}

func (s *Service) refresherFor(provider string) (providers.Refresher, bool) {
	if p, ok := s.registry.Lookup(provider); ok {
		r, ok := p.(providers.Refresher)
		return r, ok
	}
	return nil, false
}

func (s *Service) refresh(ctx context.Context, accountID int64) (string, error) {
	// detach context from the request, otherwise cancelling after
	// github rotated the tokens would force a re-link
	ctx = context.WithoutCancel(ctx)
	ctx, cancel := context.WithTimeout(ctx, time.Second*30)
	defer cancel()

	// row lock: refresh tokens are single-use, so concurrent refreshes would
	// invalidate each other
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	q := dal.New(tx)

	account, err := q.GetExternalGitAccountByIdForUpdate(ctx, accountID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", ErrAccountNotFound
	case err != nil:
		return "", err
	}

	// while waiting on the lock, maybe the row was updated by someone else
	if !needsRefresh(account, time.Now()) {
		return s.cipher.Decrypt(account.AccessToken)
	}

	if !canRefresh(account, time.Now()) {
		return "", ErrReauthRequired
	}

	refresher, ok := s.refresherFor(account.Provider)
	if !ok {
		return "", ErrReauthRequired
	}

	refreshToken, err := s.cipher.Decrypt(account.RefreshToken)
	if err != nil {
		return "", err
	}

	token, err := refresher.Refresh(ctx, refreshToken)
	if err != nil {
		// TODO: classify errors
		return "", err
	}

	accessToken, err := s.cipher.Encrypt(token.AccessToken)
	if err != nil {
		return "", err
	}

	if token.RefreshToken == refreshToken {
		refreshToken = "" // the update query coalesces with old one, without overwriting it
	} else if token.RefreshToken != "" {
		// if a new refreshtoken is not returned, keep the old one
		refreshToken, err = s.cipher.Encrypt(token.RefreshToken)
		if err != nil {
			return "", err
		}
	}

	_, err = q.UpdateExternalGitAccountTokens(ctx, dal.UpdateExternalGitAccountTokensParams{
		ID:                    account.ID,
		AccessToken:           accessToken,
		TokenExpiresAt:        token.Expiry,
		RefreshToken:          refreshToken,
		RefreshTokenExpiresAt: token.RefreshExpiry,
	})
	if err != nil {
		return "", err
	}
	err = tx.Commit(ctx)
	if err != nil {
		return "", err
	}
	return token.AccessToken, nil
}
