package marketplace

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// Trip receipts (A06, receipts).
//
// GET /v1/mp/requests/{id}/receipt answers a COMPLETED marketplace ride's
// receipt, as JSON, to its two parties only:
//
//   - the requester sees the agreed fare, every committed adjustment
//     itemised (post-award amendments, paid stop waiting, an early end), the
//     market's taxes as the share of the total they already pay (only where
//     the market's config defines tax rates — nothing is ever added), the
//     total, the payment method and the trip facts. They never see the
//     driver's commission;
//   - the awarded driver sees the same lines and total as their GROSS, the
//     10% commission captured once at selection plus each linked commission
//     adjustment, and the NET.
//
// The receipt reconciles exactly with the settlement (the A02 invariant:
// settled = original fare + committed adjustments). It is built from the
// same committed rows the settlement is — never from a proposal still in
// flight — and it refuses to render at all while any adjustment still holds
// open money, or if the lines ever failed to add up to the committed fare:
// a receipt is never approximately right. A PDF rendering is a follow-up;
// this service carries no maintained PDF library.

// Receipt viewers.
const (
	receiptViewerRider  = "rider"
	receiptViewerDriver = "driver"
)

// Receipt line codes (MP_RECEIPT_LINE_CODES).
const (
	ReceiptLineAgreedFare       = "agreed_fare"
	ReceiptLineRouteChange      = "route_change"
	ReceiptLineStopWaiting      = "stop_waiting"
	ReceiptLineEarlyTermination = "early_termination"
	ReceiptLineCommission       = "commission"
	ReceiptLineCommissionAdjust = "commission_adjustment"
)

// Receipt tax bases.
const (
	ReceiptTaxesIncluded      = "included"
	ReceiptTaxesNotConfigured = "not_configured"
	ReceiptTaxesUnavailable   = "unavailable"
)

// Settlement statuses on a receipt.
const (
	ReceiptSettlementPosted  = "posted"
	ReceiptSettlementPending = "pending"
)

// ReceiptLineView is one itemised amount.
type ReceiptLineView struct {
	Code        string     `json:"code"`
	Label       string     `json:"label"`
	AmountMinor Money      `json:"amountMinor"`
	AmendmentID *string    `json:"amendmentId,omitempty"`
	CommittedAt *time.Time `json:"committedAt,omitempty"`
}

// ReceiptTaxLineView is one tax's share of the total.
type ReceiptTaxLineView struct {
	Code        string `json:"code"`
	RateBps     int    `json:"rateBps"`
	Label       string `json:"label"`
	AmountMinor Money  `json:"amountMinor"`
}

// ReceiptTaxesView says how taxes relate to the total.
type ReceiptTaxesView struct {
	Basis string               `json:"basis"`
	Lines []ReceiptTaxLineView `json:"lines"`
	Note  string               `json:"note"`
}

// ReceiptPaymentView is how the rider paid.
type ReceiptPaymentView struct {
	Method string `json:"method"`
	Label  string `json:"label"`
}

// ReceiptTripView is the trip's facts.
type ReceiptTripView struct {
	Service              string          `json:"service"`
	VehicleClass         string          `json:"vehicleClass"`
	Pickup               string          `json:"pickup"`
	Dropoff              string          `json:"dropoff"`
	StopCount            int             `json:"stopCount"`
	StopsVisited         int             `json:"stopsVisited"`
	StopsSkipped         int             `json:"stopsSkipped"`
	RoutedDistanceMeters int64           `json:"routedDistanceMeters"`
	StartedAt            *time.Time      `json:"startedAt"`
	CompletedAt          time.Time       `json:"completedAt"`
	TerminatedEarly      bool            `json:"terminatedEarly"`
	Driver               OfferDriverView `json:"driver"`
}

// ReceiptSettlementView is where the payment posting stands.
type ReceiptSettlementView struct {
	Status    string     `json:"status"`
	SettledAt *time.Time `json:"settledAt"`
	Note      string     `json:"note"`
}

