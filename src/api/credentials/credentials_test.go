package credentials

import (
	"bytes"
	"context"
	"errors"
	"grepdocs/api/dal"
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
