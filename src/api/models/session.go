package models

import (
	"strconv"
	"time"
)

type Session struct {
	CreatedAt      time.Time
	LastActivityAt time.Time
	Id             string
	UserID         int64
	Authenticated  bool
	Data           map[string]any
	Destroyed      bool `json:"-"` // request-scoped, set by SessionManager.Destroy: never stored
}

func (s *Session) Get(key string) any {
	return s.Data[key]
}

func (s *Session) Put(key string, value any) {
	s.Data[key] = value
}

func (s *Session) Delete(key string) {
	delete(s.Data, key)
}

func (s *Session) IsAuthenticated() bool {
	return s.Authenticated
}

func (s *Session) SetUserID(id int64) {
	s.UserID = id
	s.Authenticated = id > 0
}

func (s *Session) GetUserID() int64 {
	return s.UserID
}

func (s *Session) SetOAuthStateToken(token string) {
	s.Data["oauth_state"] = token
}

func (s *Session) GetOAuthStateToken() string {
	if val, ok := s.Data["oauth_state"].(string); ok {
		delete(s.Data, "oauth_state")
		return val
	}
	return ""
}

// SetRelinkAccountID stores the account that the pending provider OAuth flow
// re-links. An id <= 0 clears it: a plain link must not inherit the target of
// an abandoned re-link.
//
// The id is stored as a decimal string: the session round-trips through JSON,
// which would turn a number in Data into a float64.
func (s *Session) SetRelinkAccountID(id int64) {
	if id <= 0 {
		delete(s.Data, "relink_account_id")
		return
	}
	s.Data["relink_account_id"] = strconv.FormatInt(id, 10)
}

// GetRelinkAccountID returns the re-link target and clears it (single-use). It
// returns 0 when the pending flow is a plain link, or the stored value is not a
// positive id.
func (s *Session) GetRelinkAccountID() int64 {
	val, ok := s.Data["relink_account_id"].(string)
	delete(s.Data, "relink_account_id")
	if !ok {
		return 0
	}
	id, err := strconv.ParseInt(val, 10, 64)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func (s *Session) SetUIRedirectPage(path string) {
	s.Data["ui_redirect"] = path
}

func (s *Session) GetUIRedirectPage() string {
	if val, ok := s.Data["ui_redirect"].(string); ok {
		delete(s.Data, "ui_redirect")
		return val
	}
	return "/"
}
