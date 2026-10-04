package credentials

import (
	"bytes"
	"context"
	"errors"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
	"grepdocs/api/secrets"
	"testing"
	"time"
)

func newTestCipher(t *testing.T, fill byte) *secrets.AESGCMCipher {
	t.Helper()
	c, err := secrets.NewAESGCMCipher(bytes.Repeat([]byte{fill}, 32))
	if err != nil {
		t.Fatalf("NewAESGCMCipher: %v", err)
	}
	return c
}

func encrypt(t *testing.T, c secrets.Cipher, plaintext string) string {
	t.Helper()
	ciphertext, err := c.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	return ciphertext
}

func TestForAccount(t *testing.T) {
	cipher := newTestCipher(t, 1)
	// ForAccount touches neither the database nor the providers
	svc := New(nil, cipher, nil)

	past := time.Now().Add(-time.Minute)
	future := time.Now().Add(time.Hour)
	soon := time.Now().Add(time.Minute) // inside refreshMargin

	tests := []struct {
		name      string
		account   dal.ExternalGitAccount
		wantToken string
		wantErr   error // nil means success; checked with errors.Is
		anyErr    bool  // an error that must not be ErrReauthRequired
	}{
		{
			name:      "token with future expiry",
			account:   dal.ExternalGitAccount{AccessToken: encrypt(t, cipher, "ghu_valid"), TokenExpiresAt: &future},
			wantToken: "ghu_valid",
		},
		{
			name:      "token without expiry",
			account:   dal.ExternalGitAccount{AccessToken: encrypt(t, cipher, "ghu_forever")},
			wantToken: "ghu_forever",
		},
		{
			name:    "expired token",
			account: dal.ExternalGitAccount{AccessToken: encrypt(t, cipher, "ghu_expired"), TokenExpiresAt: &past},
			wantErr: ErrReauthRequired,
		},
		{
			name:    "empty token",
			account: dal.ExternalGitAccount{AccessToken: "", TokenExpiresAt: &future},
			wantErr: ErrReauthRequired,
		},
		// The cases below must return before touching the database: svc has a nil pool, so
		// reaching refresh() would panic
		{
			name:    "expiring within the margin, no refresh token",
			account: dal.ExternalGitAccount{AccessToken: encrypt(t, cipher, "ghu_expiring"), TokenExpiresAt: &soon},
			wantErr: ErrReauthRequired,
		},
		{
			name: "expired, refresh token expired too",
			account: dal.ExternalGitAccount{
				AccessToken:           encrypt(t, cipher, "ghu_expired"),
				TokenExpiresAt:        &past,
				RefreshToken:          encrypt(t, cipher, "ghr_expired"),
				RefreshTokenExpiresAt: &past,
			},
			wantErr: ErrReauthRequired,
		},
		{
			name:    "tokens cleared after a rejected refresh",
			account: dal.ExternalGitAccount{AccessToken: "", RefreshToken: "", TokenExpiresAt: &past},
			wantErr: ErrReauthRequired,
		},
		{
			name:    "token encrypted with another key",
			account: dal.ExternalGitAccount{AccessToken: encrypt(t, newTestCipher(t, 2), "ghu_other_key")},
			anyErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := svc.ForAccount(context.Background(), tt.account)

			switch {
			case tt.anyErr:
				if err == nil {
					t.Fatalf("ForAccount() = %q, want an error", got)
				}
				if errors.Is(err, ErrReauthRequired) {
					t.Fatalf("ForAccount() error = %v, want a decrypt error, not ErrReauthRequired", err)
				}
			case tt.wantErr != nil:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("ForAccount() error = %v, want %v", err, tt.wantErr)
				}
			case err != nil:
				t.Fatalf("ForAccount() unexpected error: %v", err)
			}

			if got != tt.wantToken {
				t.Errorf("ForAccount() = %q, want %q", got, tt.wantToken)
			}
		})
	}
}

