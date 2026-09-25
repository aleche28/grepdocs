package models

import "testing"

func TestSetUserID(t *testing.T) {
	tests := []struct {
		name     string
		id       int64
		wantAuth bool
	}{
		{name: "positive id authenticates", id: 42, wantAuth: true},
		{name: "zero id does not authenticate", id: 0, wantAuth: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := &Session{Data: map[string]any{}}
			s.SetUserID(tc.id)

			if s.GetUserID() != tc.id {
				t.Errorf("GetUserID() = %d, want %d", s.GetUserID(), tc.id)
			}
			if s.IsAuthenticated() != tc.wantAuth {
				t.Errorf("IsAuthenticated() = %v, want %v", s.IsAuthenticated(), tc.wantAuth)
			}
		})
	}
}

func TestOAuthStateTokenIsSingleUse(t *testing.T) {
	s := &Session{Data: map[string]any{}}
	s.SetOAuthStateToken("state-123")

	if got := s.GetOAuthStateToken(); got != "state-123" {
		t.Fatalf("first GetOAuthStateToken() = %q, want %q", got, "state-123")
	}
	if got := s.GetOAuthStateToken(); got != "" {
		t.Errorf("second GetOAuthStateToken() = %q, want empty (single-use)", got)
	}
}

func TestUIRedirectPageIsSingleUseWithDefault(t *testing.T) {
	s := &Session{Data: map[string]any{}}

	if got := s.GetUIRedirectPage(); got != "/" {
		t.Fatalf("unset GetUIRedirectPage() = %q, want %q", got, "/")
	}

	s.SetUIRedirectPage("/settings/accounts")
	if got := s.GetUIRedirectPage(); got != "/settings/accounts" {
		t.Fatalf("GetUIRedirectPage() = %q, want %q", got, "/settings/accounts")
	}
	if got := s.GetUIRedirectPage(); got != "/" {
		t.Errorf("second GetUIRedirectPage() = %q, want default %q (single-use)", got, "/")
	}
}

func TestDataPutGetDelete(t *testing.T) {
	s := &Session{Data: map[string]any{}}

	s.Put("k", "v")
	if got := s.Get("k"); got != "v" {
		t.Errorf("Get(k) = %v, want v", got)
	}

	s.Delete("k")
	if got := s.Get("k"); got != nil {
		t.Errorf("Get(k) after Delete = %v, want nil", got)
	}
}
