package routers

import (
	"strings"
	"testing"
)

func TestIsValidRedirectPath(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{name: "root", in: "/", want: true},
		{name: "page", in: "/repositories/3", want: true},
		{name: "query", in: "/settings/accounts?result=linked&account_id=3", want: true},
		{name: "max length", in: "/" + strings.Repeat("a", maxRedirectPathLen-1), want: true},
		{name: "empty", in: "", want: false},
		{name: "relative", in: "repositories", want: false},
		{name: "protocol-relative", in: "//evil.com", want: false},
		{name: "double slash inside", in: "/a//b", want: false},
		{name: "absolute URL", in: "https://evil.com", want: false},
		{name: "too long", in: "/" + strings.Repeat("a", maxRedirectPathLen), want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isValidRedirectPath(tc.in); got != tc.want {
				t.Errorf("isValidRedirectPath(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
