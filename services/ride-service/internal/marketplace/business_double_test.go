package marketplace_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// businessDouble answers payment-service's internal business API at
// /v1/finance/business exactly as documented in
// packages/contracts/src/business-travel.ts and implemented by
// services/payment-service/src/business (routes.ts, reservations.ts,
// authority.ts, model.ts):
//
//   - internalServiceAuth on X-Service-Key (401 unauthorized);
//   - the body schemas (422 validation_failed), a service Idempotency-Key on
//     every POST but /policy-check (8-255 url-safe characters), X-City-ID on
//     /policy-check and /reserve (404 city_unsupported when absent);
//   - evaluatePolicy's fixed reason order (organization active, booker may
//     book, traveller a member, an active cost centre — the named one or the
//     traveller's default —, service, class, currency, per-trip cap), the
//     business_travel flag (reservations only; commit/release always work),
//     the budget (no_budget_for_period, budget_insufficient) — each refusal
//     the canonical error body with REFUSAL_CODE's code and details.reason;
//   - reserve idempotent on the scoped key (same terms ⇒ 200 replay, other
//     terms ⇒ 409 idempotency_key_reuse) AND on the booking ref (same terms
//     under any key ⇒ 200 replay, other terms ⇒ 409 conflict); at most one
//     commit and one release per reservation (a replay with the same terms
//     answers the recorded result, different ⇒ 409 conflict / illegal
//     transition), commit never above the reservation (409 conflict),
//     assertMayCancel's identity half on release (403 forbidden,
//     cancel_not_permitted);
//   - included taxes at the city's VAT rate on commit (half-up), and the
//     status read with the organization's billing identity and cost centre.
//
// (payment-service is a Node service: it cannot run in this Go test binary,
// so its documented semantics are replicated here and the bodies are pinned
// against testdata/business_finance_contract.json.)
type businessDouble struct {
	t   *testing.T
	srv *httptest.Server
	key string

	mu        sync.Mutex
	flagOn    bool
	vatBps    int
	orgs      map[string]*doubleOrg
	members   map[string]map[string]*doubleMember // org → user → member
	centres   map[string]*doubleCentre
	budgets   map[string]*doubleBudget // cost centre → budget
	resByRef  map[string]*doubleReservation
	opsByKey  map[string]*doubleOp
	opsByRes  map[string]map[string]*doubleOp // reservation → op → record
	calls     map[string]int
	bodies    map[string][]map[string]any
	keys      map[string][]string
	seq       int
	dropAfter map[string]int // path → answers to drop after recording
	// serverErrors answers 500 BEFORE handling, per path: nothing recorded.
	serverErrors map[string]int
}

type doubleOrg struct {
	id, name, currency, status string
	legalName, taxID           *string
	tripCapMinor               int64
	services, classes          []string
	policyVersion              int
}

type doubleMember struct {
	role, status, centre string
}

type doubleCentre struct {
	id, org, code, name, status string
}

type doubleBudget struct {
	id      string
	balance int64
}

type doubleReservation struct {
	view      map[string]any
	id, ref   string
	org       string
	centre    string
	budget    string
	booker    string
	traveller string
	currency  string
	reserved  int64
	committed *int64
	state     string
	hash      string
}

type doubleOp struct {
	op, hash, reservation, key string
	result                     map[string]any
	amount                     int64
	entry                      *string
	at                         string
}

var serviceKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{8,255}$`)

func newBusinessDouble(t *testing.T, key string) *businessDouble {
	t.Helper()
	d := &businessDouble{
		t: t, key: key, flagOn: true, vatBps: 750,
		orgs: map[string]*doubleOrg{}, members: map[string]map[string]*doubleMember{},
		centres: map[string]*doubleCentre{}, budgets: map[string]*doubleBudget{},
		resByRef: map[string]*doubleReservation{}, opsByKey: map[string]*doubleOp{},
		opsByRes: map[string]map[string]*doubleOp{}, calls: map[string]int{},
		bodies: map[string][]map[string]any{}, keys: map[string][]string{}, dropAfter: map[string]int{},
		serverErrors: map[string]int{},
	}
	d.srv = httptest.NewServer(http.HandlerFunc(d.serve))
	t.Cleanup(d.srv.Close)
	return d
}

func (d *businessDouble) url() string { return d.srv.URL }

// orgFixture seeds one organization with an owner/booker/traveller cast, an
// open policy for rides in go/comfort, and a funded budget.
type orgFixture struct {
	orgID, centreID, centreCode string
	booker, traveller, admin    uuid.UUID
}

func (d *businessDouble) seedOrg(booker, traveller uuid.UUID, tripCap, budget int64) *orgFixture {
	d.mu.Lock()
	defer d.mu.Unlock()
	id := "org_" + uuid.NewString()[:8]
	legal, tax := "Acme Logistics Nigeria Ltd", "TIN-"+id
	d.orgs[id] = &doubleOrg{id: id, name: "Acme Logistics", currency: testCurrency, status: "active",
		legalName: &legal, taxID: &tax, tripCapMinor: tripCap,
		services: []string{"ride"}, classes: []string{"go", "comfort"}, policyVersion: 3}
	centre := "occ_" + uuid.NewString()[:8]
	d.centres[centre] = &doubleCentre{id: centre, org: id, code: "OPS", name: "Operations", status: "active"}
	d.budgets[centre] = &doubleBudget{id: "obg_" + uuid.NewString()[:8], balance: budget}
	admin := uuid.New()
	d.members[id] = map[string]*doubleMember{
		booker.String():    {role: "booker", status: "active", centre: centre},
		traveller.String(): {role: "traveller", status: "active", centre: centre},
		admin.String():     {role: "admin", status: "active"},
	}
	return &orgFixture{orgID: id, centreID: centre, centreCode: "OPS", booker: booker, traveller: traveller, admin: admin}
}

func (d *businessDouble) setClasses(orgID string, classes ...string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.orgs[orgID].classes = classes
}

func (d *businessDouble) setBudget(centre string, balance int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.budgets[centre].balance = balance
}

func (d *businessDouble) dropBudget(centre string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.budgets, centre)
}

func (d *businessDouble) removeMember(orgID string, user uuid.UUID) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.members[orgID][user.String()].status = "removed"
}

func (d *businessDouble) dropAfterRecording(path string, times int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dropAfter[path] = times
}

// failBeforeHandling answers 500 internal_error to the next `times` calls of
// a path without handling them (nothing recorded): an outage.
func (d *businessDouble) failBeforeHandling(path string, times int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.serverErrors[path] = times
}

func (d *businessDouble) callCount(path string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls[path]
}

func (d *businessDouble) bodiesOf(path string) []map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]map[string]any(nil), d.bodies[path]...)
}

func (d *businessDouble) keysOf(path string) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.keys[path]...)
}

// reservation answers a copy of the double's reservation for a booking ref.
func (d *businessDouble) reservation(ref string) (*doubleReservation, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.resByRef[ref]
	if !ok {
		return nil, false
	}
	copied := *r
	if r.committed != nil {
		committed := *r.committed
		copied.committed = &committed
	}
	copied.view = nil
	return &copied, true
}

// releasedBy answers who released a booking ref (the reservation view's
// releasedBy), or "".
func (d *businessDouble) releasedBy(ref string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if r, ok := d.resByRef[ref]; ok {
		if by, ok := r.view["releasedBy"].(string); ok {
			return by
		}
	}
	return ""
}

func (d *businessDouble) reservationCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.resByRef)
}

func (d *businessDouble) balance(centre string) int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.budgets[centre].balance
}

// available is balance − live reservations (budgetView).
func (d *businessDouble) availableLocked(centre string) int64 {
	budget := d.budgets[centre]
	held := int64(0)
	for _, r := range d.resByRef {
		if r.centre == centre && r.state == "reserved" {
			held += r.reserved
		}
	}
	return budget.balance - held
}

// ── HTTP plumbing ──────────────────────────────────────────────────────────

var refusalCodes = map[string]struct {
	code   string
	status int
}{
	"feature_disabled":        {"feature_disabled", 404},
	"organization_not_active": {"forbidden", 403},
	"booker_not_authorized":   {"forbidden", 403},
	"traveller_not_member":    {"forbidden", 403},
	"cost_centre_invalid":     {"validation_failed", 422},
	"service_not_allowed":     {"forbidden", 403},
	"class_not_allowed":       {"forbidden", 403},
	"trip_cap_exceeded":       {"limit_exceeded", 422},
	"currency_mismatch":       {"validation_failed", 422},
	"no_budget_for_period":    {"insufficient_spendable", 422},
	"budget_insufficient":     {"insufficient_spendable", 422},
}

func (d *businessDouble) fail(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]any{"code": code, "message": message}
	if details != nil {
		body["details"] = details
	}
	_ = json.NewEncoder(w).Encode(body)
}

func (d *businessDouble) refuse(w http.ResponseWriter, reason string, extra map[string]any) {
	mapped := refusalCodes[reason]
	details := map[string]any{"reason": reason}
	for k, v := range extra {
		details[k] = v
	}
	d.fail(w, mapped.status, mapped.code, "refused: "+reason, details)
}

func (d *businessDouble) reply(w http.ResponseWriter, r *http.Request, status int, body any) {
	if n := d.dropAfter[r.URL.Path]; n > 0 {
		// The op is recorded; the caller never hears so (a lost answer).
		d.dropAfter[r.URL.Path] = n - 1
		if hijacker, ok := w.(http.Hijacker); ok {
			if conn, _, err := hijacker.Hijack(); err == nil {
				_ = conn.Close()
				return
			}
		}
		d.t.Error("the business double cannot drop a connection")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (d *businessDouble) now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func (d *businessDouble) nextID(prefix string) string {
	d.seq++
	return prefix + "_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "") + "_" + itoaInt(d.seq)
}

func itoaInt(n int) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}

func termsHash(parts ...any) string {
	raw, _ := json.Marshal(parts)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (d *businessDouble) serve(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	const base = "/v1/finance/business"
	if !strings.HasPrefix(r.URL.Path, base) {
		d.fail(w, 404, "not_found", "no such route", nil)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, base)
	d.calls[r.URL.Path]++
	statusPath := r.URL.Path
	if strings.HasPrefix(path, "/reservations/") {
		statusPath = base + "/reservations"
	}
	var body map[string]any
	if r.Method == http.MethodPost {
		if key := r.Header.Get("Idempotency-Key"); key != "" {
			d.keys[r.URL.Path] = append(d.keys[r.URL.Path], key)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			d.fail(w, 422, "validation_failed", "the request body is not valid", nil)
			return
		}
		d.bodies[r.URL.Path] = append(d.bodies[r.URL.Path], body)
	}
	if n := d.serverErrors[statusPath]; n > 0 {
		d.serverErrors[statusPath] = n - 1
		d.fail(w, 500, "internal_error", "something went wrong handling that request", nil)
		return
	}
	if d.key == "" || r.Header.Get("X-Service-Key") != d.key {
		d.fail(w, 401, "unauthorized", "service authentication required", nil)
		return
	}
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/reservations/") {
		d.status(w, r, strings.TrimPrefix(path, "/reservations/"))
		return
	}
	if r.Method != http.MethodPost {
		d.fail(w, 404, "not_found", "no such route", nil)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if path != "/policy-check" && !serviceKeyPattern.MatchString(key) {
		d.fail(w, 422, "validation_failed", "a valid Idempotency-Key header is required", nil)
		return
	}
	switch path {
	case "/policy-check", "/reserve":
		if r.Header.Get("X-City-ID") == "" {
			d.fail(w, 404, "city_unsupported", "the request does not say which city the trip is in", nil)
			return
		}
		terms, ok := d.parseTerms(body)
		if !ok {
			d.fail(w, 422, "validation_failed", "the request body is not valid", nil)
			return
		}
		if path == "/policy-check" {
			d.policyCheck(w, r, terms)
			return
		}
		d.reserve(w, r, terms, key)
	case "/commit":
		d.commit(w, r, body, key)
	case "/release":
		d.release(w, r, body, key)
	default:
		d.fail(w, 404, "not_found", "no such route", nil)
	}
}

type doubleTerms struct {
	ref, org, centre, booker, traveller, service, class, currency, category string
	amount                                                                  int64
}

func (d *businessDouble) parseTerms(body map[string]any) (doubleTerms, bool) {
	str := func(key string) string { v, _ := body[key].(string); return v }
	amount, isNum := body["amountMinor"].(float64)
	terms := doubleTerms{
		ref: str("bookingRef"), org: str("organizationId"), centre: str("costCentreId"),
		booker: str("bookerId"), traveller: str("travellerId"), service: str("service"),
		class: str("vehicleClass"), currency: str("currency"), category: str("expenseCategory"),
		amount: int64(amount),
	}
	switch {
	case terms.ref == "" || len(terms.ref) > 200 || terms.org == "" || terms.booker == "" || terms.traveller == "":
		return terms, false
	case !isNum || amount != float64(int64(amount)) || amount <= 0:
		return terms, false
	case terms.service != "ride" && terms.service != "delivery":
		return terms, false
	case len(terms.currency) != 3:
		return terms, false
	}
	return terms, true
}

// evaluate is authority.ts evaluatePolicy: every reason, in order.
func (d *businessDouble) evaluate(org *doubleOrg, terms doubleTerms) ([]string, *doubleCentre) {
	var reasons []string
	if org.status != "active" {
		reasons = append(reasons, "organization_not_active")
	}
	active := func(user string) *doubleMember {
		if m, ok := d.members[org.id][user]; ok && m.status == "active" {
			return m
		}
		return nil
	}
	booker := active(terms.booker)
	traveller := booker
	if terms.traveller != terms.booker {
		traveller = active(terms.traveller)
	}
	self := terms.booker == terms.traveller
	mayBookForOthers := booker != nil && (booker.role == "owner" || booker.role == "admin" || booker.role == "booker")
	if booker == nil || (!self && !mayBookForOthers) {
		reasons = append(reasons, "booker_not_authorized")
	}
	if traveller == nil {
		reasons = append(reasons, "traveller_not_member")
	}
	centreID := terms.centre
	if centreID == "" && traveller != nil {
		centreID = traveller.centre
	}
	centre := d.centres[centreID]
	if centre == nil || centre.org != org.id || centre.status != "active" {
		centre = nil
		reasons = append(reasons, "cost_centre_invalid")
	}
	contains := func(list []string, v string) bool {
		for _, item := range list {
			if item == v {
				return true
			}
		}
		return false
	}
	if !contains(org.services, terms.service) {
		reasons = append(reasons, "service_not_allowed")
	}
	if !contains(org.classes, terms.class) {
		reasons = append(reasons, "class_not_allowed")
	}
	if terms.currency != org.currency {
		reasons = append(reasons, "currency_mismatch")
	} else if terms.amount > org.tripCapMinor {
		reasons = append(reasons, "trip_cap_exceeded")
	}
	return reasons, centre
}

func (d *businessDouble) policyCheck(w http.ResponseWriter, r *http.Request, terms doubleTerms) {
	org := d.orgs[terms.org]
	if org == nil {
		d.fail(w, 404, "not_found", "no such organization", nil)
		return
	}
	reasons := []string{}
	if !d.flagOn {
		reasons = append(reasons, "feature_disabled")
	}
	verdict, centre := d.evaluate(org, terms)
	reasons = append(reasons, verdict...)
	var budgetID, centreID any
	var available any
	if centre != nil {
		centreID = centre.id
		if budget := d.budgets[centre.id]; budget == nil {
			reasons = append(reasons, "no_budget_for_period")
		} else {
			budgetID = budget.id
			free := d.availableLocked(centre.id)
			available = map[string]any{"amountMinor": free, "currency": org.currency}
			if free < terms.amount {
				reasons = append(reasons, "budget_insufficient")
			}
		}
	}
	d.reply(w, r, 200, map[string]any{
		"allowed": len(reasons) == 0, "reasons": reasons, "costCentreId": centreID,
		"budgetId": budgetID, "available": available, "policyVersion": org.policyVersion,
	})
}

func (d *businessDouble) reservationView(res *doubleReservation) map[string]any {
	view := map[string]any{}
	for k, v := range res.view {
		view[k] = v
	}
	view["state"] = res.state
	if res.committed != nil {
		view["committed"] = map[string]any{"amountMinor": *res.committed, "currency": res.currency}
	}
	return view
}

func (d *businessDouble) record(res *doubleReservation, op, key, hash string, amount int64, entry *string) map[string]any {
	ref := d.nextID("obo")
	result := map[string]any{
		"ref": ref, "op": op, "entryId": entry,
		"amount":      map[string]any{"amountMinor": amount, "currency": res.currency},
		"reservation": d.reservationView(res),
	}
	record := &doubleOp{op: op, hash: hash, reservation: res.id, key: key, result: result, amount: amount, entry: entry, at: d.now()}
	d.opsByKey[op+"|"+key] = record
	if d.opsByRes[res.id] == nil {
		d.opsByRes[res.id] = map[string]*doubleOp{}
	}
	d.opsByRes[res.id][op] = record
	return result
}

func withReplayed(result map[string]any, replayed bool) map[string]any {
	out := map[string]any{"replayed": replayed}
	for k, v := range result {
		out[k] = v
	}
	return out
}

func (d *businessDouble) reserve(w http.ResponseWriter, r *http.Request, terms doubleTerms, key string) {
	hash := termsHash("reserve", terms.ref, terms.org, terms.centre, terms.booker, terms.traveller,
		terms.service, terms.class, terms.amount, terms.currency, terms.category, r.Header.Get("X-City-ID"))
	if prior, ok := d.opsByKey["reserve|"+key]; ok {
		if prior.hash != hash {
			d.fail(w, 409, "idempotency_key_reuse", "this key was used with other terms", nil)
			return
		}
		d.reply(w, r, 200, withReplayed(prior.result, true))
		return
	}
	if existing, ok := d.resByRef[terms.ref]; ok {
		if existing.hash != hash {
			d.fail(w, 409, "conflict", "this booking already has a budget reservation with different terms",
				map[string]any{"bookingRef": terms.ref})
			return
		}
		d.reply(w, r, 200, withReplayed(d.opsByRes[existing.id]["reserve"].result, true))
		return
	}
	if !d.flagOn {
		d.refuse(w, "feature_disabled", map[string]any{"feature": "business_travel"})
		return
	}
	org := d.orgs[terms.org]
	if org == nil {
		d.fail(w, 404, "not_found", "no such organization", nil)
		return
	}
	reasons, centre := d.evaluate(org, terms)
	if len(reasons) > 0 || centre == nil {
		first := "cost_centre_invalid"
		if len(reasons) > 0 {
			first = reasons[0]
		}
		d.refuse(w, first, map[string]any{"reasons": reasons})
		return
	}
	budget := d.budgets[centre.id]
	if budget == nil {
		d.refuse(w, "no_budget_for_period", map[string]any{"costCentreId": centre.id})
		return
	}
	if free := d.availableLocked(centre.id); free < terms.amount {
		d.refuse(w, "budget_insufficient", map[string]any{"budgetId": budget.id, "availableMinor": free, "requiredMinor": terms.amount})
		return
	}
	var category any
	if terms.category != "" {
		category = terms.category
	}
	res := &doubleReservation{
		id: d.nextID("obr"), ref: terms.ref, org: org.id, centre: centre.id, budget: budget.id,
		booker: terms.booker, traveller: terms.traveller, currency: org.currency,
		reserved: terms.amount, state: "reserved", hash: hash,
	}
	res.view = map[string]any{
		"reservationId": res.id, "bookingRef": res.ref, "organizationId": org.id,
		"costCentreId": centre.id, "budgetId": budget.id, "period": time.Now().UTC().Format("2006-01"),
		"bookerId": terms.booker, "travellerId": terms.traveller, "service": terms.service,
		"vehicleClass": terms.class, "expenseCategory": category,
		"reserved":  map[string]any{"amountMinor": terms.amount, "currency": org.currency},
		"committed": nil, "taxes": []any{}, "commitEntryId": nil, "policyVersion": org.policyVersion,
		"releaseReason": nil, "releasedBy": nil, "createdAt": d.now(), "committedAt": nil, "releasedAt": nil,
	}
	d.resByRef[terms.ref] = res
	result := d.record(res, "reserve", key, hash, terms.amount, nil)
	d.reply(w, r, 201, withReplayed(result, false))
}

func (d *businessDouble) terminalReplay(w http.ResponseWriter, r *http.Request, res *doubleReservation, op, hash string) bool {
	recorded := d.opsByRes[res.id][op]
	if recorded == nil {
		return false
	}
	if recorded.hash != hash {
		code, message := "conflict", "this booking was already committed with different terms"
		if op == "release" {
			code, message = "illegal_transition", "this booking's reservation was already released"
		}
		d.fail(w, 409, code, message, map[string]any{"bookingRef": res.ref})
		return true
	}
	d.reply(w, r, 200, withReplayed(recorded.result, true))
	return true
}

func (d *businessDouble) commit(w http.ResponseWriter, r *http.Request, body map[string]any, key string) {
	ref, _ := body["bookingRef"].(string)
	actual, isNum := body["actualMinor"].(float64)
	currency, _ := body["currency"].(string)
	if ref == "" || !isNum || actual <= 0 || actual != float64(int64(actual)) || len(currency) != 3 {
		d.fail(w, 422, "validation_failed", "the request body is not valid", nil)
		return
	}
	hash := termsHash("commit", ref, int64(actual), currency)
	if prior, ok := d.opsByKey["commit|"+key]; ok {
		if prior.hash != hash {
			d.fail(w, 409, "idempotency_key_reuse", "this key was used with other terms", nil)
			return
		}
		d.reply(w, r, 200, withReplayed(prior.result, true))
		return
	}
	res := d.resByRef[ref]
	if res == nil {
		d.fail(w, 404, "not_found", "this booking has no business budget reservation", map[string]any{"bookingRef": ref})
		return
	}
	if d.terminalReplay(w, r, res, "commit", hash) {
		return
	}
	if res.state != "reserved" {
		d.fail(w, 409, "illegal_transition", "this booking's reservation is already "+res.state, map[string]any{"bookingRef": ref})
		return
	}
	if currency != res.currency {
		d.refuse(w, "currency_mismatch", nil)
		return
	}
	amount := int64(actual)
	if amount > res.reserved {
		d.fail(w, 409, "conflict", "a commit cannot exceed the reservation", map[string]any{"reservedMinor": res.reserved, "actualMinor": amount})
		return
	}
	d.budgets[res.centre].balance -= amount
	res.state, res.committed = "committed", &amount
	entry := d.nextID("jen")
	denominator := int64(10_000 + d.vatBps)
	tax := (amount*int64(d.vatBps)*2 + denominator) / (2 * denominator)
	res.view["taxes"] = []any{map[string]any{"code": "vat", "rateBps": d.vatBps, "amountMinor": tax}}
	res.view["commitEntryId"] = entry
	res.view["committedAt"] = d.now()
	result := d.record(res, "commit", key, hash, amount, &entry)
	d.reply(w, r, 201, withReplayed(result, false))
}

func (d *businessDouble) release(w http.ResponseWriter, r *http.Request, body map[string]any, key string) {
	ref, _ := body["bookingRef"].(string)
	reason, _ := body["reason"].(string)
	by, _ := body["cancelledBy"].(map[string]any)
	party, _ := by["party"].(string)
	user, _ := by["userId"].(string)
	if ref == "" || !regexp.MustCompile(`^[a-z0-9_]{1,64}$`).MatchString(reason) ||
		(party != "traveller" && party != "booker" && party != "org_admin" && party != "system") {
		d.fail(w, 422, "validation_failed", "the request body is not valid", nil)
		return
	}
	hash := termsHash("release", ref, party, user)
	if prior, ok := d.opsByKey["release|"+key]; ok {
		if prior.hash != hash {
			d.fail(w, 409, "idempotency_key_reuse", "this key was used with other terms", nil)
			return
		}
		d.reply(w, r, 200, withReplayed(prior.result, true))
		return
	}
	res := d.resByRef[ref]
	if res == nil {
		d.fail(w, 404, "not_found", "this booking has no business budget reservation", map[string]any{"bookingRef": ref})
		return
	}
	if d.terminalReplay(w, r, res, "release", hash) {
		return
	}
	if res.state != "reserved" {
		d.fail(w, 409, "illegal_transition", "this booking's reservation is already "+res.state, map[string]any{"bookingRef": ref})
		return
	}
	// assertMayCancel: the IDENTITY half of BUSINESS_CANCEL_RIGHTS.
	allowed := false
	switch party {
	case "system":
		if user != "" {
			d.fail(w, 422, "validation_failed", "a system release names no user", nil)
			return
		}
		allowed = true
	case "traveller":
		allowed = user == res.traveller
	case "booker":
		m := d.members[res.org][user]
		allowed = user == res.booker && m != nil && m.status == "active" &&
			(m.role == "owner" || m.role == "admin" || m.role == "booker" || user == res.traveller)
	case "org_admin":
		m := d.members[res.org][user]
		allowed = m != nil && m.status == "active" && (m.role == "owner" || m.role == "admin")
	}
	if !allowed {
		d.fail(w, 403, "forbidden", "that party may not cancel this business booking",
			map[string]any{"reason": "cancel_not_permitted", "party": party})
		return
	}
	res.state = "released"
	res.view["releaseReason"] = reason
	res.view["releasedBy"] = party
	res.view["releasedAt"] = d.now()
	result := d.record(res, "release", key, hash, res.reserved, nil)
	d.reply(w, r, 201, withReplayed(result, false))
}

func (d *businessDouble) status(w http.ResponseWriter, r *http.Request, ref string) {
	res := d.resByRef[ref]
	if res == nil {
		d.fail(w, 404, "not_found", "this booking has no business budget reservation", map[string]any{"bookingRef": ref})
		return
	}
	ops := []map[string]any{}
	for _, op := range d.opsByRes[res.id] {
		ops = append(ops, map[string]any{
			"ref": op.result["ref"], "op": op.op, "clientKey": op.key,
			"amount":  map[string]any{"amountMinor": op.amount, "currency": res.currency},
			"entryId": op.entry, "createdAt": op.at,
		})
	}
	sort.Slice(ops, func(i, j int) bool { return ops[i]["createdAt"].(string) < ops[j]["createdAt"].(string) })
	org := d.orgs[res.org]
	centre := d.centres[res.centre]
	d.reply(w, r, 200, map[string]any{
		"reservation": d.reservationView(res),
		"ops":         ops,
		"organization": map[string]any{
			"id": org.id, "name": org.name, "legalName": org.legalName, "taxId": org.taxID,
		},
		"costCentre": map[string]any{"id": centre.id, "code": centre.code, "name": centre.name},
	})
}
