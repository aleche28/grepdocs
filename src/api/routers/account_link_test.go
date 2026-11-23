package routers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/go-chi/chi/v5"

	"grepdocs/api/credentials"
	"grepdocs/api/dal"
	"grepdocs/api/providers"
)

func TestLinkRedirectURL(t *testing.T) {
	const base = "http://ui.test"

	tests := []struct {
		name    string
		outcome linkOutcome
		want    string
	}{
		{name: "linked", outcome: linkSuccess(linkResultLinked, 3), want: base + "/settings/accounts?account_id=3&result=linked"},
		{name: "relinked", outcome: linkSuccess(linkResultRelinked, 3), want: base + "/settings/accounts?account_id=3&result=relinked"},
		{name: "access denied", outcome: linkFailure(linkErrAccessDenied), want: base + "/settings/accounts?error=access_denied"},
		{name: "invalid state", outcome: linkFailure(linkErrInvalidState), want: base + "/settings/accounts?error=invalid_state"},
		{name: "link failed", outcome: linkFailure(linkErrLinkFailed), want: base + "/settings/accounts?error=link_failed"},
		{
			name:    "identity mismatch",
			outcome: linkOutcome{Error: linkErrIdentityMismatch, AccountID: 7},
			want:    base + "/settings/accounts?account_id=7&error=identity_mismatch",
		},
		{name: "account not found", outcome: linkFailure(linkErrAccountNotFound), want: base + "/settings/accounts?error=account_not_found"},
		{name: "server error", outcome: linkFailure(linkErrServerError), want: base + "/settings/accounts?error=server_error"},
		{name: "empty outcome has no query", outcome: linkOutcome{}, want: base + "/settings/accounts"},
		{name: "values are escaped", outcome: linkFailure("a b&c=d"), want: base + "/settings/accounts?error=a+b%26c%3Dd"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := linkRedirectURL(base, tc.outcome); got != tc.want {
				t.Errorf("linkRedirectURL() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestProviderAuthError(t *testing.T) {
	tests := []struct {
		errParam string
		want     string
	}{
		{errParam: "access_denied", want: linkErrAccessDenied},
		{errParam: "server_error", want: linkErrLinkFailed},
		{errParam: "redirect_uri_mismatch", want: linkErrLinkFailed},
		{errParam: "ACCESS_DENIED", want: linkErrLinkFailed}, // OAuth error codes are case-sensitive
	}

	for _, tc := range tests {
		t.Run(tc.errParam, func(t *testing.T) {
			if got := providerAuthError(tc.errParam); got != tc.want {
				t.Errorf("providerAuthError(%q) = %q, want %q", tc.errParam, got, tc.want)
			}
		})
	}
}

func TestCheckRelinkTarget(t *testing.T) {
	target := dal.ExternalGitAccount{ID: 7, ProviderUserID: "123"}

	tests := []struct {
		name       string
		resolveErr error
		identity   string
		want       string
	}{
		{name: "same identity", identity: "123", want: ""},
		{name: "different identity", identity: "456", want: linkErrIdentityMismatch},
		{name: "target gone", resolveErr: credentials.ErrAccountNotFound, identity: "123", want: linkErrAccountNotFound},
		{name: "lookup failed", resolveErr: errors.New("db down"), identity: "123", want: linkErrServerError},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := checkRelinkTarget(target, tc.resolveErr, tc.identity); got != tc.want {
				t.Errorf("checkRelinkTarget() = %q, want %q", got, tc.want)
			}
		})
	}
}

// fakeLinkProvider issues a fixed token and records exchanges and revocations;
// the embedded interface is nil, so calling any other Provider method panics
type fakeLinkProvider struct {
	providers.Provider
	exchangeErr error
	fetchErr    error
	exchanges   int
	revoked     []string
}

func (f *fakeLinkProvider) Name() string { return "fake" }

func (f *fakeLinkProvider) Exchange(_ context.Context, _ string) (providers.Token, error) {
	f.exchanges++
	if f.exchangeErr != nil {
		return providers.Token{}, f.exchangeErr
	}
	return providers.Token{AccessToken: "tok-new"}, nil
}

func (f *fakeLinkProvider) FetchUser(_ context.Context, _ string) (providers.User, error) {
	return providers.User{ProviderUserID: "123", Login: "octocat"}, f.fetchErr
}

func (f *fakeLinkProvider) Revoke(_ context.Context, accessToken string) error {
	f.revoked = append(f.revoked, accessToken)
	return nil
}

// TestLinkCallbackBeforeStore covers every outcome decided before the database
// is touched; the re-link and store paths need a database (no seam yet).
func TestLinkCallbackBeforeStore(t *testing.T) {
	tests := []struct {
		name          string
		query         url.Values
		sessState     string
		exchangeErr   error
		fetchErr      error
		want          linkOutcome
		wantExchanges int
		wantRevoked   bool
	}{
		{
			name:  "no state in session",
			query: url.Values{"state": {"s1"}, "code": {"c"}},
			want:  linkFailure(linkErrInvalidState),
		},
		{
			name:      "state mismatch",
			query:     url.Values{"state": {"other"}, "code": {"c"}},
			sessState: "s1",
			want:      linkFailure(linkErrInvalidState),
		},
		{
			name:      "cancel is read before code",
			query:     url.Values{"state": {"s1"}, "error": {"access_denied"}, "code": {"c"}},
			sessState: "s1",
			want:      linkFailure(linkErrAccessDenied),
		},
		{
			name:      "other provider error",
			query:     url.Values{"state": {"s1"}, "error": {"server_error"}},
			sessState: "s1",
			want:      linkFailure(linkErrLinkFailed),
		},
		{
			name:      "missing code",
			query:     url.Values{"state": {"s1"}},
			sessState: "s1",
			want:      linkFailure(linkErrLinkFailed),
		},
		{
			name:          "failed exchange issues no token to revoke",
			query:         url.Values{"state": {"s1"}, "code": {"c"}},
			sessState:     "s1",
			exchangeErr:   errors.New("bad_verification_code"),
			want:          linkFailure(linkErrLinkFailed),
			wantExchanges: 1,
		},
		{
			name:          "rejected token is revoked",
			query:         url.Values{"state": {"s1"}, "code": {"c"}},
			sessState:     "s1",
			fetchErr:      providers.ErrInvalidToken,
			want:          linkFailure(linkErrLinkFailed),
			wantExchanges: 1,
			wantRevoked:   true,
		},
		{
			name:          "failed user fetch revokes the token",
			query:         url.Values{"state": {"s1"}, "code": {"c"}},
			sessState:     "s1",
			fetchErr:      errors.New("github down"),
			want:          linkFailure(linkErrServerError),
			wantExchanges: 1,
			wantRevoked:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			prov := &fakeLinkProvider{exchangeErr: tc.exchangeErr, fetchErr: tc.fetchErr}
			h := &ExternalAccountsHandler{creds: credentials.New(nil, nil, providers.NewRegistry(prov))}

			got := h.linkCallback(context.Background(), prov, 1, tc.query, tc.sessState, 0)
			if got != tc.want {
				t.Errorf("linkCallback() = %+v, want %+v", got, tc.want)
			}
			if prov.exchanges != tc.wantExchanges {
				t.Errorf("exchanges = %d, want %d", prov.exchanges, tc.wantExchanges)
			}
			switch {
			case tc.wantRevoked && (len(prov.revoked) != 1 || prov.revoked[0] != "tok-new"):
				t.Errorf("revoked = %v, want [tok-new]", prov.revoked)
			case !tc.wantRevoked && len(prov.revoked) != 0:
				t.Errorf("revoked = %v, want none", prov.revoked)
			}
		})
	}
}

// TestProviderLoginInvalidAccountID covers the login redirects decided before
// the database and the session are touched.
func TestProviderLoginInvalidAccountID(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://ui.test")

	h := &ExternalAccountsHandler{providerRegistry: providers.NewRegistry(&fakeLinkProvider{})}
	r := chi.NewRouter()
	r.Get("/{provider}/login", h.providerLogin)

	tests := []struct {
		name         string
		path         string
		wantStatus   int
		wantLocation string
	}{
		{name: "non-numeric", path: "/fake/login?account_id=abc", wantStatus: http.StatusTemporaryRedirect, wantLocation: "http://ui.test/settings/accounts?error=account_not_found"},
		{name: "zero", path: "/fake/login?account_id=0", wantStatus: http.StatusTemporaryRedirect, wantLocation: "http://ui.test/settings/accounts?error=account_not_found"},
		{name: "negative", path: "/fake/login?account_id=-3", wantStatus: http.StatusTemporaryRedirect, wantLocation: "http://ui.test/settings/accounts?error=account_not_found"},
		{name: "empty", path: "/fake/login?account_id=", wantStatus: http.StatusTemporaryRedirect, wantLocation: "http://ui.test/settings/accounts?error=account_not_found"},
		{name: "unregistered provider keeps its 501", path: "/nope/login?account_id=1", wantStatus: http.StatusNotImplemented},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if got := rec.Header().Get("Location"); got != tc.wantLocation {
				t.Errorf("Location = %q, want %q", got, tc.wantLocation)
			}
		})
	}
}
