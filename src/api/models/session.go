package models

import "time"

type Session struct {
	CreatedAt      time.Time
	LastActivityAt time.Time
	Id             string
	UserId         int64
	Authenticated  bool
	Data           map[string]any
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

func (s *Session) SetUserId(id int64) {
	s.UserId = id
	s.Authenticated = id > 0
}

func (s *Session) GetUserId() int64 {
	return s.UserId
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
