package routers

import (
	"net/url"
	"strconv"
	"time"

	"grepdocs/api/dal"
)

// linkFinishTimeout bounds the end of a linking flow, from the user fetch to
// the store, which runs detached from the request once a token is issued
const linkFinishTimeout = 30 * time.Second

// Query values of the redirect that ends every provider linking flow, on
// FRONTEND_URL/settings/accounts. They are a stable contract mirrored by the
// UI, and never carry provider-supplied text.
const (
	// result=…, with account_id
	linkResultLinked   = "linked"   // a new identity was linked
	linkResultRelinked = "relinked" // an identity already linked had its tokens replaced

	// error=…
	linkErrAccessDenied     = "access_denied"     // the user cancelled at the provider
	linkErrInvalidState     = "invalid_state"     // state missing or wrong (expired flow, second tab)
	linkErrLinkFailed       = "link_failed"       // provider error, no code, or a bad code/token
	linkErrIdentityMismatch = "identity_mismatch" // re-link came back with another identity; with account_id
	linkErrAccountNotFound  = "account_not_found" // the re-link target does not exist or is not the user's
	linkErrServerError      = "server_error"      // anything else
)

// linkOutcome is the result of a linking flow, encoded into the redirect by
// linkRedirectURL. Exactly one of Result and Error is set.
type linkOutcome struct {
	Result string
	Error  string
	// AccountID is the linked, re-linked or mismatched account; 0 omits it
	AccountID int64
}

func linkSuccess(result string, accountID int64) linkOutcome {
	return linkOutcome{Result: result, AccountID: accountID}
}

func linkFailure(code string) linkOutcome {
	return linkOutcome{Error: code}
}

// linkRedirectURL returns the UI page that ends a linking flow, for the UI
// origin frontend (FRONTEND_URL).
func linkRedirectURL(frontend string, o linkOutcome) string {
	v := url.Values{}
	if o.Result != "" {
		v.Set("result", o.Result)
	}
	if o.Error != "" {
		v.Set("error", o.Error)
	}
	if o.AccountID > 0 {
		v.Set("account_id", strconv.FormatInt(o.AccountID, 10))
	}

	u := frontend + "/settings/accounts"
	if q := v.Encode(); q != "" {
		u += "?" + q
	}
	return u
}

// providerAuthError maps the provider's OAuth error parameter (RFC 6749
// §4.1.2.1) to a redirect code. Only a cancel gets its own code: the raw value
// is provider-supplied, so it never reaches the URL.
func providerAuthError(errParam string) string {
	if errParam == "access_denied" {
		return linkErrAccessDenied
	}
	return linkErrLinkFailed
}

// checkRelinkTarget decides whether a re-link may store the identity that came
// back from the provider. target is the locked target row, found false when it
// no longer exists. It returns "" when the re-link may proceed, or the redirect
// code to fail with.
func checkRelinkTarget(target dal.ExternalGitAccount, found bool, userID int64, provider, providerUserID string) string {
	switch {
	// gone (unlinked while the user was at the provider), or not this user's
	// account for this provider: login checked it, so only a stale session gets here
	case !found, target.UserID != userID, target.Provider != provider:
		return linkErrAccountNotFound
	case target.ProviderUserID != providerUserID:
		return linkErrIdentityMismatch
	default:
		return ""
	}
}
