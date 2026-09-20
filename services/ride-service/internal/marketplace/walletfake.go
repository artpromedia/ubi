package marketplace

import (
	"context"
	"fmt"
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
	}
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
	f.spendable[uuid.MustParse(hold.DriverID)] += hold.AmountMinor.AmountMinor
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
