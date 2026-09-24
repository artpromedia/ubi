package marketplace

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// FakeWallet is the in-memory WalletPort used by tests: a configurable
// spendable balance per driver, a full call record, and injectable failures
// and unknown outcomes. It enforces the same idempotency AND the same wire
// semantics the real wallet does — Money-shaped amounts, the capture's
// expected-amount pin — so "released exactly once" and "never captured at
// unawarded terms" are properties a test can actually observe.
type FakeWallet struct {
	mu sync.Mutex

	// SpendableMinor is each driver's cleared spendable balance.
	spendable map[uuid.UUID]int64

	holds map[string]*Hold
	// seenKeys maps idempotency keys to the reservation they acted on, so a
	// replayed call is a no-op with the original answer.
	seenKeys map[string]string

	// captures stores each capture's receipt by idempotency key, so a replay
	// answers the ORIGINAL receipt, exactly as the real wallet does.
	captures map[string]*CaptureResult

	// Injectable failures. A non-nil error fails the next matching call; an
	// entry in Unknown* makes the call return ErrWalletUnknownOutcome AFTER
	// applying it, which is what a lost response looks like.
	FailReserve    error
	FailAdjust     error
	FailRelease    error
	FailCapture    error
	FailReverse    error
	UnknownReserve bool
	UnknownCapture bool

	// Interleaving hooks, called WITHOUT the fake's lock held so a test can
	// drive a competing call from inside the window a real deployment has
	// between two wallet round-trips. BeforeAdjust and BeforeCapture are
	// self-clearing (they fire once); BeforeReserve persists (a barrier).
	BeforeReserve func()
	BeforeAdjust  func()
	BeforeCapture func()

	// Post-award commission deltas (docs/MARKETPLACE-MONEY.md). captured
	// is each captured hold's running total — the original capture plus
	// captured increments minus refunds — and awardOf the award it was
	// captured under; deltas are the increment rows keyed
	// reservation|amendment (a zero row is a release that closed an
	// amendment before any reserve), refunds the committed decreases.
	captured map[string]int64
	awardOf  map[string]string
	deltas   map[string]*fakeDelta
	refunds  map[string]*fakeDelta

	// Amendment failure injection: a non-nil error fails the matching call
	// without applying it; UnknownDeltaCapture applies the capture and then
	// answers ErrWalletUnknownOutcome (a lost response). BeforeDeltaCapture
	// is self-clearing, called without the lock.
	FailDeltaReserve    error
	FailDeltaCapture    error
	FailDeltaRelease    error
	FailDeltaRefund     error
	UnknownDeltaCapture bool
	BeforeDeltaCapture  func()

	// Amendment counters: every call, and the effective (money-moving,
	// non-replayed) ones per amendment.
	DeltaReserveCalls int
	DeltaCaptureCalls int
	DeltaReleaseCalls int
	DeltaRefundCalls  int
	// DeltaCapturesByAmendment must never exceed 1 per amendment.
	DeltaCapturesByAmendment map[string]int
	DeltaRefundsByAmendment  map[string]int
	DeltaReleasesByAmendment map[string]int

	// Counters a test asserts on.
	ReserveCalls int
	AdjustCalls  int
	ReleaseCalls int
	CaptureCalls int
	ReverseCalls int
	// ReleasesByReservation counts effective (non-replayed) releases.
	ReleasesByReservation map[string]int
	// CapturesByReservation counts effective (non-replayed) captures: the
	// number of times money actually moved for one hold. It must never exceed 1.
	CapturesByReservation map[string]int
	// ReversalsByReservation counts effective (non-replayed) reversals.
	ReversalsByReservation map[string]int
}

// NewFakeWallet builds an empty fake.
func NewFakeWallet() *FakeWallet {
	return &FakeWallet{
		spendable:              map[uuid.UUID]int64{},
		holds:                  map[string]*Hold{},
		seenKeys:               map[string]string{},
		captures:               map[string]*CaptureResult{},
		ReleasesByReservation:  map[string]int{},
		CapturesByReservation:  map[string]int{},
		ReversalsByReservation: map[string]int{},

		captured:                 map[string]int64{},
		awardOf:                  map[string]string{},
		deltas:                   map[string]*fakeDelta{},
		refunds:                  map[string]*fakeDelta{},
		DeltaCapturesByAmendment: map[string]int{},
		DeltaRefundsByAmendment:  map[string]int{},
		DeltaReleasesByAmendment: map[string]int{},
	}
}

