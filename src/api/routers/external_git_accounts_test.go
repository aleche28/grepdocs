package routers

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestTextOrNil(t *testing.T) {
	tests := []struct {
		name string
		in   pgtype.Text
		want *string
	}{
		{name: "value", in: pgtype.Text{String: "octocat", Valid: true}, want: new("octocat")},
		{name: "null", in: pgtype.Text{}, want: nil},
		{name: "empty string", in: pgtype.Text{String: "", Valid: true}, want: nil},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := textOrNil(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Errorf("textOrNil() = %q, want nil", *got)
			case tc.want != nil && (got == nil || *got != *tc.want):
				t.Errorf("textOrNil() = %v, want %q", got, *tc.want)
			}
		})
	}
}
