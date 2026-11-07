package reposync

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"grepdocs/api/credentials"
	"grepdocs/api/providers"
)

func TestSyncErrorCode(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "re-auth required", err: credentials.ErrReauthRequired, want: CodeReauthRequired},
		{name: "invalid token", err: providers.ErrInvalidToken, want: CodeReauthRequired},
		{name: "not found", err: providers.ErrNotFound, want: CodeResourceNotFound},
		{name: "app not installed", err: providers.ErrAppNotInstalled, want: CodeAppNotInstalled},
		{name: "rate limited", err: providers.ErrRateLimited, want: CodeRateLimited},
		{name: "truncated tree", err: providers.ErrTreeTruncated, want: CodeTruncatedTree},
		{name: "provider not supported", err: errProviderNotSupported, want: CodeProviderNotSupported},
		{name: "generic error", err: errors.New("generic"), want: CodeInternal},
		{name: "job timeout", err: context.DeadlineExceeded, want: CodeInternal},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// reproduce the two layers of wrapping from production
			got := syncErrorCode(fmt.Errorf("sync repo 1: get branch: %w", tc.err))
			if got != tc.want {
				t.Errorf("syncErrorCode(%v) = %q, want %q", tc.err, got, tc.want)
			}
		})
	}
}
