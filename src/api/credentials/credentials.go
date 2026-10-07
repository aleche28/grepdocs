package credentials

import (
	"context"
	"errors"
	"fmt"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
	"grepdocs/api/secrets"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// refreshMargin refreshes tokens shortly before they expire, so a caller
	// never gets one that expires mid-operation.
	refreshMargin = 5 * time.Minute
	// refreshTimeout bounds the locked refresh, which runs detached from the
	// request context.
	refreshTimeout = 30 * time.Second
	revokeTimeout  = 10 * time.Second
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
// the decryption and refresh of stored tokens, so callers never read the token
// columns of external_git_accounts themselves.
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

// ForAccount returns a usable access token for account, refreshing it first
// when it is missing or about to expire. It returns ErrReauthRequired when the
// token cannot be refreshed (no or expired refresh token, provider without
// refresh, or the provider rejected the refresh token).
func (s *Service) ForAccount(ctx context.Context, account dal.ExternalGitAccount) (string, error) {
	now := time.Now()
	if !needsRefresh(account, now) {
		return s.cipher.Decrypt(account.AccessToken)
	}
	// fail fast without touching the DB; refresh re-checks on the locked row
	if !canRefresh(account, now) {
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

func (s *Service) Revoke(ctx context.Context, account dal.ExternalGitAccount) error {
	prov, ok := s.registry.Lookup(account.Provider)
	if !ok {
		return fmt.Errorf("provider %s not registered", account.Provider)
	}

	revoker, ok := prov.(providers.Revoker)
	if !ok {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), revokeTimeout)
	defer cancel()

	now := time.Now()
	var accessToken string
	if needsRefresh(account, now) {
		// Revoking an expired access token leaves its refresh token alive (verified
		// manually). Spend the refresh token on a fresh pair and revoke that instead.
		// The new pair is never stored: the account is gone or already replaced.
		refresher, ok := prov.(providers.Refresher)
		if !ok || !canRefresh(account, now) {
			return nil
		}

		refreshToken, err := s.cipher.Decrypt(account.RefreshToken)
		if err != nil {
			return err
		}

		tok, err := refresher.Refresh(ctx, refreshToken)
		switch {
		case errors.Is(err, providers.ErrInvalidToken):
			return nil // refresh token already dead
		case err != nil:
			return fmt.Errorf("refresh before revoke: %w", err)
		}
		accessToken = tok.AccessToken
	} else {
		var err error
		if accessToken, err = s.cipher.Decrypt(account.AccessToken); err != nil {
			return err
		}
	}

	// revoking the accessToken revokes the refresh token too: tested manually
	return revoker.Revoke(ctx, accessToken)
}

// private helpers

// needsRefresh returns true if the access token is empty, expired, or
// expires within refreshMargin. A nil expiry means the token never expires.
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

// refresh renews the tokens of the account under a row lock and persists them.
// It works only from the locked row, never from a copy read before the lock.
func (s *Service) refresh(ctx context.Context, accountID int64) (string, error) {
	// detach context from the request, otherwise cancelling after
	// github rotated the tokens would force a re-link
	ctx = context.WithoutCancel(ctx)
	ctx, cancel := context.WithTimeout(ctx, refreshTimeout)
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

	// another caller may have refreshed while we waited for the lock
	now := time.Now()
	if !needsRefresh(account, now) {
		return s.cipher.Decrypt(account.AccessToken)
	}

	if !canRefresh(account, now) {
		return "", ErrReauthRequired
	}

	refresher, ok := s.refresherFor(account.Provider)
	if !ok {
		return "", ErrReauthRequired
	}

	oldRefreshToken, err := s.cipher.Decrypt(account.RefreshToken)
	if err != nil {
		return "", err
	}

	token, err := refresher.Refresh(ctx, oldRefreshToken)
	switch {
	case errors.Is(err, providers.ErrInvalidToken):
		// The refresh token is dead: clear the stored tokens so later calls
		// stop at canRefresh instead of contacting the provider again.
		// Clearing is best effort; the user must re-link either way.
		// Logged here because callers map ErrReauthRequired to a 403 without logging;
		// err carries the provider's error code, never a token.
		log.Printf("credentials: provider rejected refresh for account %d, clearing tokens: %v", account.ID, err)
		if clearErr := clearTokens(ctx, tx, q, account.ID); clearErr != nil {
			return "", fmt.Errorf("%w: %w (clearing tokens: %w)", ErrReauthRequired, err, clearErr)
		}
		return "", fmt.Errorf("%w: %w", ErrReauthRequired, err)
	case err != nil:
		return "", err
	}

	encAccessToken, err := s.cipher.Encrypt(token.AccessToken)
	if err != nil {
		return "", err
	}

	// An empty refresh token tells the update query to keep the stored one
	// (and its expiry). oauth2 echoes the old token when the provider did not
	// rotate it, so treat that as "not rotated" too.
	encRefreshToken := ""
	if token.RefreshToken != "" && token.RefreshToken != oldRefreshToken {
		encRefreshToken, err = s.cipher.Encrypt(token.RefreshToken)
		if err != nil {
			return "", err
		}
	}

	_, err = q.UpdateExternalGitAccountTokens(ctx, dal.UpdateExternalGitAccountTokensParams{
		ID:                    account.ID,
		AccessToken:           encAccessToken,
		TokenExpiresAt:        token.Expiry,
		RefreshToken:          encRefreshToken,
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

// clearTokens empties the stored tokens of the locked account and commits.
func clearTokens(ctx context.Context, tx pgx.Tx, q *dal.Queries, accountID int64) error {
	if _, err := q.ClearExternalGitAccountTokens(ctx, accountID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
