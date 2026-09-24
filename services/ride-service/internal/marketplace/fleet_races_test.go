package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// holdBookingLock takes the booking's row lock in a transaction of its own
// (as a concurrent writer would) and reports that transaction's backend pid,
// so a test can see who queues behind it.
func holdBookingLock(t *testing.T, h *testutil.Harness, bookingID uuid.UUID) (pgx.Tx, int) {
	t.Helper()
	ctx := context.Background()
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	if _, err := tx.Exec(ctx, `SELECT 1 FROM mp.advance_bookings WHERE id = $1 FOR UPDATE`, bookingID); err != nil {
		t.Fatal(err)
	}
	var pid int
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return tx, pid
}

// waitForQueue waits until at least `want` backends queue, directly or
// transitively, behind the backend `pid`.
func waitForQueue(t *testing.T, h *testutil.Harness, pid, want int) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		var queued int
		if err := h.Pool.QueryRow(context.Background(), `
			WITH RECURSIVE chain(pid) AS (
				SELECT a.pid FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid))
				UNION
				SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
			)
			SELECT COUNT(*) FROM chain`, pid).Scan(&queued); err != nil {
			t.Fatal(err)
		}
		if queued >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d of %d callers queued behind the held lock", queued, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestRiskLapseRechecksTheRiskUnderTheBookingLock: the lapse sweep lists
// at-risk bookings past their deadline without a lock. A blocker that clears
// (and resolves the risk) while the sweep waits for the booking's lock must
// win: the booking is NOT failed for a risk that no longer exists — no
// failure, no commission reversal, no rider funding release.
func TestRiskLapseRechecksTheRiskUnderTheBookingLock(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicle := fleetVehicle(h, double, "a")
	f := bookOnVehicle(t, h, double, vehicle, 4*time.Hour, "wallet")
	reportOffRoad(t, h, "off-a", vehicle)
	b := f.reload(t)
	if b.Risk != machine.MpRiskAtRisk || b.RiskDeadline == nil {
		t.Fatalf("fixture: the booking is at risk: %s", b.Risk)
	}
	h.Clock.Set(*b.RiskDeadline)

	tx, pid := holdBookingLock(t, h, b.ID)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = h.Marketplace.Sweep(context.Background())
	}()
	// The sweep has listed the booking as due and now queues for its lock.
	waitForQueue(t, h, pid, 1)
	// Meanwhile the blocker clears and the risk resolves (what the fleet
	// releasing its off-road report commits).
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `
		UPDATE mp.booking_risk_blockers SET state = 'cleared', cleared_at = now(), clear_reason = 'off_road_released'
		WHERE booking_id = $1 AND state = 'open'`, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE mp.advance_bookings SET risk = 'ok', risk_deadline = NULL, risk_since = NULL, version = version + 1
		WHERE id = $1`, b.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the sweep did not finish")
	}

	b = f.reload(t)
	if b.State != machine.MpBookingConfirmed || b.Risk != machine.MpRiskOK || b.Failure != nil {
		t.Fatalf("a risk resolved before the sweep held the lock must not fail the booking: %s / %s / %+v", b.State, b.Risk, b.Failure)
	}
	if h.Wallet.ReversalsByReservation[f.reservationID] != 0 || outboxCount(t, h, "mp.advance_booking.failed", b.ID.String()) != 0 {
		t.Fatal("nothing was reversed or published for a booking that stays")
	}
	if _, released := h.Funding.ReleasedAwards[f.award.ID]; released {
		t.Fatal("the rider's funding stays secured")
	}
}

// TestVehicleSwapDecisionsReplayConcurrentRetries: the same Idempotency-Key
// sent twice at once (a client retrying before the first answer) is answered
// the same both times — for the driver's decision and the rider's consent —
// never a conflict for the retry, and the swap moves once.
func TestVehicleSwapDecisionsReplayConcurrentRetries(t *testing.T) {
	double := newFleetDouble(t)
	h := swapHarness(t, double)
	original := fleetVehicle(h, double, "a")
	target := fleetVehicle(h, double, "b")
	f := bookOnVehicle(t, h, double, original, 30*time.Hour, "wallet")
	swapID := proposedSwapID(t, h, f.booking.BlockID, target)

	// run holds the booking's lock while both calls queue behind it, then
	// lets them race.
	run := func(call func() *httptest.ResponseRecorder) []*httptest.ResponseRecorder {
		t.Helper()
		tx, pid := holdBookingLock(t, h, f.booking.ID)
		results := make([]*httptest.ResponseRecorder, 2)
		var wg sync.WaitGroup
		for i := range results {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				results[i] = call()
			}(i)
		}
		waitForQueue(t, h, pid, 2)
		if err := tx.Commit(context.Background()); err != nil {
			t.Fatal(err)
		}
		wg.Wait()
		return results
	}

	driverKey := idemKey()
	for i, recorder := range run(func() *httptest.ResponseRecorder { return f.driverDecides(swapID, "accept", driverKey) }) {
		if recorder.Code != http.StatusOK {
			t.Fatalf("driver decision %d: a concurrent retry of the same key is answered the same, got %d %s", i, recorder.Code, recorder.Body.String())
		}
	}
	if outboxCount(t, h, "mp.vehicle_swap.driver_accepted", swapID) != 1 {
		t.Fatal("the driver's acceptance is recorded once")
	}
	if swap := swapRow(t, h, swapID); swap.State != machine.MpSwapRiderConsent {
		t.Fatalf("the swap was revalidated and awaits the rider: %s", swap.State)
	}

	riderKey := idemKey()
	for i, recorder := range run(func() *httptest.ResponseRecorder { return f.riderDecides(swapID, "accept", riderKey) }) {
		if recorder.Code != http.StatusOK {
			t.Fatalf("rider consent %d: a concurrent retry of the same key is answered the same, got %d %s", i, recorder.Code, recorder.Body.String())
		}
	}
	if outboxCount(t, h, "mp.vehicle_swap.applied", swapID) != 1 {
		t.Fatal("the swap is applied once")
	}
	if b := f.reload(t); b.VehicleID == nil || *b.VehicleID != target {
		t.Fatalf("the booking moved to the new vehicle: %+v", b.VehicleID)
	}
}
