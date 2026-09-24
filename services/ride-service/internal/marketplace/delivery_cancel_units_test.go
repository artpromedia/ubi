package marketplace

import (
	"net/http"
	"testing"
)

// TestClassifyDeliveryCancelAnswerNeverGuessesPermanent pins every answer of
// the marketplace-cancel producer contract (delivery_cancel.go) to its
// handling: only named refusals are permanent, a missing route or a key
// problem is configuration, and anything else is retried.
func TestClassifyDeliveryCancelAnswerNeverGuessesPermanent(t *testing.T) {
	cases := []struct {
		status int
		code   string
		want   string
	}{
		{http.StatusNotFound, "DELIVERY_NOT_FOUND", HandoffOutcomePermanent},
		{http.StatusConflict, "DELIVERY_NOT_CANCELLABLE", HandoffOutcomePermanent},
		{http.StatusConflict, "AWARD_REPLAY_MISMATCH", HandoffOutcomePermanent},
		{http.StatusBadRequest, "VALIDATION_ERROR", HandoffOutcomePermanent},
		{http.StatusBadRequest, "INVALID_JSON", HandoffOutcomePermanent},
		{http.StatusNotFound, "", HandoffOutcomeMisconfigured},
		{http.StatusServiceUnavailable, "SERVICE_KEY_NOT_CONFIGURED", HandoffOutcomeMisconfigured},
		{http.StatusForbidden, "FORBIDDEN", HandoffOutcomeMisconfigured},
		{http.StatusUnauthorized, "", HandoffOutcomeMisconfigured},
		{http.StatusConflict, "CANCEL_IN_PROGRESS", HandoffOutcomeRetry},
		{http.StatusInternalServerError, "DATABASE_ERROR", HandoffOutcomeRetry},
		{http.StatusBadGateway, "", HandoffOutcomeRetry},
		{http.StatusNotFound, "NOT_FOUND", HandoffOutcomeRetry},
		{http.StatusConflict, "", HandoffOutcomeRetry},
	}
	for _, c := range cases {
		if got := classifyDeliveryCancelAnswer(c.status, c.code); got != c.want {
			t.Errorf("%d %q: got %s, want %s", c.status, c.code, got, c.want)
		}
	}
}