// ReceiptReconciliationView states the arithmetic the receipt satisfies.
type ReceiptReconciliationView struct {
	OriginalFareMinor Money  `json:"originalFareMinor"`
	AdjustmentsMinor  Money  `json:"adjustmentsMinor"`
	TotalMinor        Money  `json:"totalMinor"`
	SettledFareMinor  Money  `json:"settledFareMinor"`
	Rule              string `json:"rule"`
}

// DriverReceiptEarningsView is the driver's gross, commission and net.
type DriverReceiptEarningsView struct {
	GrossMinor      Money             `json:"grossMinor"`
	CommissionBps   int               `json:"commissionBps"`
	CommissionLines []ReceiptLineView `json:"commissionLines"`
	CommissionMinor Money             `json:"commissionMinor"`
	NetMinor        Money             `json:"netMinor"`
	Note            string            `json:"note"`
}

// ReceiptCostCentreView is the cost centre a business trip was charged to.
type ReceiptCostCentreView struct {
	ID   string  `json:"id"`
	Code *string `json:"code"`
	Name *string `json:"name"`
}

// ReceiptBusinessView is a business receipt's organization block (A06 part
// C; rider view only — nothing about the organization reaches the driver):
// who paid (the organization's billing identity and tax id), the cost centre
// and expense category, and the budget funding as the ledger recorded it.
type ReceiptBusinessView struct {
	OrganizationID   string                 `json:"organizationId"`
	OrganizationName *string                `json:"organizationName"`
	LegalName        *string                `json:"legalName"`
	TaxID            *string                `json:"taxId"`
	CostCentre       *ReceiptCostCentreView `json:"costCentre"`
	ExpenseCategory  *string                `json:"expenseCategory"`
	BookingRef       string                 `json:"bookingRef"`
	BookerID         string                 `json:"bookerId"`
	TravellerID      string                 `json:"travellerId"`
	FundingState     string                 `json:"fundingState"`
	CommittedMinor   *Money                 `json:"committedMinor"`
	LedgerTaxes      []BusinessTaxLine      `json:"ledgerTaxes"`
	Note             string                 `json:"note"`
}

// ReceiptView answers GET /v1/mp/requests/{id}/receipt (MpReceiptSchema).
type ReceiptView struct {
	ReceiptID      string                     `json:"receiptId"`
	Viewer         string                     `json:"viewer"`
	RequestID      string                     `json:"requestId"`
	AwardID        string                     `json:"awardId"`
	ExecutionID    string                     `json:"executionId"`
	Currency       string                     `json:"currency"`
	Lines          []ReceiptLineView          `json:"lines"`
	TotalMinor     Money                      `json:"totalMinor"`
	Taxes          *ReceiptTaxesView          `json:"taxes,omitempty"`
	Payment        ReceiptPaymentView         `json:"payment"`
	Trip           ReceiptTripView            `json:"trip"`
	Settlement     ReceiptSettlementView      `json:"settlement"`
	Reconciliation ReceiptReconciliationView  `json:"reconciliation"`
	Driver         *DriverReceiptEarningsView `json:"driver,omitempty"`
	Business       *ReceiptBusinessView       `json:"business,omitempty"`
	Format         string                     `json:"format"`
	IssuedAt       time.Time                  `json:"issuedAt"`
}

const (
	receiptRule           = "total = agreed fare + committed adjustments = the fare settled"
	receiptTaxesIncluded  = "Taxes are the share of the total at this market's configured rates. They are included in the total; nothing was added on top."
	receiptTaxesNone      = "This market's configuration defines no tax rates, so none are itemised."
	receiptTaxesUnreadble = "The tax rates this trip was priced under could not be read right now, so none are itemised. The total is unaffected."
	receiptDriverNote     = "The 10% UBI commission was captured once when the rider selected your offer; committed changes moved it only by linked adjustments. Net is before your own fuel, energy and vehicle costs."
	settlementPostedNote  = "Payment posted."
	settlementPendingNote = "The amount is final; the payment posting is still being confirmed."
	businessPostedNote    = "Charged to the organization's budget."
	businessPendingNote   = "The amount is final; the charge to the organization's budget is still being confirmed."
	businessReceiptNote   = "Paid from the organization's prefunded budget; nothing was charged to you personally. Taxes are the share of the total at this market's configured rates."
	businessBillingNote   = "Paid from the organization's prefunded budget; nothing was charged to you personally. The organization's billing details could not be read right now."
)

