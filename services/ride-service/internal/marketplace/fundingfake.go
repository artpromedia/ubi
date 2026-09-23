package marketplace

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// FakeFunding is the in-memory FundingPort tests drive: idempotent like the
// real one, with injectable definite failures and unknown outcomes, and a
// full record of releases so "released exactly once, with this reason" is a
// property a test can observe.
//
// The post-award amendment half follows payment-service's documented
// contract (docs/MARKETPLACE-MONEY.md, src/ledger/mp-funding-amendments.ts):
// the original reservation is never edited, each amendment adds at most one
// linked adjustment keyed by (award, amendment id), the caller's prior must be
// the funded amount (original + committed adjustments) or the call is a
// version_conflict carrying refreshedTerms, one top-up may be open per award,
// the same amendment with different terms is idempotency_key_reuse, a
// release that arrives first closes the amendment, and cash is explicitly
// unsecured. A rider's spendable is enforced only once a test sets it (the
// existing award tests never modelled rider balances).
type FakeFunding struct {
	mu   sync.Mutex
	seen map[string]bool
	// reservations maps awards that authorized a SECURED (non-cash) funding
	// to the fake reservation id the authorize answered.
	reservations map[uuid.UUID]string
	// originals is each secured award's original reservation.
	originals map[uuid.UUID]*fakeFundingReservation
	// adjustments are the amendment rows, keyed award|amendment.
	adjustments map[string]*fakeFundingAdjustment
	// riderSpendable is each requester's spendable, when a test set one.
	riderSpendable map[uuid.UUID]int64

	// Fail makes the next Authorize calls answer this definite refusal.
	Fail error
	// Unknown makes Authorize record the authorization but answer
	// ErrWalletUnknownOutcome, which is what a lost response looks like.
	Unknown bool
	// FailRelease makes the next Release calls answer this error.
	FailRelease error
	// Consumed marks awards whose reservation the settlement already
	// consumed: Release answers ErrFundingReservationConsumed for them.
	Consumed map[uuid.UUID]bool

	// Amendment failure injection. A non-nil error fails the matching call
	// without applying it; UnknownCommitTopUp applies the commit and then
	// answers ErrWalletUnknownOutcome.
	FailTopUp          error
	FailCommitTopUp    error
	FailReleaseTopUp   error
	FailPartialRelease error
	UnknownCommitTopUp bool

	// Calls counts every Authorize; EffectiveCalls counts non-replayed ones.
	Calls          int
	EffectiveCalls int
	// ReleaseCalls counts every Release; EffectiveReleases counts
	// non-replayed ones. ReleasedAwards records each award's release reason.
	ReleaseCalls      int
	EffectiveReleases int
	ReleasedAwards    map[uuid.UUID]string

	// Amendment counters: every call, and the ones that moved money.
	TopUpCalls               int
	EffectiveTopUps          int
	CommitTopUpCalls         int
	EffectiveTopUpCommits    int
	ReleaseTopUpCalls        int
	EffectiveTopUpReleases   int
	PartialReleaseCalls      int
	EffectivePartialReleases int
}

type fakeFundingReservation struct {
	requesterID     uuid.UUID
	paymentMethodID string
	currency        string
	amountMinor     int64
	status          string // active | released | consumed
}

type fakeFundingAdjustment struct {
	kind     string // top_up | partial_release | none
	status   string // reserved | committed | released
	delta    int64
	prior    int64
	newTotal int64
	terms    string
}

// NewFakeFunding builds an empty fake.
func NewFakeFunding() *FakeFunding {
	return &FakeFunding{
		seen:           map[string]bool{},
		reservations:   map[uuid.UUID]string{},
		originals:      map[uuid.UUID]*fakeFundingReservation{},
		adjustments:    map[string]*fakeFundingAdjustment{},
		riderSpendable: map[uuid.UUID]int64{},
		Consumed:       map[uuid.UUID]bool{},
		ReleasedAwards: map[uuid.UUID]string{},
	}
}

// SetRiderSpendable sets a requester's spendable balance; from then on a
// top-up that does not fit answers insufficient_funds.
func (f *FakeFunding) SetRiderSpendable(requesterID uuid.UUID, minor int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.riderSpendable[requesterID] = minor
}

