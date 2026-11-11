package routers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestParsePositiveID(t *testing.T) {
	tests := []struct {
		in      string
		want    int64
		wantErr bool
	}{
		{in: "1", want: 1},
		{in: "9223372036854775807", want: 9223372036854775807},
		{in: "0", wantErr: true},
		{in: "-3", wantErr: true},
		{in: "", wantErr: true},
		{in: "abc", wantErr: true},
		{in: "1.5", wantErr: true},
		{in: "9223372036854775808", wantErr: true}, // overflows int64
	}

	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := parsePositiveID(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("parsePositiveID(%q) error = %v, wantErr %v", tc.in, err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("parsePositiveID(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseIDParam(t *testing.T) {
	tests := []struct {
		param      string
		want       int64
		wantOK     bool
		wantStatus int
	}{
		{param: "42", want: 42, wantOK: true, wantStatus: http.StatusOK},
		{param: "0", wantStatus: http.StatusBadRequest},
		{param: "abc", wantStatus: http.StatusBadRequest},
	}

	for _, tc := range tests {
		t.Run(tc.param, func(t *testing.T) {
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", tc.param)
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
			rr := httptest.NewRecorder()

			got, ok := parseIDParam(rr, r)
			if ok != tc.wantOK || got != tc.want {
				t.Errorf("parseIDParam() = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.wantOK)
			}
			if rr.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rr.Code, tc.wantStatus)
			}
		})
	}
}

func TestParseRepositoryIDParam(t *testing.T) {
	tests := []struct {
		in      string
		want    pgtype.Int8
		wantErr bool
	}{
		{in: "", want: pgtype.Int8{}},
		{in: "7", want: pgtype.Int8{Int64: 7, Valid: true}},
		{in: "0", wantErr: true},
		{in: "x", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := parseRepositoryIDParam(tc.in)
			if (err != nil) != tc.wantErr {
				t.Fatalf("parseRepositoryIDParam(%q) error = %v, wantErr %v", tc.in, err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("parseRepositoryIDParam(%q) = %+v, want %+v", tc.in, got, tc.want)
			}
		})
	}
}