func TestNeedsRefresh(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { ts := now.Add(d); return &ts }

	tests := []struct {
		name    string
		account dal.ExternalGitAccount
		want    bool
	}{
		{"no expiry", dal.ExternalGitAccount{AccessToken: "v1:x"}, false},
		{"expires after the margin", dal.ExternalGitAccount{AccessToken: "v1:x", TokenExpiresAt: at(refreshMargin + time.Second)}, false},
		{"expires exactly at the margin", dal.ExternalGitAccount{AccessToken: "v1:x", TokenExpiresAt: at(refreshMargin)}, false},
		{"expires just inside the margin", dal.ExternalGitAccount{AccessToken: "v1:x", TokenExpiresAt: at(refreshMargin - time.Nanosecond)}, true},
		{"already expired", dal.ExternalGitAccount{AccessToken: "v1:x", TokenExpiresAt: at(-time.Hour)}, true},
		{"empty token without expiry", dal.ExternalGitAccount{AccessToken: ""}, true},
		{"empty token with future expiry", dal.ExternalGitAccount{AccessToken: "", TokenExpiresAt: at(time.Hour)}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := needsRefresh(tt.account, now); got != tt.want {
				t.Errorf("needsRefresh() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCanRefresh(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { ts := now.Add(d); return &ts }

	tests := []struct {
		name    string
		account dal.ExternalGitAccount
		want    bool
	}{
		{"no refresh token", dal.ExternalGitAccount{}, false},
		{"no refresh token, future expiry", dal.ExternalGitAccount{RefreshTokenExpiresAt: at(time.Hour)}, false},
		{"refresh token without expiry", dal.ExternalGitAccount{RefreshToken: "v1:x"}, true},
		{"refresh token valid", dal.ExternalGitAccount{RefreshToken: "v1:x", RefreshTokenExpiresAt: at(time.Nanosecond)}, true},
		{"refresh token expiring exactly now", dal.ExternalGitAccount{RefreshToken: "v1:x", RefreshTokenExpiresAt: at(0)}, false},
		{"refresh token expired", dal.ExternalGitAccount{RefreshToken: "v1:x", RefreshTokenExpiresAt: at(-time.Hour)}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canRefresh(tt.account, now); got != tt.want {
				t.Errorf("canRefresh() = %v, want %v", got, tt.want)
			}
		})
	}
}

// fakeRevoker is a registered provider that records Revoke calls; the embedded
// interface is nil, so calling any other Provider method panics
type fakeRevoker struct {
	providers.Provider
	err   error
	calls []string
	// context state captured during the call; Revoke cancels it on return
	ctxErr      error
	hasDeadline bool
}

func (f *fakeRevoker) Name() string { return "fake" }

func (f *fakeRevoker) Revoke(ctx context.Context, accessToken string) error {
	f.calls = append(f.calls, accessToken)
	f.ctxErr = ctx.Err()
	_, f.hasDeadline = ctx.Deadline()
	return f.err
}

// plainProvider is registered but cannot revoke
type plainProvider struct{ providers.Provider }

func (plainProvider) Name() string { return "plain" }

func TestRevoke(t *testing.T) {
	cipher := newTestCipher(t, 1)

	t.Run("revokes the decrypted access token", func(t *testing.T) {
		rev := &fakeRevoker{}
		svc := New(nil, cipher, providers.NewRegistry(rev))

		// the revoke must survive the request being canceled
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := svc.Revoke(ctx, dal.ExternalGitAccount{Provider: "fake", AccessToken: encrypt(t, cipher, "ghu_old")})
		if err != nil {
			t.Fatalf("Revoke() unexpected error: %v", err)
		}
		if len(rev.calls) != 1 || rev.calls[0] != "ghu_old" {
			t.Fatalf("Revoke calls = %v, want [ghu_old]", rev.calls)
		}
		if rev.ctxErr != nil {
			t.Errorf("revoke context error = %v, want a live context", rev.ctxErr)
		}
		if !rev.hasDeadline {
			t.Error("revoke context has no deadline, want revokeTimeout")
		}
	})

	t.Run("returns the provider error", func(t *testing.T) {
		wantErr := errors.New("boom")
		rev := &fakeRevoker{err: wantErr}
		svc := New(nil, cipher, providers.NewRegistry(rev))

		err := svc.Revoke(context.Background(), dal.ExternalGitAccount{Provider: "fake", AccessToken: encrypt(t, cipher, "ghu_old")})
		if !errors.Is(err, wantErr) {
			t.Fatalf("Revoke() error = %v, want %v", err, wantErr)
		}
	})

	tests := []struct {
		name      string
		account   dal.ExternalGitAccount
		wantErr   bool
		wantCalls int
	}{
		// cleared after a rejected refresh: nothing left to revoke
		{name: "empty access token", account: dal.ExternalGitAccount{Provider: "fake"}},
		{name: "provider cannot revoke", account: dal.ExternalGitAccount{Provider: "plain", AccessToken: encrypt(t, cipher, "ghu_old")}},
		{name: "unregistered provider", account: dal.ExternalGitAccount{Provider: "nope", AccessToken: encrypt(t, cipher, "ghu_old")}, wantErr: true},
		{name: "token encrypted with another key", account: dal.ExternalGitAccount{Provider: "fake", AccessToken: encrypt(t, newTestCipher(t, 2), "ghu_old")}, wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rev := &fakeRevoker{}
			svc := New(nil, cipher, providers.NewRegistry(rev, plainProvider{}))

			err := svc.Revoke(context.Background(), tc.account)
			if gotErr := err != nil; gotErr != tc.wantErr {
				t.Fatalf("Revoke() error = %v, want error = %v", err, tc.wantErr)
			}
			if len(rev.calls) != tc.wantCalls {
				t.Errorf("Revoke calls = %v, want %d", rev.calls, tc.wantCalls)
			}
		})
	}
}
