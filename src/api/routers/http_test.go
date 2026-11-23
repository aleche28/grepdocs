package routers

import "testing"

func TestFrontendURL(t *testing.T) {
	tests := []struct {
		name string
		env  string
		want string
	}{
		{name: "unset uses the dev default", env: "", want: "http://localhost:5173"},
		{name: "as set", env: "https://app.example.com", want: "https://app.example.com"},
		{name: "trailing slash trimmed", env: "https://app.example.com/", want: "https://app.example.com"},
		{name: "only slashes uses the default", env: "/", want: "http://localhost:5173"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("FRONTEND_URL", tc.env)
			if got := frontendURL(); got != tc.want {
				t.Errorf("frontendURL() = %q, want %q", got, tc.want)
			}
		})
	}
}