// RiderSpendable reads a requester's remaining spendable (when one was set).
func (f *FakeFunding) RiderSpendable(requesterID uuid.UUID) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.riderSpendable[requesterID]
}

// FundedAmount is what an award is funded to: the original reservation plus
// every committed adjustment (a partial release counts negative). Zero for
// an award with no secured reservation.
func (f *FakeFunding) FundedAmount(awardID uuid.UUID) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fundedLocked(awardID)
}

// OpenTopUps counts an award's reserved, uncommitted top-ups.
func (f *FakeFunding) OpenTopUps(awardID uuid.UUID) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	open := 0
	prefix := awardID.String() + "|"
	for key, adjustment := range f.adjustments {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix && adjustment.status == "reserved" {
			open++
		}
	}
	return open
}

func (f *FakeFunding) fundedLocked(awardID uuid.UUID) int64 {
	original, ok := f.originals[awardID]
	if !ok {
		return 0
	}
	funded := original.amountMinor
	prefix := awardID.String() + "|"
	for key, adjustment := range f.adjustments {
		if len(key) <= len(prefix) || key[:len(prefix)] != prefix || adjustment.status != "committed" {
			continue
		}
		if adjustment.kind == "partial_release" {
			funded -= adjustment.delta
		} else {
			funded += adjustment.delta
		}
	}
	return funded
}

