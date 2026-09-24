package marketplace

import (
	"errors"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// TestExecutionPaymentMethodHidesOnlyTheBusinessPayer: an execution ride
// says paid_by_ubi for a business request and keeps every other method —
// cash above all, which the driver must know to collect.
func TestExecutionPaymentMethodHidesOnlyTheBusinessPayer(t *testing.T) {
	for method, want := range map[string]string{
		PaymentMethodBusiness: PaymentMethodPaidByUBI,
		"cash":                "cash",
		"wallet":              "wallet",
		"card":                "card",
	} {
		if got := executionPaymentMethod(method); got != want {
			t.Errorf("%s: the execution ride carries %q, want %q", method, got, want)
		}
	}
}

// TestBusinessTopUpRefusalNamesTheOrganization: a refused raise keeps
// payment-service's code and reason, says the trip continues on the agreed
// terms, and names the organization's refusal on the amendment — never the
// driver's spendable, whatever the code.
func TestBusinessTopUpRefusalNamesTheOrganization(t *testing.T) {
	refused := domain.Errorf(domain.CodeInsufficientSpendable, "this cost centre's budget cannot cover the booking").
		WithDetails(map[string]any{"reason": BusinessReasonBudgetInsufficient, "availableMinor": 0})
	err := businessTopUpRefusal(refused, BusinessIncreaseFareIncrease, "")
	mapped, ok := domain.AsError(err)
	if !ok || mapped.Code != domain.CodeInsufficientSpendable || mapped.Details["reason"] != BusinessReasonBudgetInsufficient ||
		mapped.Details["stage"] != BusinessIncreaseFareIncrease || !errors.Is(err, refused) {
		t.Fatalf("the refusal keeps the organization's code and reason: %+v", mapped)
	}
	if got := refusalReason(err); got != "business_budget_insufficient" {
		t.Fatalf("the amendment names the organization's refusal: %q", got)
	}
	unexplained := businessTopUpRefusal(domain.Errorf(domain.CodeConflict, "other terms"), BusinessIncreasePaidWaiting, "")
	if got := refusalReason(unexplained); got != "business_refused" {
		t.Fatalf("a refusal without a reason still names the organization: %q", got)
	}
}