// receiptLineFor labels one committed amendment.
func receiptLineFor(amendment *Amendment, stops []*ExecutionStop, currency string) ReceiptLineView {
	committedAt := amendment.UpdatedAt
	if amendment.ResolvedAt != nil {
		committedAt = *amendment.ResolvedAt
	}
	id := amendment.ID.String()
	line := ReceiptLineView{
		AmountMinor: money(amendment.fareDelta(), currency),
		AmendmentID: &id,
		CommittedAt: &committedAt,
	}
	switch amendment.Kind {
	case AmendmentKindStopWaiting:
		line.Code = ReceiptLineStopWaiting
		line.Label = "Paid waiting at a stop"
		if amendment.ReferenceStopID != nil {
			for _, stop := range stops {
				if stop.StopID == *amendment.ReferenceStopID && stop.Label != "" {
					line.Label = "Paid waiting at " + stop.Label
				}
			}
		}
	case AmendmentKindEarlyTermination:
		line.Code = ReceiptLineEarlyTermination
		line.Label = "Trip ended early (unvisited remainder)"
	default:
		line.Code = ReceiptLineRouteChange
		line.Label = "Agreed route change"
	}
	return line
}

// taxRateBps converts a configured percentage to basis points; a rate that
// is not a clean positive percentage below 100 is refused.
func taxRateBps(percent float64) (int, bool) {
	bps := math.Round(percent * 100)
	if bps <= 0 || bps >= 10_000 || math.Abs(bps-percent*100) > 1e-6 {
		return 0, false
	}
	return int(bps), true
}