// Authorize implements FundingPort.
func (f *FakeFunding) Authorize(_ context.Context, req FundingRequest, idempotencyKey string) (*FundingAuthorization, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls++
	if f.Fail != nil {
		return nil, f.Fail
	}
	if !f.seen[idempotencyKey] {
		f.seen[idempotencyKey] = true
		f.EffectiveCalls++
	}
	if req.PaymentMethodID != "cash" {
		if _, ok := f.originals[req.AwardID]; !ok {
			f.originals[req.AwardID] = &fakeFundingReservation{
				requesterID:     req.RequesterID,
				paymentMethodID: req.PaymentMethodID,
				currency:        req.Currency,
				amountMinor:     req.AmountMinor,
				status:          "active",
			}
			if spendable, bounded := f.riderSpendable[req.RequesterID]; bounded {
				f.riderSpendable[req.RequesterID] = spendable - req.AmountMinor
			}
		}
	}
	if f.Unknown {
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	auth := &FundingAuthorization{
		Authorized:      true,
		AwardID:         req.AwardID.String(),
		PaymentMethodID: req.PaymentMethodID,
	}
	if req.PaymentMethodID != "cash" {
		reservationID, ok := f.reservations[req.AwardID]
		if !ok {
			reservationID = "mfr_" + uuid.NewString()
			f.reservations[req.AwardID] = reservationID
		}
		auth.Secured = true
		auth.ReservationID = &reservationID
	}
	return auth, nil
}

// Release implements FundingPort: exactly-once per award, forgiving like the
// real endpoint (missing/already-released answer nil), consumed distinct. The
// award's amendment adjustments are released with it, as payment-service
// does.
func (f *FakeFunding) Release(_ context.Context, awardID uuid.UUID, reason string, idempotencyKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReleaseCalls++
	if f.FailRelease != nil {
		return f.FailRelease
	}
	if f.Consumed[awardID] {
		return fmt.Errorf("%w: award %s", ErrFundingReservationConsumed, awardID)
	}
	if f.seen[idempotencyKey] {
		return nil
	}
	f.seen[idempotencyKey] = true
	if _, released := f.ReleasedAwards[awardID]; !released {
		if _, had := f.reservations[awardID]; had {
			f.EffectiveReleases++
		}
		f.ReleasedAwards[awardID] = reason
	}
	if original, ok := f.originals[awardID]; ok && original.status == "active" {
		funded := f.fundedLocked(awardID)
		original.status = "released"
		open := int64(0)
		prefix := awardID.String() + "|"
		for key, adjustment := range f.adjustments {
			if len(key) > len(prefix) && key[:len(prefix)] == prefix && adjustment.status == "reserved" {
				adjustment.status = "released"
				open += adjustment.delta
			}
		}
		if spendable, bounded := f.riderSpendable[original.requesterID]; bounded {
			f.riderSpendable[original.requesterID] = spendable + funded + open
		}
	}
	return nil
}

func fundingAdjustmentKey(awardID uuid.UUID, amendmentID string) string {
	return awardID.String() + "|" + amendmentID
}

func fundingTerms(op string, req FundingAmendment) string {
	return fmt.Sprintf("%s|%s|%s|%s|%d|%d|%s|%s", op, req.RequesterID, req.PaymentMethodID,
		req.AmendmentID, req.PriorAmountMinor, req.NewAmountMinor, req.Currency, req.CityID)
}

// adjustmentView renders the wire answer for one adjustment row.
func (f *FakeFunding) adjustmentView(awardID uuid.UUID, amendmentID string, adjustment *fakeFundingAdjustment, replayed bool) *FundingAdjustment {
	reservationID := f.reservations[awardID]
	adjustmentID := "mra_" + digest(fundingAdjustmentKey(awardID, amendmentID))
	view := &FundingAdjustment{
		AwardID:       awardID.String(),
		AmendmentID:   amendmentID,
		Kind:          adjustment.kind,
		Secured:       true,
		Status:        adjustment.status,
		AdjustmentID:  &adjustmentID,
		ReservationID: &reservationID,
		DeltaMinor:    adjustment.delta,
		Replayed:      replayed,
	}
	if adjustment.kind != "none" {
		prior, next := adjustment.prior, adjustment.newTotal
		view.PriorAmountMinor = &prior
		view.NewAmountMinor = &next
	}
	if original, ok := f.originals[awardID]; ok {
		currency := original.currency
		view.Currency = &currency
	}
	return view
}

func unsecuredAdjustment(req FundingAmendment, kind string) *FundingAdjustment {
	delta := req.NewAmountMinor - req.PriorAmountMinor
	if delta < 0 {
		delta = -delta
	}
	prior, next, currency := req.PriorAmountMinor, req.NewAmountMinor, req.Currency
	return &FundingAdjustment{
		AwardID: req.AwardID.String(), AmendmentID: req.AmendmentID, Kind: kind,
		Secured: false, Status: "unsecured", DeltaMinor: delta,
		PriorAmountMinor: &prior, NewAmountMinor: &next, Currency: &currency,
	}
}

// amendableOriginal checks the award's original reservation exactly as
// payment-service's requireWalletOriginal + active-status guard do.
func (f *FakeFunding) amendableOriginal(req FundingAmendment) (*fakeFundingReservation, error) {
	original, ok := f.originals[req.AwardID]
	if !ok {
		return nil, domain.Errorf(domain.CodeConflict, "this award has no wallet funding reservation to amend").
			WithDetails(map[string]any{"awardId": req.AwardID.String()})
	}
	if original.requesterID != req.RequesterID || original.paymentMethodID != req.PaymentMethodID ||
		original.currency != req.Currency {
		return nil, domain.Errorf(domain.CodeConflict, "this award's funding reservation has different terms")
	}
	if original.status != "active" {
		return nil, domain.Errorf(domain.CodeConflict, "this award's funding reservation is no longer active").
			WithDetails(map[string]any{"status": original.status})
	}
	return original, nil
}

// replayOrRefuse answers an existing adjustment row for the same amendment:
// the original outcome for the same terms, a conflict for a closed one,
// idempotency_key_reuse for different terms.
func (f *FakeFunding) replayOrRefuse(req FundingAmendment, terms string) (*FundingAdjustment, error) {
	existing, ok := f.adjustments[fundingAdjustmentKey(req.AwardID, req.AmendmentID)]
	if !ok {
		return nil, nil
	}
	if existing.terms != terms {
		if existing.kind == "none" {
			return nil, domain.Errorf(domain.CodeConflict,
				"this amendment was already released; it cannot adjust the award's funding")
		}
		return nil, domain.Errorf(domain.CodeIdempotencyKeyReuse,
			"this amendment already adjusted the award's funding with different terms")
	}
	return f.adjustmentView(req.AwardID, req.AmendmentID, existing, true), nil
}

// openTopUpConflict refuses a second open top-up on one award.
func (f *FakeFunding) openTopUpConflict(awardID uuid.UUID) error {
	prefix := awardID.String() + "|"
	for key, adjustment := range f.adjustments {
		if len(key) > len(prefix) && key[:len(prefix)] == prefix && adjustment.status == "reserved" {
			return domain.Errorf(domain.CodeConflict, "another amendment's top-up is still open on this award").
				WithDetails(map[string]any{"refreshedTerms": map[string]any{"fundedAmountMinor": f.fundedLocked(awardID)}})
		}
	}
	return nil
}

func staleFundingPrior(funded, prior int64) error {
	return domain.Errorf(domain.CodeVersionConflict,
		"the prior amount is not what the award is funded to; refresh and retry").
		WithDetails(map[string]any{
			"priorAmountMinor": prior,
			"refreshedTerms":   map[string]any{"fundedAmountMinor": funded},
		})
}

// TopUp implements FundingPort.
func (f *FakeFunding) TopUp(_ context.Context, req FundingAmendment, _ string) (*FundingAdjustment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.TopUpCalls++
	if f.FailTopUp != nil {
		return nil, f.FailTopUp
	}
	if req.NewAmountMinor <= req.PriorAmountMinor || req.PriorAmountMinor <= 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a top-up is only for an increase; a decrease is a partial release at commit")
	}
	if req.PaymentMethodID == "cash" {
		return unsecuredAdjustment(req, "top_up"), nil
	}
	terms := fundingTerms("top_up", req)
	if replay, err := f.replayOrRefuse(req, terms); replay != nil || err != nil {
		return replay, err
	}
	original, err := f.amendableOriginal(req)
	if err != nil {
		return nil, err
	}
	if err := f.openTopUpConflict(req.AwardID); err != nil {
		return nil, err
	}
	funded := f.fundedLocked(req.AwardID)
	if funded != req.PriorAmountMinor {
		return nil, staleFundingPrior(funded, req.PriorAmountMinor)
	}
	delta := req.NewAmountMinor - funded
	if spendable, bounded := f.riderSpendable[original.requesterID]; bounded {
		if spendable < delta {
			return nil, domain.Errorf(domain.CodeInsufficientFunds, "the wallet cannot cover the amended fare").
				WithDetails(map[string]any{"requiredMinor": delta, "spendableMinor": spendable, "shortfallMinor": delta - spendable})
		}
		f.riderSpendable[original.requesterID] = spendable - delta
	}
	adjustment := &fakeFundingAdjustment{kind: "top_up", status: "reserved", delta: delta, prior: funded, newTotal: req.NewAmountMinor, terms: terms}
	f.adjustments[fundingAdjustmentKey(req.AwardID, req.AmendmentID)] = adjustment
	f.EffectiveTopUps++
	return f.adjustmentView(req.AwardID, req.AmendmentID, adjustment, false), nil
}