// fakeDelta is one amendment's commission row against a captured hold.
type fakeDelta struct {
	awardID  string
	state    string // active | captured | released | refunded
	delta    int64
	prior    int64
	newTotal int64
	newBase  int64
	terms    string
	closed   bool // released before any reserve: direction none
}

// SetSpendable sets a driver's spendable balance.
func (f *FakeWallet) SetSpendable(driverID uuid.UUID, minor int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.spendable[driverID] = minor
}

// Spendable reads a driver's remaining spendable balance.
func (f *FakeWallet) Spendable(driverID uuid.UUID) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.spendable[driverID]
}

// Holds returns a copy of the current holds.
func (f *FakeWallet) Holds() map[string]Hold {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]Hold{}
	for id, hold := range f.holds {
		out[id] = *hold
	}
	return out
}

// Reserve implements WalletPort.
func (f *FakeWallet) Reserve(_ context.Context, req ReserveRequest, idempotencyKey string) (*Hold, error) {
	if hook := f.BeforeReserve; hook != nil {
		hook()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReserveCalls++
	if f.FailReserve != nil {
		err := f.FailReserve
		return nil, err
	}
	if reservationID, seen := f.seenKeys[idempotencyKey]; seen {
		if f.UnknownReserve {
			return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
		}
		return f.holds[reservationID], nil
	}
	if f.spendable[req.DriverID] < req.AmountMinor.AmountMinor {
		shortfall := req.AmountMinor.AmountMinor - f.spendable[req.DriverID]
		return nil, domain.Errorf(domain.CodeInsufficientSpendable,
			"the spendable balance does not cover this commission").
			WithDetails(map[string]any{"shortfallMinor": shortfall})
	}
	f.spendable[req.DriverID] -= req.AmountMinor.AmountMinor
	hold := &Hold{
		ReservationID: "res_" + uuid.NewString(),
		BidID:         req.BidID.String(),
		DriverID:      req.DriverID.String(),
		State:         machine.MpHoldActive,
		AmountMinor:   req.AmountMinor,
		BaseMinor:     req.BaseMinor,
		PolicyVersion: req.PolicyVersion,
	}
	f.holds[hold.ReservationID] = hold
	f.seenKeys[idempotencyKey] = hold.ReservationID
	if f.UnknownReserve {
		// The reservation happened, but the caller never learns it did.
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return hold, nil
}

// Adjust implements WalletPort: an atomic raise/lower of one hold.
func (f *FakeWallet) Adjust(_ context.Context, reservationID string, amountMinor, baseMinor Money, idempotencyKey string) (*Hold, error) {
	if hook := f.BeforeAdjust; hook != nil {
		f.BeforeAdjust = nil
		hook()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.AdjustCalls++
	if f.FailAdjust != nil {
		return nil, f.FailAdjust
	}
	if _, seen := f.seenKeys[idempotencyKey]; seen {
		return f.holds[reservationID], nil
	}
	hold, ok := f.holds[reservationID]
	if !ok || hold.State != machine.MpHoldActive {
		return nil, domain.Errorf(domain.CodeNotFound, "no active hold %s", reservationID)
	}
	driverID := uuid.MustParse(hold.DriverID)
	delta := amountMinor.AmountMinor - hold.AmountMinor.AmountMinor
	if delta > 0 && f.spendable[driverID] < delta {
		return nil, domain.Errorf(domain.CodeInsufficientSpendable,
			"the spendable balance does not cover the raise").
			WithDetails(map[string]any{"shortfallMinor": delta - f.spendable[driverID]})
	}
	f.spendable[driverID] -= delta
	hold.AmountMinor = amountMinor
	hold.BaseMinor = baseMinor
	f.seenKeys[idempotencyKey] = reservationID
	return hold, nil
}

// Release implements WalletPort: releases a hold exactly once.
func (f *FakeWallet) Release(_ context.Context, reservationID string, idempotencyKey string) (*Hold, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReleaseCalls++
	if f.FailRelease != nil {
		return nil, f.FailRelease
	}
	if _, seen := f.seenKeys[idempotencyKey]; seen {
		return f.holds[reservationID], nil
	}
	hold, ok := f.holds[reservationID]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no hold %s", reservationID)
	}
	f.seenKeys[idempotencyKey] = reservationID
	if hold.State != machine.MpHoldActive {
		// Already terminal: answer the state without moving money again.
		return hold, nil
	}
	hold.State = machine.MpHoldReleased
	f.spendable[uuid.MustParse(hold.DriverID)] += hold.AmountMinor.AmountMinor
	f.ReleasesByReservation[reservationID]++
	return hold, nil
}

// Capture implements WalletPort: the single commission debit, idempotent on
// its key, REFUSED with a definite conflict when the hold's current amount is
// not the award's pinned commission. A replay answers the ORIGINAL receipt
// without moving money again.
func (f *FakeWallet) Capture(_ context.Context, reservationID, awardID string, expectedAmountMinor Money, idempotencyKey string) (*CaptureResult, error) {
	if hook := f.BeforeCapture; hook != nil {
		f.BeforeCapture = nil
		hook()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CaptureCalls++
	if f.FailCapture != nil {
		return nil, f.FailCapture
	}
	if replay, seen := f.captures[idempotencyKey]; seen {
		if f.UnknownCapture {
			return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
		}
		return replay, nil
	}
	hold, ok := f.holds[reservationID]
	if !ok || (hold.State != machine.MpHoldActive && hold.State != machine.MpHoldCapturePending) {
		return nil, domain.Errorf(domain.CodeNotFound, "no capturable hold %s", reservationID)
	}
	if hold.AmountMinor.AmountMinor != expectedAmountMinor.AmountMinor {
		// The hold no longer holds the awarded terms (a revise raced the
		// selection): a DEFINITE refusal the saga compensates.
		return nil, domain.Errorf(domain.CodeConflict,
			"the hold's amount %d does not match the awarded commission %d",
			hold.AmountMinor.AmountMinor, expectedAmountMinor.AmountMinor)
	}
	hold.State = machine.MpHoldCaptured
	f.seenKeys[idempotencyKey] = reservationID
	f.captured[reservationID] = hold.AmountMinor.AmountMinor
	f.awardOf[reservationID] = awardID
	result := &CaptureResult{
		Hold:           *hold,
		ReceiptID:      "rcp_" + awardID,
		JournalEntryID: "jrn_" + awardID,
	}
	f.captures[idempotencyKey] = result
	f.CapturesByReservation[reservationID]++
	if f.UnknownCapture {
		// The debit happened, but the caller never learns it did.
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return result, nil
}

// Reverse implements WalletPort: a linked reversal of the captured fee,
// exactly once per key.
func (f *FakeWallet) Reverse(_ context.Context, reservationID, _ string, _ string, idempotencyKey string) (*Hold, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ReverseCalls++
	if f.FailReverse != nil {
		return nil, f.FailReverse
	}
	if _, seen := f.seenKeys[idempotencyKey]; seen {
		return f.holds[reservationID], nil
	}
	hold, ok := f.holds[reservationID]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no hold %s", reservationID)
	}
	f.seenKeys[idempotencyKey] = reservationID
	if hold.State != machine.MpHoldCaptured {
		// Already terminal or never captured: answer the state, move nothing.
		return hold, nil
	}
	hold.State = machine.MpHoldReversed
	// The NET captured commission comes back (original + captured
	// increments − refunds), and any reserved increment is released with it,
	// exactly as payment-service's reverseCapturedHold does.
	net := hold.AmountMinor.AmountMinor
	if total, ok := f.captured[reservationID]; ok {
		net = total
	}
	driverID := uuid.MustParse(hold.DriverID)
	f.spendable[driverID] += net
	for key, row := range f.deltas {
		if strings.HasPrefix(key, reservationID+"|") && row.state == machine.MpHoldActive {
			row.state = machine.MpHoldReleased
			f.spendable[driverID] += row.delta
		}
	}
	f.captured[reservationID] = 0
	f.ReversalsByReservation[reservationID]++
	return hold, nil
}

// Overview implements WalletPort.
func (f *FakeWallet) Overview(_ context.Context, driverID uuid.UUID, cityID string) (*Overview, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var held int64
	currency := "NGN"
	var holds []Hold
	for _, hold := range f.holds {
		if hold.DriverID == driverID.String() && hold.State == machine.MpHoldActive {
			held += hold.AmountMinor.AmountMinor
			currency = hold.AmountMinor.Currency
			holds = append(holds, *hold)
		}
	}
	spendable := f.spendable[driverID]
	_ = cityID
	return &Overview{
		ClearedMinor:   money(spendable+held, currency),
		HeldMinor:      money(held, currency),
		SpendableMinor: money(spendable, currency),
		Holds:          holds,
	}, nil
}

// CapturedTotal is the commission captured so far on one hold: the original
// capture plus captured increments minus refunds (0 once reversed).
func (f *FakeWallet) CapturedTotal(reservationID string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.captured[reservationID]
}

// OpenDeltas counts one hold's reserved, uncaptured increments.
func (f *FakeWallet) OpenDeltas(reservationID string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	open := 0
	for key, row := range f.deltas {
		if strings.HasPrefix(key, reservationID+"|") && row.state == machine.MpHoldActive {
			open++
		}
	}
	return open
}

func deltaKey(reservationID, amendmentID string) string {
	return reservationID + "|" + amendmentID
}

func deltaTermsKey(op string, terms DeltaTerms) string {
	return fmt.Sprintf("%s|%s|%d|%d|%d|%s", op, terms.AwardID, terms.PriorTotalMinor.AmountMinor,
		terms.NewTotalMinor.AmountMinor, terms.NewBaseMinor.AmountMinor, terms.NewTotalMinor.Currency)
}

// validDeltaTerms is payment-service's assertDeltaTerms: one currency, and
// the new total must be the ONE commission function applied to the new base.
func validDeltaTerms(terms DeltaTerms) error {
	currency := terms.NewTotalMinor.Currency
	if terms.PriorTotalMinor.Currency != currency || terms.NewBaseMinor.Currency != currency {
		return domain.Errorf(domain.CodeValidationFailed, "every Money body on this request must carry the same currency")
	}
	if terms.NewBaseMinor.AmountMinor <= 0 || terms.PriorTotalMinor.AmountMinor < 0 {
		return domain.Errorf(domain.CodeValidationFailed, "amounts must be positive integers in minor units")
	}
	if terms.NewTotalMinor.AmountMinor != CommissionMinor(terms.NewBaseMinor.AmountMinor) {
		return domain.Errorf(domain.CodeValidationFailed, "the new total is not 10%% of the new base, rounded half-up").
			WithDetails(map[string]any{"expectedMinor": CommissionMinor(terms.NewBaseMinor.AmountMinor)})
	}
	return nil
}

// amendableHold is payment-service's assertAmendable: the award's CAPTURED
// hold, under that award, still captured.
func (f *FakeWallet) amendableHold(reservationID, awardID string) (*Hold, error) {
	hold, ok := f.holds[reservationID]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no such reservation")
	}
	if hold.State == machine.MpHoldActive || hold.State == machine.MpHoldCapturePending {
		return nil, domain.Errorf(domain.CodeConflict,
			"this reservation's commission is not captured yet; a live hold is adjusted, not amended")
	}
	if f.awardOf[reservationID] != awardID {
		return nil, domain.Errorf(domain.CodeConflict, "this reservation was captured under a different award")
	}
	if hold.State != machine.MpHoldCaptured {
		return nil, domain.Errorf(domain.CodeConflict, "the award's commission is no longer captured; it cannot be amended")
	}
	return hold, nil
}

func (f *FakeWallet) refuseOpenDelta(reservationID string, currency string) error {
	for key, row := range f.deltas {
		if strings.HasPrefix(key, reservationID+"|") && row.state == machine.MpHoldActive {
			return domain.Errorf(domain.CodeConflict, "another amendment's commission delta is still open on this award").
				WithDetails(map[string]any{"refreshedTerms": map[string]any{
					"capturedTotalMinor": money(f.captured[reservationID], currency),
				}})
		}
	}
	return nil
}

func (f *FakeWallet) staleCapturedTotal(reservationID, currency string, prior int64) error {
	return domain.Errorf(domain.CodeVersionConflict,
		"the prior total is not the award's captured commission; refresh and retry").
		WithDetails(map[string]any{
			"priorTotalMinor": money(prior, currency),
			"refreshedTerms": map[string]any{
				"capturedTotalMinor": money(f.captured[reservationID], currency),
			},
		})
}

func deltaView(reservationID, amendmentID string, row *fakeDelta, direction, currency string) *CommissionDelta {
	view := &CommissionDelta{
		ReservationID: reservationID,
		AmendmentID:   amendmentID,
		AwardID:       row.awardID,
		Direction:     direction,
		State:         row.state,
		DeltaMinor:    money(row.delta, currency),
	}
	if direction != "none" {
		prior, next, base := money(row.prior, currency), money(row.newTotal, currency), money(row.newBase, currency)
		view.PriorTotalMinor, view.NewTotalMinor, view.NewBaseMinor = &prior, &next, &base
	}
	if direction == "increase" || direction == "none" {
		id := "mph_" + digest(deltaKey(reservationID, amendmentID))
		view.DeltaReservationID = &id
	}
	if row.state == machine.MpHoldCaptured || row.state == "refunded" {
		receipt := "mcr_" + digest(deltaKey(reservationID, amendmentID)+row.state)
		view.ReceiptID = &receipt
	}
	return view
}

// ReserveCommissionDelta implements WalletPort.
func (f *FakeWallet) ReserveCommissionDelta(_ context.Context, reservationID, amendmentID string, terms DeltaTerms, _ string) (*CommissionDelta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.DeltaReserveCalls++
	if f.FailDeltaReserve != nil {
		return nil, f.FailDeltaReserve
	}
	if err := validDeltaTerms(terms); err != nil {
		return nil, err
	}
	currency := terms.NewTotalMinor.Currency
	if terms.NewTotalMinor.AmountMinor <= terms.PriorTotalMinor.AmountMinor {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a commission delta is reserved only for an increase; a decrease is refunded at commit")
	}
	key := deltaKey(reservationID, amendmentID)
	termsKey := deltaTermsKey("reserve", terms)
	if row, ok := f.deltas[key]; ok {
		if row.terms == termsKey {
			return deltaView(reservationID, amendmentID, row, "increase", currency), nil
		}
		if row.closed {
			return nil, domain.Errorf(domain.CodeConflict, "this amendment was already released; it cannot reserve a delta")
		}
		return nil, domain.Errorf(domain.CodeIdempotencyKeyReuse,
			"this amendment already reserved a commission delta with different terms")
	}
	hold, err := f.amendableHold(reservationID, terms.AwardID)
	if err != nil {
		return nil, err
	}
	if _, refunded := f.refunds[key]; refunded {
		return nil, domain.Errorf(domain.CodeConflict, "this amendment already committed a commission decrease")
	}
	if err := f.refuseOpenDelta(reservationID, currency); err != nil {
		return nil, err
	}
	capturedMinor := f.captured[reservationID]
	if capturedMinor != terms.PriorTotalMinor.AmountMinor {
		return nil, f.staleCapturedTotal(reservationID, currency, terms.PriorTotalMinor.AmountMinor)
	}
	delta := terms.NewTotalMinor.AmountMinor - capturedMinor
	driverID := uuid.MustParse(hold.DriverID)
	if f.spendable[driverID] < delta {
		return nil, domain.Errorf(domain.CodeInsufficientSpendable,
			"the spendable balance does not cover the commission increment").
			WithDetails(map[string]any{
				"requiredMinor":  delta,
				"spendableMinor": f.spendable[driverID],
				"shortfallMinor": delta - f.spendable[driverID],
			})
	}
	f.spendable[driverID] -= delta
	row := &fakeDelta{
		awardID: terms.AwardID, state: machine.MpHoldActive, delta: delta,
		prior: capturedMinor, newTotal: terms.NewTotalMinor.AmountMinor,
		newBase: terms.NewBaseMinor.AmountMinor, terms: termsKey,
	}
	f.deltas[key] = row
	return deltaView(reservationID, amendmentID, row, "increase", currency), nil
}

// CaptureCommissionDelta implements WalletPort: the reserved increment is
// debited exactly once; a replay answers the original outcome.
func (f *FakeWallet) CaptureCommissionDelta(_ context.Context, reservationID, amendmentID, awardID string, newTotalMinor Money, _ string) (*CommissionDelta, error) {
	if hook := f.BeforeDeltaCapture; hook != nil {
		f.BeforeDeltaCapture = nil
		hook()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.DeltaCaptureCalls++
	if f.FailDeltaCapture != nil {
		return nil, f.FailDeltaCapture
	}
	key := deltaKey(reservationID, amendmentID)
	row, ok := f.deltas[key]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no commission delta is reserved for this amendment")
	}
	switch {
	case row.awardID != awardID:
		return nil, domain.Errorf(domain.CodeConflict, "this amendment's delta belongs to a different award")
	case row.closed:
		return nil, domain.Errorf(domain.CodeConflict, "this amendment was released without an increment; nothing to capture")
	case row.newTotal != newTotalMinor.AmountMinor:
		return nil, domain.Errorf(domain.CodeConflict, "the committed total is not the total this amendment reserved for")
	case row.state == machine.MpHoldCaptured:
		if f.UnknownDeltaCapture {
			return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
		}
		return deltaView(reservationID, amendmentID, row, "increase", newTotalMinor.Currency), nil
	case row.state == machine.MpHoldReleased:
		return nil, domain.Errorf(domain.CodeConflict, "this amendment's increment was released; it can no longer be captured")
	}
	if _, err := f.amendableHold(reservationID, awardID); err != nil {
		return nil, err
	}
	if f.captured[reservationID]+row.delta != newTotalMinor.AmountMinor {
		return nil, f.staleCapturedTotal(reservationID, newTotalMinor.Currency, newTotalMinor.AmountMinor-row.delta)
	}
	row.state = machine.MpHoldCaptured
	f.captured[reservationID] += row.delta
	f.DeltaCapturesByAmendment[amendmentID]++
	if f.UnknownDeltaCapture {
		return nil, fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return deltaView(reservationID, amendmentID, row, "increase", newTotalMinor.Currency), nil
}

// ReleaseCommissionDelta implements WalletPort: a reserved increment is
// released exactly once; a release that arrives first closes the amendment.
func (f *FakeWallet) ReleaseCommissionDelta(_ context.Context, reservationID, amendmentID, awardID, _ string, _ string) (*CommissionDelta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.DeltaReleaseCalls++
	if f.FailDeltaRelease != nil {
		return nil, f.FailDeltaRelease
	}
	hold, ok := f.holds[reservationID]
	if !ok {
		return nil, domain.Errorf(domain.CodeNotFound, "no such reservation")
	}
	currency := hold.AmountMinor.Currency
	key := deltaKey(reservationID, amendmentID)
	if row, ok := f.deltas[key]; ok {
		switch {
		case row.awardID != awardID:
			return nil, domain.Errorf(domain.CodeConflict, "this amendment's delta belongs to a different award")
		case row.state == machine.MpHoldReleased:
			direction := "increase"
			if row.closed {
				direction = "none"
			}
			return deltaView(reservationID, amendmentID, row, direction, currency), nil
		case row.state == machine.MpHoldCaptured:
			return nil, domain.Errorf(domain.CodeConflict,
				"this amendment's increment was captured; it is undone only by a decreasing amendment or the award's reversal")
		}
		row.state = machine.MpHoldReleased
		f.spendable[uuid.MustParse(hold.DriverID)] += row.delta
		f.DeltaReleasesByAmendment[amendmentID]++
		return deltaView(reservationID, amendmentID, row, "increase", currency), nil
	}
	if f.awardOf[reservationID] != awardID {
		return nil, domain.Errorf(domain.CodeConflict, "this reservation was not captured under that award")
	}
	if _, refunded := f.refunds[key]; refunded {
		return nil, domain.Errorf(domain.CodeConflict, "this amendment already committed a commission decrease")
	}
	closed := &fakeDelta{awardID: awardID, state: machine.MpHoldReleased, closed: true, terms: "closed"}
	f.deltas[key] = closed
	return deltaView(reservationID, amendmentID, closed, "none", currency), nil
}

// RefundCommissionDelta implements WalletPort: a committed decrease's linked
// partial reversal — prior − new, never more than captured.
func (f *FakeWallet) RefundCommissionDelta(_ context.Context, reservationID, amendmentID string, terms DeltaTerms, _ string) (*CommissionDelta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.DeltaRefundCalls++
	if f.FailDeltaRefund != nil {
		return nil, f.FailDeltaRefund
	}
	if err := validDeltaTerms(terms); err != nil {
		return nil, err
	}
	currency := terms.NewTotalMinor.Currency
	if terms.NewTotalMinor.AmountMinor >= terms.PriorTotalMinor.AmountMinor {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"a commission refund is only for a decrease; an increase is reserved and captured")
	}
	key := deltaKey(reservationID, amendmentID)
	termsKey := deltaTermsKey("refund", terms)
	if row, ok := f.refunds[key]; ok {
		if row.terms != termsKey {
			return nil, domain.Errorf(domain.CodeIdempotencyKeyReuse,
				"this amendment already refunded commission with different terms")
		}
		return deltaView(reservationID, amendmentID, row, "decrease", currency), nil
	}
	hold, err := f.amendableHold(reservationID, terms.AwardID)
	if err != nil {
		return nil, err
	}
	if _, reserved := f.deltas[key]; reserved {
		return nil, domain.Errorf(domain.CodeConflict,
			"this amendment already reserved (or closed) an increase; it cannot also refund")
	}
	if err := f.refuseOpenDelta(reservationID, currency); err != nil {
		return nil, err
	}
	capturedMinor := f.captured[reservationID]
	if capturedMinor != terms.PriorTotalMinor.AmountMinor {
		return nil, f.staleCapturedTotal(reservationID, currency, terms.PriorTotalMinor.AmountMinor)
	}
	refund := capturedMinor - terms.NewTotalMinor.AmountMinor
	f.captured[reservationID] = terms.NewTotalMinor.AmountMinor
	f.spendable[uuid.MustParse(hold.DriverID)] += refund
	row := &fakeDelta{
		awardID: terms.AwardID, state: "refunded", delta: refund, prior: capturedMinor,
		newTotal: terms.NewTotalMinor.AmountMinor, newBase: terms.NewBaseMinor.AmountMinor, terms: termsKey,
	}
	f.refunds[key] = row
	f.DeltaRefundsByAmendment[amendmentID]++
	return deltaView(reservationID, amendmentID, row, "decrease", currency), nil
}

// FakeSettlement is the in-memory SettlementPort tests drive: idempotent on
// its key like the real endpoint, with injectable definite failures and
// unknown outcomes.
type FakeSettlement struct {
	mu   sync.Mutex
	seen map[string]bool

	// Fail makes the next calls answer this definite refusal.
	Fail error
	// Unknown makes calls record the settlement but answer
	// ErrWalletUnknownOutcome, which is what a lost response looks like.
	Unknown bool

	// Calls counts every call; EffectiveCalls counts non-replayed ones.
	Calls          int
	EffectiveCalls int
	// Requests records every non-replayed settlement body, keyed by award id.
	Requests map[uuid.UUID]SettlementRequest
}

// NewFakeSettlement builds an empty fake.
func NewFakeSettlement() *FakeSettlement {
	return &FakeSettlement{seen: map[string]bool{}, Requests: map[uuid.UUID]SettlementRequest{}}
}

// Settle implements SettlementPort.
func (f *FakeSettlement) Settle(_ context.Context, req SettlementRequest, idempotencyKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls++
	if f.Fail != nil {
		return f.Fail
	}
	if !f.seen[idempotencyKey] {
		f.seen[idempotencyKey] = true
		f.EffectiveCalls++
		f.Requests[req.AwardID] = req
	}
	if f.Unknown {
		return fmt.Errorf("%w: injected", ErrWalletUnknownOutcome)
	}
	return nil
}
