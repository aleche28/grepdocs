package models

import (
	"encoding/json"
	"testing"
)

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

func TestRelinkAccountID(t *testing.T) {
	t.Run("single-use", func(t *testing.T) {
		s := &Session{Data: map[string]any{}}
		s.SetRelinkAccountID(42)

		if got := s.GetRelinkAccountID(); got != 42 {
			t.Fatalf("first GetRelinkAccountID() = %d, want 42", got)
		}
		if got := s.GetRelinkAccountID(); got != 0 {
			t.Errorf("second GetRelinkAccountID() = %d, want 0 (single-use)", got)
		}
	})

	t.Run("unset is 0", func(t *testing.T) {
		s := &Session{Data: map[string]any{}}
		if got := s.GetRelinkAccountID(); got != 0 {
			t.Errorf("GetRelinkAccountID() = %d, want 0", got)
		}
	})

	t.Run("plain link clears an abandoned target", func(t *testing.T) {
		s := &Session{Data: map[string]any{}}
		s.SetRelinkAccountID(42) // re-link started, never finished
		s.SetRelinkAccountID(0)  // then a plain link

		if got := s.GetRelinkAccountID(); got != 0 {
			t.Errorf("GetRelinkAccountID() = %d, want 0", got)
		}
		if _, ok := s.Data["relink_account_id"]; ok {
			t.Errorf("Data still has relink_account_id after clearing")
		}
	})

	t.Run("survives a JSON round-trip", func(t *testing.T) {
		// RedisSessionStore stores sessions as JSON; use an id above 2^53 so a
		// float64 detour would lose precision
		const id int64 = 1<<53 + 1
		s := &Session{Data: map[string]any{}}
		s.SetRelinkAccountID(id)

		blob, err := json.Marshal(s)
		if err != nil {
			t.Fatalf("Marshal: %v", err)
		}
		var loaded Session
		if err := json.Unmarshal(blob, &loaded); err != nil {
			t.Fatalf("Unmarshal: %v", err)
		}

		if got := loaded.GetRelinkAccountID(); got != id {
			t.Errorf("GetRelinkAccountID() after round-trip = %d, want %d", got, id)
		}
	})

	t.Run("malformed value is 0 and cleared", func(t *testing.T) {
		for _, v := range []any{"abc", "-3", "0", float64(42)} {
			s := &Session{Data: map[string]any{"relink_account_id": v}}
			if got := s.GetRelinkAccountID(); got != 0 {
				t.Errorf("GetRelinkAccountID() with %#v = %d, want 0", v, got)
			}
			if _, ok := s.Data["relink_account_id"]; ok {
				t.Errorf("Data still has relink_account_id (%#v) after reading", v)
			}
		}
	})
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