// CommitTopUp implements FundingPort.
func (f *FakeFunding) CommitTopUp(_ context.Context, awardID uuid.UUID, amendmentID string, newAmountMinor int64, _ string) (*FundingAdjustment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CommitTopUpCalls++
	if f.FailCommitTopUp != nil {
		return nil, f.FailCommitTopUp
	}
	original, ok := f.originals[awardID]
	if !ok {
		return &FundingAdjustment{AwardID: awardID.String(), AmendmentID: amendmentID, Kind: "none", Status: "unsecured"}, nil
	}
	adjustment, ok := f.adjustments[fundingAdjustmentKey(awardID, amendmentID)]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no top-up is reserved for this amendment")
	}
	if adjustment.kind != "top_up" {
		return nil, domain.Errorf(domain.CodeConflict, "this amendment's adjustment is not a top-up; there is nothing to commit")
	}
	if adjustment.newTotal != newAmountMinor {
		return nil, domain.Errorf(domain.CodeConflict, "the committed amount is not the amount this top-up reserved for")
	}
	switch adjustment.status {
	case "committed":
		return f.adjustmentView(awardID, amendmentID, adjustment, true), nil
	case "released":
		return nil, domain.Errorf(domain.CodeConflict, "this amendment's top-up was released; it can no longer commit")
	}
	if original.status != "active" {
		return nil, domain.Errorf(domain.CodeConflict, "this award's funding reservation is no longer active")
	}
	funded := f.fundedLocked(awardID)
	if funded+adjustment.delta != newAmountMinor {
		return nil, staleFundingPrior(funded, newAmountMinor-adjustment.delta)
	}
	adjustment.status = "committed"
	f.EffectiveTopUpCommits++
	if f.UnknownCommitTopUp {
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return f.adjustmentView(awardID, amendmentID, adjustment, false), nil
}

