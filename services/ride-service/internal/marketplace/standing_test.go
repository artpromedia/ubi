package marketplace_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// admin builds a fresh admin actor for the harness's city.
func adminActor(h *testutil.Harness) testutil.Actor {
	return testutil.Actor{UserID: uuid.New(), Role: move.RoleAdmin, CityID: h.CityID}
}

func auditCount(t *testing.T, h *testutil.Harness, action, subjectID string) int {
	t.Helper()
	var n int
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM public.audit_log WHERE action = $1 AND subject_id = $2`, action, subjectID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ---------------------------------------------------------------------------
// Authorization: every new C08 admin surface refuses a non-admin operator.
// ---------------------------------------------------------------------------

func TestAdminC08SurfacesRefuseNonAdmin(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	someID := uuid.New().String()

	calls := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/admin/mp/pending-sagas", nil},
		{http.MethodPost, "/admin/mp/awards/" + someID + "/reconcile", map[string]any{"dryRun": true}},
		{http.MethodGet, "/admin/mp/recoveries", nil},
		{http.MethodPost, "/admin/mp/recoveries/" + someID + "/retry", map[string]any{"dryRun": true}},
		{http.MethodGet, "/admin/mp/cancellations", nil},
		{http.MethodGet, "/admin/mp/drivers/standing", nil},
		{http.MethodGet, "/admin/mp/drivers/" + someID + "/standing", nil},
		{http.MethodPost, "/admin/mp/drivers/" + someID + "/standing-actions", map[string]any{"actionType": "warning", "reasonCode": "other", "cityId": "lagos"}},
		{http.MethodGet, "/admin/mp/standing-actions", nil},
		{http.MethodPost, "/admin/mp/standing-actions/" + someID + "/decide", map[string]any{"approve": true, "reason": "x"}},
		{http.MethodPost, "/admin/mp/standing-actions/" + someID + "/appeal", map[string]any{"note": "x"}},
		{http.MethodPost, "/admin/mp/standing-actions/" + someID + "/appeal-decision", map[string]any{"uphold": true, "reason": "x"}},
		{http.MethodGet, "/admin/mp/requests/" + someID + "/resolution", nil},
	}
	for _, c := range calls {
		recorder := h.Do(c.method, c.path, rider, c.body, move.IdempotencyHeader, idemKey())
		requireStatus(t, recorder, http.StatusForbidden)
	}
}

// ---------------------------------------------------------------------------
// Stuck-saga board & award reconciliation
// ---------------------------------------------------------------------------

// stallCaptureAward publishes, bids and selects with the wallet's capture
// step failing definitely-unknown (a plain error, not the injected "unknown
// outcome" sentinel), leaving the award durably stuck in `pending` at the
// capture step — the real stuck-saga signature this board lists.
func stallCaptureAward(t *testing.T, h *testutil.Harness) (rider, driver testutil.Actor, requestID string) {
	t.Helper()
	rider, driver = h.Rider(), h.Driver()
	view, _ := publishAt(t, h, rider, 0)
	requestID = view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")

	parkDriver(t, h, driver, testutil.PickupFixture())
	bidView := fundedCurrentBid(t, h, driver, requestID, amount)

	h.Wallet.FailCapture = errors.New("payment-service unavailable")
	selected := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bidView["bidId"], "requestVersion": 1, "bidVersion": 1,
	}, "")
	// Selection itself answers 202/200-ish with the award still pending — the
	// saga step failed but selection is not itself an error to the caller.
	if selected.Code >= 500 {
		t.Fatalf("selection failed hard: %s", selected.Body.String())
	}
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardPending {
		t.Fatalf("award state: %s, want pending (stalled at capture)", award.State)
	}
	return rider, driver, requestID
}

func TestAdminPendingSagasAndReconcile(t *testing.T) {
	h := newHarness(t)
	_, _, requestID := stallCaptureAward(t, h)
	admin := adminActor(h)
	award := awardRow(t, h, requestID)

	// Listed on the stuck-saga board with its saga position.
	list := h.Do(http.MethodGet, "/admin/mp/pending-sagas", admin, nil)
	requireStatus(t, list, http.StatusOK)
	var page marketplace.PendingSagasPage
	h.DecodeBody(list, &page)
	var found *marketplace.PendingSagaView
	for _, row := range page.Rows {
		if row.AwardID == award.ID.String() {
			found = row
		}
	}
	if found == nil {
		t.Fatalf("stalled award %s not listed: %+v", award.ID, page.Rows)
	}
	if found.Step != marketplace.AttemptStepCapture || found.AgeSec < 0 {
		t.Fatalf("pending saga row: %+v", found)
	}

	// Dry-run preview never mutates.
	preview := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin,
		map[string]any{"dryRun": true})
	requireStatus(t, preview, http.StatusOK)
	var previewResult marketplace.ReconcileAwardResult
	h.DecodeBody(preview, &previewResult)
	if previewResult.Outcome != "preview" || previewResult.AfterState != machine.MpAwardPending {
		t.Fatalf("preview: %+v", previewResult)
	}
	if got := awardRow(t, h, requestID); got.State != machine.MpAwardPending {
		t.Fatalf("dry run mutated the award: %s", got.State)
	}

	// A stale expectedUpdatedAt is rejected as a version conflict.
	stale := previewResult.UpdatedAt.Add(-time.Hour)
	conflict := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin,
		map[string]any{"dryRun": false, "expectedUpdatedAt": stale}, move.IdempotencyHeader, idemKey())
	requireCode(t, conflict, http.StatusConflict, "version_conflict")

	// Applying while the wallet is still down converges to "unresolved",
	// still audited, still pending.
	applyKey := idemKey()
	stillDown := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin,
		map[string]any{"dryRun": false, "expectedUpdatedAt": previewResult.UpdatedAt}, move.IdempotencyHeader, applyKey)
	requireStatus(t, stillDown, http.StatusOK)
	var stillDownResult marketplace.ReconcileAwardResult
	h.DecodeBody(stillDown, &stillDownResult)
	if stillDownResult.Outcome != "unresolved" {
		t.Fatalf("reconcile while wallet is down: %+v", stillDownResult)
	}
	if n := auditCount(t, h, "mp.admin.award_reconcile", award.ID.String()); n != 1 {
		t.Fatalf("audit rows after first reconcile: %d, want 1", n)
	}

	// The wallet recovers; a fresh reconcile resolves the award exactly once.
	h.Wallet.FailCapture = nil
	freshPreview := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin, map[string]any{"dryRun": true})
	requireStatus(t, freshPreview, http.StatusOK)
	var fresh marketplace.ReconcileAwardResult
	h.DecodeBody(freshPreview, &fresh)

	resolveKey := idemKey()
	resolved := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin,
		map[string]any{"dryRun": false, "expectedUpdatedAt": fresh.UpdatedAt}, move.IdempotencyHeader, resolveKey)
	requireStatus(t, resolved, http.StatusOK)
	var resolvedResult marketplace.ReconcileAwardResult
	h.DecodeBody(resolved, &resolvedResult)
	if resolvedResult.Outcome != "resolved" || resolvedResult.AfterState != machine.MpAwardConfirmed {
		t.Fatalf("reconcile once healthy: %+v", resolvedResult)
	}
	if got := awardRow(t, h, requestID); got.State != machine.MpAwardConfirmed || got.CaptureReceiptID == "" {
		t.Fatalf("award after reconcile: %+v", got)
	}
	if n := auditCount(t, h, "mp.admin.award_reconcile", award.ID.String()); n != 2 {
		t.Fatalf("audit rows total: %d, want 2 (one per real attempt)", n)
	}

	// Replaying the SAME key answers the cached result without capturing
	// again — no double effect.
	captures := h.Wallet.CapturesByReservation
	before := 0
	for _, n := range captures {
		before += n
	}
	replay := h.Do(http.MethodPost, "/admin/mp/awards/"+award.ID.String()+"/reconcile", admin,
		map[string]any{"dryRun": false, "expectedUpdatedAt": fresh.UpdatedAt}, move.IdempotencyHeader, resolveKey)
	requireStatus(t, replay, http.StatusOK)
	after := 0
	for _, n := range h.Wallet.CapturesByReservation {
		after += n
	}
	if after != before {
		t.Fatalf("replay changed capture counts: before=%d after=%d", before, after)
	}
	if n := auditCount(t, h, "mp.admin.award_reconcile", award.ID.String()); n != 2 {
		t.Fatalf("audit rows after replay: %d, want still 2", n)
	}
}

// ---------------------------------------------------------------------------
// Failed reservation-recovery board
// ---------------------------------------------------------------------------

func TestAdminRecoveryRetryLifecycle(t *testing.T) {
	h := newHarness(t)
	rider := h.Rider()
	driver := h.Driver()
	admin := adminActor(h)

	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, requestID, amount, "")
	requireStatus(t, created, http.StatusCreated)
	bidView := decode(t, created)
	reservationID := bidView["reservationId"].(string)

	h.Wallet.FailRelease = errors.New("wallet down")
	withdraw := h.Do(http.MethodPost, "/mp/bids/"+bidView["bidId"].(string)+"/withdraw", driver, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, withdraw, http.StatusOK)

	list := h.Do(http.MethodGet, "/admin/mp/recoveries", admin, nil)
	requireStatus(t, list, http.StatusOK)
	var page marketplace.RecoveriesPage
	h.DecodeBody(list, &page)
	var row *marketplace.RecoveryView
	for _, r := range page.Rows {
		if r.ReservationID == reservationID {
			row = r
		}
	}
	if row == nil {
		t.Fatalf("recovery row for %s not listed: %+v", reservationID, page.Rows)
	}
	if row.Attempts != 0 || row.Action != marketplace.RecoveryRelease {
		t.Fatalf("recovery row: %+v", row)
	}

	// Dry run previews without mutating.
	preview := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin, map[string]any{"dryRun": true})
	requireStatus(t, preview, http.StatusOK)

	// A stale expectedAttempts is a version conflict; nothing moves.
	badExpected := 7
	conflict := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin,
		map[string]any{"dryRun": false, "expectedAttempts": badExpected}, move.IdempotencyHeader, idemKey())
	requireCode(t, conflict, http.StatusConflict, "version_conflict")
	if releasesFor(h, reservationID) != 0 {
		t.Fatalf("conflict path released money")
	}

	// Applying while the wallet is down defers (attempts increments).
	zero := 0
	deferKey := idemKey()
	deferred := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin,
		map[string]any{"dryRun": false, "expectedAttempts": zero}, move.IdempotencyHeader, deferKey)
	requireStatus(t, deferred, http.StatusOK)
	var deferredResult marketplace.RetryRecoveryResult
	h.DecodeBody(deferred, &deferredResult)
	if deferredResult.Outcome != "deferred" {
		t.Fatalf("retry while wallet down: %+v", deferredResult)
	}
	if n := auditCount(t, h, "mp.admin.recovery_retry", row.ID); n != 1 {
		t.Fatalf("audit rows after deferred retry: %d, want 1", n)
	}

	// Wallet recovers; retry with the now-current attempts resolves exactly once.
	h.Wallet.FailRelease = nil
	one := 1
	resolveKey := idemKey()
	resolved := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin,
		map[string]any{"dryRun": false, "expectedAttempts": one}, move.IdempotencyHeader, resolveKey)
	requireStatus(t, resolved, http.StatusOK)
	var resolvedResult marketplace.RetryRecoveryResult
	h.DecodeBody(resolved, &resolvedResult)
	if resolvedResult.Outcome != "resolved" {
		t.Fatalf("retry once healthy: %+v", resolvedResult)
	}
	if releasesFor(h, reservationID) != 1 {
		t.Fatalf("releases after resolve: %d, want 1", releasesFor(h, reservationID))
	}
	if n := auditCount(t, h, "mp.admin.recovery_retry", row.ID); n != 2 {
		t.Fatalf("audit rows total: %d, want 2", n)
	}

	// Replaying the same key never releases twice.
	replay := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin,
		map[string]any{"dryRun": false, "expectedAttempts": one}, move.IdempotencyHeader, resolveKey)
	requireStatus(t, replay, http.StatusOK)
	if releasesFor(h, reservationID) != 1 {
		t.Fatalf("releases after replay: %d, want still 1", releasesFor(h, reservationID))
	}

	// A fresh key against the now-resolved row is idempotent too: no second
	// effect, no new audit row.
	again := h.Do(http.MethodPost, "/admin/mp/recoveries/"+row.ID+"/retry", admin,
		map[string]any{"dryRun": false, "expectedAttempts": one}, move.IdempotencyHeader, idemKey())
	requireStatus(t, again, http.StatusOK)
	var againResult marketplace.RetryRecoveryResult
	h.DecodeBody(again, &againResult)
	if againResult.Outcome != "already_resolved" {
		t.Fatalf("retry after resolution: %+v", againResult)
	}
	if releasesFor(h, reservationID) != 1 {
		t.Fatalf("releases after already-resolved retry: %d, want still 1", releasesFor(h, reservationID))
	}
	if n := auditCount(t, h, "mp.admin.recovery_retry", row.ID); n != 2 {
		t.Fatalf("audit rows after already-resolved retry: %d, want still 2", n)
	}
}

// ---------------------------------------------------------------------------
// Cancellations / driver standing / resolution timeline
// ---------------------------------------------------------------------------

func TestAdminCancellationsDriverStandingAndResolution(t *testing.T) {
	h := newHarness(t)
	admin := adminActor(h)
	f := setupCurrentExecution(t, h)
	driverCancel(t, h, f)

	cancellations := h.Do(http.MethodGet, "/admin/mp/cancellations?cityId="+h.CityID, admin, nil)
	requireStatus(t, cancellations, http.StatusOK)
	var cpage marketplace.CancellationsPage
	h.DecodeBody(cancellations, &cpage)
	var foundRide bool
	for _, row := range cpage.Rows {
		if row.RideID == f.rideID.String() {
			foundRide = true
			if row.State != machine.RiderCancelledByDriver {
				t.Fatalf("cancellation row state: %s", row.State)
			}
		}
	}
	if !foundRide {
		t.Fatalf("cancelled ride %s not listed: %+v", f.rideID, cpage.Rows)
	}

	standing := h.Do(http.MethodGet, "/admin/mp/drivers/"+f.driver.UserID.String()+"/standing", admin, nil)
	requireStatus(t, standing, http.StatusOK)
	var view marketplace.DriverStandingView
	h.DecodeBody(standing, &view)
	if view.TotalRides != 1 || view.DriverCancellations != 1 || view.CancellationRate != 1.0 || view.Blocked {
		t.Fatalf("driver standing: %+v", view)
	}

	flagged := h.Do(http.MethodGet, "/admin/mp/drivers/standing?minRides=1&cityId="+h.CityID, admin, nil)
	requireStatus(t, flagged, http.StatusOK)
	var flist marketplace.DriverStandingListPage
	h.DecodeBody(flagged, &flist)
	var onList bool
	for _, row := range flist.Rows {
		if row.DriverID == f.driver.UserID.String() {
			onList = true
		}
	}
	if !onList {
		t.Fatalf("driver %s not on the flagged-drivers board: %+v", f.driver.UserID, flist.Rows)
	}

	// The unified resolution timeline stitches request/award/execution/
	// recovery/events for the same case, with an honest funding/commission/
	// notification gap note.
	resolution := h.Do(http.MethodGet, "/admin/mp/requests/"+f.requestID+"/resolution", admin, nil)
	requireStatus(t, resolution, http.StatusOK)
	var res marketplace.ResolutionView
	h.DecodeBody(resolution, &res)
	if res.Award == nil || res.Award.State != machine.MpAwardCancelled {
		t.Fatalf("resolution award: %+v", res.Award)
	}
	if res.Execution == nil || res.Execution.State != machine.RiderCancelledByDriver {
		t.Fatalf("resolution execution: %+v", res.Execution)
	}
	var haveNotificationGap bool
	for _, s := range res.Stages {
		if s.Name == "notification" && s.Status == marketplace.StageUnavailable {
			haveNotificationGap = true
		}
	}
	if !haveNotificationGap {
		t.Fatalf("resolution stages missing the honestly-gated notification stage: %+v", res.Stages)
	}
	if len(res.Gaps) == 0 {
		t.Fatalf("resolution view should name its data-source gaps")
	}
}

// ---------------------------------------------------------------------------
// Standing actions & appeals: maker-checker end to end.
// ---------------------------------------------------------------------------

func TestStandingActionMakerCheckerAndAppeal(t *testing.T) {
	h := newHarness(t)
	driver := h.Driver()
	proposer := adminActor(h)
	approver := adminActor(h)
	thirdReviewer := adminActor(h)

	propose := h.Do(http.MethodPost, "/admin/mp/drivers/"+driver.UserID.String()+"/standing-actions", proposer,
		map[string]any{"actionType": "suspension", "reasonCode": "repeated_cancellation", "reasonNote": "3 driver cancels in a week", "cityId": h.CityID},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, propose, http.StatusCreated)
	var action marketplace.StandingActionView
	h.DecodeBody(propose, &action)
	if action.Status != marketplace.StandingStatusPendingApproval || !action.RequiresApproval {
		t.Fatalf("proposed suspension: %+v", action)
	}

	// Maker-checker: the proposer cannot approve their own proposal.
	selfApprove := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/decide", proposer,
		map[string]any{"approve": true, "reason": "looks fine to me"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, selfApprove, http.StatusForbidden)

	// A distinct operator approves it; it becomes active and blocks the driver.
	approve := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/decide", approver,
		map[string]any{"approve": true, "reason": "confirmed pattern in the standing board"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, approve, http.StatusOK)
	var approved marketplace.StandingActionView
	h.DecodeBody(approve, &approved)
	if approved.Status != marketplace.StandingStatusActive {
		t.Fatalf("approved suspension: %+v", approved)
	}
	if n := auditCount(t, h, "mp.standing.decide", action.ID); n != 1 {
		t.Fatalf("audit rows for the decision: %d, want 1", n)
	}

	config, policy := cityPolicy(t, h)
	blockedRequest := &marketplace.Request{ID: uuid.New(), CityID: h.CityID, VehicleClass: "go",
		EnvelopeRadiusM: 100000, EnvelopeEtaSec: 100000,
		Pickup: marketplace.Area{Lat: testutil.PickupFixture().Lat, Lng: testutil.PickupFixture().Lng}}
	eligibility, err := h.Marketplace.EvaluateEligibility(context.Background(), moveActor(driver), blockedRequest, config, policy)
	if err != nil {
		t.Fatal(err)
	}
	if eligibility.Eligible || !hasReason(eligibility, marketplace.ReasonAccountNotEligible) {
		t.Fatalf("suspended driver should be ACCOUNT_NOT_ELIGIBLE: %+v", eligibility)
	}

	// A re-decision of an already-decided action is a version conflict, not
	// a silent no-op or a double audit row.
	redecide := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/decide", approver,
		map[string]any{"approve": true, "reason": "again"}, move.IdempotencyHeader, idemKey())
	requireCode(t, redecide, http.StatusConflict, "version_conflict")
	if n := auditCount(t, h, "mp.standing.decide", action.ID); n != 1 {
		t.Fatalf("audit rows after a rejected re-decision: %d, want still 1", n)
	}

	// The driver appeals (an operator records it); maker-checker again: the
	// operator who filed the appeal cannot decide it.
	fileAppeal := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/appeal", approver,
		map[string]any{"note": "driver disputes via support ticket #42"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, fileAppeal, http.StatusOK)
	var appealed marketplace.StandingActionView
	h.DecodeBody(fileAppeal, &appealed)
	if appealed.Status != marketplace.StandingStatusAppealed {
		t.Fatalf("filed appeal: %+v", appealed)
	}

	selfDecide := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/appeal-decision", approver,
		map[string]any{"uphold": true, "reason": "nope"}, move.IdempotencyHeader, idemKey())
	requireStatus(t, selfDecide, http.StatusForbidden)

	uphold := h.Do(http.MethodPost, "/admin/mp/standing-actions/"+action.ID+"/appeal-decision", thirdReviewer,
		map[string]any{"uphold": true, "reason": "cancellations were provider-side outages, not the driver's fault"},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, uphold, http.StatusOK)
	var upheld marketplace.StandingActionView
	h.DecodeBody(uphold, &upheld)
	if upheld.Status != marketplace.StandingStatusAppealUpheld {
		t.Fatalf("upheld appeal: %+v", upheld)
	}
	if n := auditCount(t, h, "mp.standing.appeal_decided", action.ID); n != 1 {
		t.Fatalf("audit rows for the appeal decision: %d, want 1", n)
	}

	unblocked, err := h.Marketplace.EvaluateEligibility(context.Background(), moveActor(driver), blockedRequest, config, policy)
	if err != nil {
		t.Fatal(err)
	}
	if hasReason(unblocked, marketplace.ReasonAccountNotEligible) {
		t.Fatalf("driver should no longer be blocked after an upheld appeal: %+v", unblocked)
	}

	// A warning is informational: single-operator, commits immediately.
	warn := h.Do(http.MethodPost, "/admin/mp/drivers/"+driver.UserID.String()+"/standing-actions", proposer,
		map[string]any{"actionType": "warning", "reasonCode": "policy_violation", "cityId": h.CityID},
		move.IdempotencyHeader, idemKey())
	requireStatus(t, warn, http.StatusCreated)
	var warning marketplace.StandingActionView
	h.DecodeBody(warn, &warning)
	if warning.Status != marketplace.StandingStatusActive || warning.RequiresApproval {
		t.Fatalf("warning: %+v", warning)
	}

	// The review queue lists the review-relevant statuses.
	queue := h.Do(http.MethodGet, "/admin/mp/standing-actions?status="+marketplace.StandingStatusAppealUpheld, adminActor(h), nil)
	requireStatus(t, queue, http.StatusOK)
	var qpage marketplace.StandingActionsPage
	h.DecodeBody(queue, &qpage)
	var onQueue bool
	for _, row := range qpage.Rows {
		if row.ID == action.ID {
			onQueue = true
		}
	}
	if !onQueue {
		t.Fatalf("appeal_upheld action not on the review queue: %+v", qpage.Rows)
	}
}

// ---------------------------------------------------------------------------
// Pagination: store-level, exercised directly against synthetic rows.
// ---------------------------------------------------------------------------

func TestAdminListsPaginate(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	driverID := uuid.New()

	for i := 0; i < 5; i++ {
		if err := h.Marketplace.Store().InsertStandingAction(ctx, h.Pool, &marketplace.StandingAction{
			ID: uuid.New(), DriverID: driverID, CityID: h.CityID, ActionType: marketplace.StandingActionWarning,
			ReasonCode: "other", Status: marketplace.StandingStatusActive, ProposedBy: uuid.New(),
		}); err != nil {
			t.Fatal(err)
		}
	}

	first, err := h.Marketplace.Store().ListStandingActions(ctx, h.Pool, &driverID, "", "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 {
		t.Fatalf("first page: %d rows, want 2", len(first))
	}
	cursor := marketplace.CursorFor(first[len(first)-1].CreatedAt, first[len(first)-1].ID)
	second, err := h.Marketplace.Store().ListStandingActions(ctx, h.Pool, &driverID, "", cursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 2 {
		t.Fatalf("second page: %d rows, want 2", len(second))
	}
	if first[0].ID == second[0].ID || first[1].ID == second[0].ID {
		t.Fatalf("pages overlap: first=%+v second=%+v", first, second)
	}
	lastCursor := marketplace.CursorFor(second[len(second)-1].CreatedAt, second[len(second)-1].ID)
	third, err := h.Marketplace.Store().ListStandingActions(ctx, h.Pool, &driverID, "", lastCursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(third) != 1 {
		t.Fatalf("third page: %d rows, want 1 (5 total)", len(third))
	}
}