// receiptTaxesOf itemises the taxes INCLUDED in a total at the configured
// rates: each tax's share is total × rate / (1 + Σrates), rounded half-up
// to the minor unit. It never adds anything to the total.
func receiptTaxesOf(taxes map[string]float64, total int64, currency string) *ReceiptTaxesView {
	codes := make([]string, 0, len(taxes))
	for code := range taxes {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	type rate struct {
		code string
		bps  int
	}
	var rates []rate
	sum := 0
	for _, code := range codes {
		bps, ok := taxRateBps(taxes[code])
		if !ok {
			continue
		}
		rates = append(rates, rate{code, bps})
		sum += bps
	}
	if len(rates) == 0 {
		return &ReceiptTaxesView{Basis: ReceiptTaxesNotConfigured, Lines: []ReceiptTaxLineView{}, Note: receiptTaxesNone}
	}
	view := &ReceiptTaxesView{Basis: ReceiptTaxesIncluded, Lines: make([]ReceiptTaxLineView, 0, len(rates)), Note: receiptTaxesIncluded}
	denominator := int64(10_000 + sum)
	for _, r := range rates {
		share := (total*int64(r.bps)*2 + denominator) / (2 * denominator)
		percent := strconv.FormatFloat(float64(r.bps)/100, 'f', -1, 64)
		view.Lines = append(view.Lines, ReceiptTaxLineView{
			Code:        r.code,
			RateBps:     r.bps,
			Label:       taxLabel(r.code) + " " + percent + "% (included)",
			AmountMinor: money(share, currency),
		})
	}
	return view
}

func taxLabel(code string) string {
	if code == "vat" {
		return "VAT"
	}
	return code
}

// settlementStateOf reads whether the completion settlement was confirmed.
func (s *Store) settlementStateOf(ctx context.Context, db DB, awardID uuid.UUID) (*time.Time, bool, error) {
	var resolvedAt *time.Time
	err := db.QueryRow(ctx, `
		SELECT resolved_at FROM mp.reservation_recovery
		WHERE reservation_id = $1 AND action = $2
		ORDER BY created_at DESC LIMIT 1`, settlementKeyFor(awardID), RecoverySettle).Scan(&resolvedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("failed to read the settlement state: %w", err)
	}
	return resolvedAt, true, nil
}

// Receipt answers GET /v1/mp/requests/{id}/receipt for the requester (rider
// view) or the awarded driver (driver view); anyone else gets 404. Read-only
// and ungated: a receipt is a record of a trip that already happened.
func (s *Service) Receipt(ctx context.Context, actor Actor, requestID uuid.UUID) (*ReceiptView, error) {
	notFound := domain.Errorf(domain.CodeNotFound, "that request does not exist")
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, notFound
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), requestID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, asDomainError(err)
	}
	viewer := ""
	switch {
	case actor.IsRider() && request.RequesterID == actor.UserID:
		viewer = receiptViewerRider
	case actor.IsDriver() && award != nil && award.DriverID == actor.UserID:
		viewer = receiptViewerDriver
	default:
		return nil, notFound
	}
	notCompleted := domain.Errorf(domain.CodeConflict, "a receipt is issued once the trip is completed").
		WithDetails(map[string]any{"reason": "trip_not_completed"})
	if award == nil || award.State != machine.MpAwardConfirmed || award.ExecutionID == nil {
		return nil, notCompleted
	}
	if request.Service != ServiceRide || (award.ExecutionService != "" && award.ExecutionService != ServiceRide) {
		// A delivery's receipt belongs to the delivery service's custody record.
		return nil, domain.Errorf(domain.CodeNotFound, "receipts here cover marketplace rides")
	}
	ride, err := s.deps.Store.ExecutionRideSummary(ctx, s.deps.Store.Pool(), *award.ExecutionID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, notCompleted
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if !rideCompleted(ride) {
		return nil, notCompleted
	}

	// The committed terms: the execution route when the trip amended or
	// reported a stop, otherwise the award as selected.
	route, err := s.deps.Store.ExecutionRouteByAward(ctx, s.deps.Store.Pool(), award.ID)
	if errors.Is(err, domain.ErrNotFound) {
		route = nil
	} else if err != nil {
		return nil, asDomainError(err)
	}
	var amendments []*Amendment
	var stops []*ExecutionStop
	if route != nil {
		if amendments, err = s.deps.Store.AmendmentsForAward(ctx, s.deps.Store.Pool(), award.ID); err != nil {
			return nil, asDomainError(err)
		}
		if stops, err = s.deps.Store.ExecutionStops(ctx, s.deps.Store.Pool(), award.ID); err != nil {
			return nil, asDomainError(err)
		}
	}
	// The settlement's own derivation: it defers while money is open, and
	// so does the receipt.
	settled, err := s.committedSettlement(ctx, SettlementRequest{
		AwardID:   award.ID,
		FareMinor: money(award.FareMinor, request.Currency),
	})
	if errors.Is(err, errTripUnsettled) {
		return nil, domain.Errorf(domain.CodeConflict, "the final amount is still settling; try again shortly").
			WithDetails(map[string]any{"reason": "settling"})
	}
	if err != nil {
		return nil, asDomainError(err)
	}

	currency := request.Currency
	original := award.FareMinor
	if route != nil {
		original = route.OriginalFareMinor
	}
	lines := []ReceiptLineView{{Code: ReceiptLineAgreedFare, Label: "Agreed fare", AmountMinor: money(original, currency)}}
	adjustments := int64(0)
	commissionDeltas := []ReceiptLineView{}
	commissionTotal := award.CommissionMinor
	for _, amendment := range amendments {
		if amendment.State != machine.MpAmendmentCommitted {
			continue
		}
		line := receiptLineFor(amendment, stops, currency)
		lines = append(lines, line)
		adjustments += amendment.fareDelta()
		if delta := amendment.commissionDelta(); delta != 0 {
			commissionTotal += delta
			commissionDeltas = append(commissionDeltas, ReceiptLineView{
				Code:        ReceiptLineCommissionAdjust,
				Label:       "Commission adjustment linked to: " + line.Label,
				AmountMinor: money(delta, currency),
				AmendmentID: line.AmendmentID,
				CommittedAt: line.CommittedAt,
			})
		}
	}
	total := original + adjustments
	// The receipt must reconcile exactly — with the committed terms and with
	// what the settlement pays — or it is not issued.
	if total != settled.FareMinor.AmountMinor || (route != nil && total != route.AgreedFareMinor) {
		return nil, domain.Errorf(domain.CodeInternalError, "the receipt could not be reconciled").
			Wrap(fmt.Errorf("award %s: lines add to %d, settlement %d", award.ID, total, settled.FareMinor.AmountMinor))
	}

	// A06 part C: a business trip was paid from an organization's budget.
	booking, err := s.deps.Store.BusinessBookingByAward(ctx, s.deps.Store.Pool(), award.ID)
	if errors.Is(err, domain.ErrNotFound) {
		booking = nil
	} else if err != nil {
		return nil, asDomainError(err)
	}
	method, methodLabel := "wallet", "UBI Wallet"
	switch {
	case booking != nil && viewer == receiptViewerRider:
		method, methodLabel = PaymentMethodBusiness, "Organization budget"
	case booking != nil:
		// The driver learns nothing about the organization (BUSINESS_VISIBILITY).
		method, methodLabel = PaymentMethodBusiness, "Paid in-app; nothing is collected at the trip"
	case request.PaymentMethodID == "cash":
		method, methodLabel = "cash", "Cash, paid to the driver"
	}
	trip := ReceiptTripView{
		Service:              request.Service,
		VehicleClass:         request.VehicleClass,
		Pickup:               request.Pickup.Label,
		Dropoff:              request.Dropoff.Label,
		RoutedDistanceMeters: request.RoutedDistanceM,
		StartedAt:            ride.StartedAt,
		CompletedAt:          *ride.CompletedAt,
		Driver:               s.driverDisplayFor(ctx, award.DriverID, request.VehicleClass),
	}
	if route != nil {
		trip.Dropoff = route.Dropoff.Label
		trip.TerminatedEarly = route.TerminatedAt != nil
		if route.RoutedDistanceM != nil {
			// The COMMITTED route's distance: an amendment that changed the
			// route replaced the award's measurement with its own.
			trip.RoutedDistanceMeters = *route.RoutedDistanceM
		}
		for _, stop := range stops {
			switch stop.State {
			case StopStateRemoved:
				continue
			case StopStateDeparted, StopStateArrived:
				trip.StopsVisited++
			case StopStateSkipped:
				trip.StopsSkipped++
			}
			trip.StopCount++
		}
	} else {
		trip.StopCount = len(request.Stops)
	}

	settlement := ReceiptSettlementView{Status: ReceiptSettlementPending, Note: settlementPendingNote}
	if booking != nil {
		// The organization's commit IS this trip's payment posting.
		settlement.Note = businessPendingNote
		if booking.State == machine.MpBusinessCommitted {
			settlement = ReceiptSettlementView{Status: ReceiptSettlementPosted, SettledAt: booking.ResolvedAt, Note: businessPostedNote}
		}
	} else if settledAt, found, err := s.deps.Store.settlementStateOf(ctx, s.deps.Store.Pool(), award.ID); err != nil {
		return nil, asDomainError(err)
	} else if found && settledAt != nil {
		settlement = ReceiptSettlementView{Status: ReceiptSettlementPosted, SettledAt: settledAt, Note: settlementPostedNote}
	}

	view := &ReceiptView{
		ReceiptID:   deterministicID("rcp", "mp.receipt", award.ID.String()),
		Viewer:      viewer,
		RequestID:   request.ID.String(),
		AwardID:     award.ID.String(),
		ExecutionID: award.ExecutionID.String(),
		Currency:    currency,
		Lines:       lines,
		TotalMinor:  money(total, currency),
		Payment:     ReceiptPaymentView{Method: method, Label: methodLabel},
		Trip:        trip,
		Settlement:  settlement,
		Reconciliation: ReceiptReconciliationView{
			OriginalFareMinor: money(original, currency),
			AdjustmentsMinor:  money(adjustments, currency),
			TotalMinor:        money(total, currency),
			SettledFareMinor:  settled.FareMinor,
			Rule:              receiptRule,
		},
		Format:   "json",
		IssuedAt: s.now(),
	}
	if viewer == receiptViewerRider {
		view.Taxes = s.receiptTaxes(ctx, request, total)
		if booking != nil {
			view.Business = s.receiptBusiness(ctx, booking)
		}
		return view, nil
	}
	if route != nil && route.CapturedCommissionMinor != commissionTotal {
		return nil, domain.Errorf(domain.CodeInternalError, "the receipt could not be reconciled").
			Wrap(fmt.Errorf("award %s: commission lines add to %d, captured %d", award.ID, commissionTotal, route.CapturedCommissionMinor))
	}
	commissionLines := append([]ReceiptLineView{{
		Code:        ReceiptLineCommission,
		Label:       "UBI commission (10%), captured once at selection",
		AmountMinor: money(award.CommissionMinor, currency),
	}}, commissionDeltas...)
	view.Driver = &DriverReceiptEarningsView{
		GrossMinor:      money(total, currency),
		CommissionBps:   1_000,
		CommissionLines: commissionLines,
		CommissionMinor: money(commissionTotal, currency),
		NetMinor:        money(total-commissionTotal, currency),
		Note:            receiptDriverNote,
	}
	return view, nil
}