// ReleaseTopUp implements FundingPort.
func (f *FakeFunding) ReleaseTopUp(_ context.Context, awardID uuid.UUID, amendmentID, _ string, _ string) (*FundingAdjustment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReleaseTopUpCalls++
	if f.FailReleaseTopUp != nil {
		return nil, f.FailReleaseTopUp
	}
	original, ok := f.originals[awardID]
	if !ok {
		return &FundingAdjustment{AwardID: awardID.String(), AmendmentID: amendmentID, Kind: "none", Status: "missing"}, nil
	}
	key := fundingAdjustmentKey(awardID, amendmentID)
	adjustment, ok := f.adjustments[key]
	if !ok {
		closed := &fakeFundingAdjustment{kind: "none", status: "released", terms: "closed"}
		f.adjustments[key] = closed
		return f.adjustmentView(awardID, amendmentID, closed, false), nil
	}
	switch {
	case adjustment.kind == "partial_release":
		return nil, domain.Errorf(domain.CodeConflict, "this amendment committed a partial release; there is no top-up to release")
	case adjustment.status == "released":
		return f.adjustmentView(awardID, amendmentID, adjustment, true), nil
	case adjustment.status == "committed":
		return nil, domain.Errorf(domain.CodeConflict, "this amendment's top-up was committed; a fare decrease is a partial release")
	}
	adjustment.status = "released"
	if spendable, bounded := f.riderSpendable[original.requesterID]; bounded {
		f.riderSpendable[original.requesterID] = spendable + adjustment.delta
	}
	f.EffectiveTopUpReleases++
	return f.adjustmentView(awardID, amendmentID, adjustment, false), nil
}

// PartialRelease implements FundingPort.
func (f *FakeFunding) PartialRelease(_ context.Context, req FundingAmendment, _ string) (*FundingAdjustment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.PartialReleaseCalls++
	if f.FailPartialRelease != nil {
		return nil, f.FailPartialRelease
	}
	if req.NewAmountMinor >= req.PriorAmountMinor || req.NewAmountMinor <= 0 {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a partial release is only for a decrease; an increase is a top-up")
	}
	if req.PaymentMethodID == "cash" {
		return unsecuredAdjustment(req, "partial_release"), nil
	}
	terms := fundingTerms("partial_release", req)
	if replay, err := f.replayOrRefuse(req, terms); replay != nil || err != nil {
		return replay, err
	}
	original, err := f.amendableOriginal(req)
	if err != nil {
		return nil, err
	}
	if err := f.openTopUpConflict(req.AwardID); err != nil {
		return nil, err
	}
	funded := f.fundedLocked(req.AwardID)
	if funded != req.PriorAmountMinor {
		return nil, staleFundingPrior(funded, req.PriorAmountMinor)
	}
	delta := funded - req.NewAmountMinor
	adjustment := &fakeFundingAdjustment{kind: "partial_release", status: "committed", delta: delta, prior: funded, newTotal: req.NewAmountMinor, terms: terms}
	f.adjustments[fundingAdjustmentKey(req.AwardID, req.AmendmentID)] = adjustment
	if spendable, bounded := f.riderSpendable[original.requesterID]; bounded {
		f.riderSpendable[original.requesterID] = spendable + delta
	}
	f.EffectivePartialReleases++
	return f.adjustmentView(req.AwardID, req.AmendmentID, adjustment, false), nil
}
