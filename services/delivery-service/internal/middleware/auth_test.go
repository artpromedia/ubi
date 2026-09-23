package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestServiceAuthFailsClosed: the webhooks group — the marketplace hand-off
// included — admits only the exact configured service key, and an empty
// configured key admits nobody (not even a request that omits the header,
// which a plain string compare would have matched).
func TestServiceAuthFailsClosed(t *testing.T) {
	cases := []struct {
		name       string
		configured string
		presented  *string
		wantStatus int
	}{
		{"the configured key is admitted", "a-strong-service-key", strPtr("a-strong-service-key"), http.StatusOK},
		{"a wrong key is refused", "a-strong-service-key", strPtr("a-strong-service-kez"), http.StatusForbidden},
		{"a prefix of the key is refused", "a-strong-service-key", strPtr("a-strong"), http.StatusForbidden},
		{"a missing header is refused", "a-strong-service-key", nil, http.StatusForbidden},
		{"an empty configured key refuses a missing header", "", nil, http.StatusForbidden},
		{"an empty configured key refuses an empty header", "", strPtr(""), http.StatusForbidden},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var called bool
			handler := ServiceAuth(testCase.configured)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
			}))
			req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/marketplace-assign", nil)
			if testCase.presented != nil {
				req.Header.Set("X-Service-Key", *testCase.presented)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != testCase.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, testCase.wantStatus)
			}
			if called != (testCase.wantStatus == http.StatusOK) {
				t.Fatalf("handler ran = %v for status %d", called, rec.Code)
			}
		})
	}
}

func strPtr(s string) *string { return &s }