// receiptBusiness renders a business receipt's organization block. The
// organization's billing identity and the cost centre come from
// payment-service's reservation status (the internal read ride-service is
// entitled to), snapshotted on the booking once read; a status that cannot
// be read leaves them null and says so — the receipt is never invented.
func (s *Service) receiptBusiness(ctx context.Context, booking *BusinessBooking) *ReceiptBusinessView {
	view := &ReceiptBusinessView{
		OrganizationID:  booking.OrganizationID,
		ExpenseCategory: optionalString(booking.ExpenseCategory),
		BookingRef:      booking.BookingRef,
		BookerID:        booking.BookerID.String(),
		TravellerID:     booking.TravellerID.String(),
		FundingState:    booking.State,
		LedgerTaxes:     booking.Taxes,
		Note:            businessReceiptNote,
	}
	if view.LedgerTaxes == nil {
		view.LedgerTaxes = []BusinessTaxLine{}
	}
	if booking.CommittedMinor != nil {
		committed := money(*booking.CommittedMinor, booking.Currency)
		view.CommittedMinor = &committed
	}
	if booking.CostCentreID != "" {
		view.CostCentre = &ReceiptCostCentreView{ID: booking.CostCentreID}
	}
	billing := booking.Billing
	if billing == nil {
		status, err := s.business().ReservationStatus(ctx, booking.BookingRef)
		if err == nil && status.Organization != nil {
			billing = status
			if err := s.deps.Store.SetBusinessBilling(ctx, s.deps.Store.Pool(), booking.AwardID, status); err != nil {
				s.deps.Logger.Warn().Err(err).Str("award_id", booking.AwardID.String()).Msg("could not snapshot the business billing")
			}
		}
	}
	if billing == nil || billing.Organization == nil {
		view.Note = businessBillingNote
		return view
	}
	name := billing.Organization.Name
	view.OrganizationName = optionalString(name)
	view.LegalName, view.TaxID = billing.Organization.LegalName, billing.Organization.TaxID
	if centre := billing.CostCentre; centre != nil {
		code, label := centre.Code, centre.Name
		view.CostCentre = &ReceiptCostCentreView{ID: centre.ID, Code: optionalString(code), Name: optionalString(label)}
	}
	return view
}

// receiptTaxes itemises taxes at the rates of the configuration version the
// trip was priced under; an unreadable snapshot itemises none (and says so).
func (s *Service) receiptTaxes(ctx context.Context, request *Request, total int64) *ReceiptTaxesView {
	unavailable := &ReceiptTaxesView{Basis: ReceiptTaxesUnavailable, Lines: []ReceiptTaxLineView{}, Note: receiptTaxesUnreadble}
	version, ok := configVersionOf(request.PricingVersion)
	versioned, isVersioned := s.deps.Config.(cityconfig.VersionedProvider)
	if !ok || !isVersioned {
		return unavailable
	}
	config, err := versioned.ConfigVersion(ctx, request.CityID, version)
	if err != nil {
		return unavailable
	}
	return receiptTaxesOf(config.Taxes, total, request.Currency)
}
