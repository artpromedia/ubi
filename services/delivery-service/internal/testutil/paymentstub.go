package testutil

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// PaymentStub stands in for payment-service's /v1/finance/delivery-returns
// in delivery-service's own tests, speaking its HTTP contract
// (services/payment-service/src/finance/delivery-returns.ts): X-Service-Key
// auth, a required Idempotency-Key replayed verbatim (and refused when reused
// with different terms), one charge per return, reserve → capture | release,
// the release tombstone, insufficient funds and the city kill switch.
//
// It is a contract double, not the thing under test: what these Go tests
// prove is delivery-service's orchestration — the write-ahead markers, the
// release-before-resolve rule, compensation, the retries — against an
// endpoint that answers exactly like the real one. The money itself (the
// wallet encumbrance, the single capture entry, the commission left
// untouched) is proven against the real ledger in payment-service's
// tests/finance/delivery-returns.test.ts.
//
// Failure injection models the outcomes delivery-service must survive:
// FailNext answers 503 WITHOUT applying the op (the call never landed),
// FailAfterApply applies it and THEN answers 503 (the outcome is unknown to
// the caller), and OnReserve runs inside a reserve just before it answers
// (to race another request against an approval).
type PaymentStub struct {
	T          *testing.T
	Server     *httptest.Server
	ServiceKey string

	mu             sync.Mutex
	spendable      map[string]int64 // sender id → spendable minor units
	charges        map[string]*StubCharge
	ops            map[string]stubOp // scoped idempotency key → recorded answer
	disabledCities map[string]bool
	failNext       map[string]int
	failAfterApply map[string]int
	requests       []string
	entrySeq       int

	// OnReserve, when set, runs after a reserve is applied and before it is
	// answered.
	OnReserve func()
}

// StubCharge is the stub's record of one return charge, with how many times
// each money effect actually happened (a replay is not an effect).
type StubCharge struct {
	ChargeID       string
	ReturnID       string
	DeliveryID     string
	AwardID        string
	SenderID       string
	DriverID       string
	FeeMinor       int64
	Currency       string
	CityID         string
	State          string
	CaptureEntryID string
	Tombstone      bool
	Reserves       int
	Captures       int
	Releases       int
	releaseAnswer  []byte
}

type stubOp struct {
	hash   string
	status int
	body   []byte
}

type stubTerms struct {
	ReturnID   string `json:"returnId"`
	DeliveryID string `json:"deliveryId"`
	AwardID    string `json:"awardId"`
	SenderID   string `json:"senderId"`
	DriverID   string `json:"driverId"`
	FeeMinor   int64  `json:"feeMinor"`
	Currency   string `json:"currency"`
	Reason     string `json:"reason"`
}

// NewPaymentStub starts the stub on an httptest listener.
func NewPaymentStub(t *testing.T, serviceKey string) *PaymentStub {
	t.Helper()
	stub := &PaymentStub{
		T:              t,
		ServiceKey:     serviceKey,
		spendable:      map[string]int64{},
		charges:        map[string]*StubCharge{},
		ops:            map[string]stubOp{},
		disabledCities: map[string]bool{},
		failNext:       map[string]int{},
		failAfterApply: map[string]int{},
	}
	stub.Server = httptest.NewServer(http.HandlerFunc(stub.serve))
	t.Cleanup(stub.Server.Close)
	return stub
}

// Fund sets a sender's spendable balance.
func (s *PaymentStub) Fund(senderID string, minor int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.spendable[senderID] = minor
}

// Spendable reports a sender's spendable balance.
func (s *PaymentStub) Spendable(senderID string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.spendable[senderID]
}

// DisableCity throws the city kill switch for NEW reservations.
func (s *PaymentStub) DisableCity(cityID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.disabledCities[cityID] = true
}

// FailNext makes the next n calls of op answer 503 without applying.
func (s *PaymentStub) FailNext(op string, n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failNext[op] = n
}

// FailAfterApply makes the next n calls of op apply, then answer 503.
func (s *PaymentStub) FailAfterApply(op string, n int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failAfterApply[op] = n
}

// Charge returns a copy of the stub's record for a return (nil if none).
func (s *PaymentStub) Charge(returnID string) *StubCharge {
	s.mu.Lock()
	defer s.mu.Unlock()
	charge, ok := s.charges[returnID]
	if !ok {
		return nil
	}
	copied := *charge
	return &copied
}

// Requests lists every request path the stub received ("POST /v1/...").
func (s *PaymentStub) Requests() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.requests...)
}

func stubJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func stubError(code, message string, details map[string]interface{}) []byte {
	body := map[string]interface{}{"code": code, "message": message}
	if details != nil {
		body["details"] = details
	}
	raw, _ := json.Marshal(body)
	return raw
}

func (c *StubCharge) view() map[string]interface{} {
	var reservationID, captureEntryID interface{}
	if !c.Tombstone {
		reservationID = "mrr_stub_" + c.ReturnID
	}
	if c.CaptureEntryID != "" {
		captureEntryID = c.CaptureEntryID
	}
	return map[string]interface{}{
		"chargeId": c.ChargeID, "returnId": c.ReturnID, "state": c.State,
		"reservationId": reservationID, "captureEntryId": captureEntryID,
	}
}

func (s *PaymentStub) answer(op string, charge *StubCharge, entryID string) []byte {
	var entry interface{}
	if entryID != "" {
		entry = entryID
	}
	raw, _ := json.Marshal(map[string]interface{}{
		"ref": fmt.Sprintf("dro_stub_%s_%s", op, charge.ReturnID), "op": op,
		"chargeId": charge.ChargeID, "returnId": charge.ReturnID, "entryId": entry,
		"amount": map[string]interface{}{"amountMinor": charge.FeeMinor, "currency": charge.Currency},
		"state":  charge.State, "charge": charge.view(), "replayed": false,
	})
	return raw
}

func withReplayed(body []byte) []byte {
	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return body
	}
	decoded["replayed"] = true
	raw, _ := json.Marshal(decoded)
	return raw
}

func (s *PaymentStub) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests = append(s.requests, r.Method+" "+r.URL.Path)

	if r.Header.Get("X-Service-Key") != s.ServiceKey || s.ServiceKey == "" {
		stubJSON(w, http.StatusForbidden, []byte(`{"success":false,"error":{"code":"FORBIDDEN","message":"Internal endpoint"}}`))
		return
	}
	op := strings.TrimPrefix(r.URL.Path, "/v1/finance/delivery-returns/")
	if r.Method != http.MethodPost || (op != "reserve" && op != "capture" && op != "release") {
		stubJSON(w, http.StatusNotFound, stubError("not_found", "no such route", nil))
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 8 {
		stubJSON(w, http.StatusUnprocessableEntity, stubError("validation_failed", "Idempotency-Key required", nil))
		return
	}
	city := r.Header.Get("X-City-ID")
	if city == "" {
		stubJSON(w, http.StatusNotFound, stubError("city_unsupported", "no city", nil))
		return
	}
	var terms stubTerms
	if err := json.NewDecoder(r.Body).Decode(&terms); err != nil || terms.FeeMinor <= 0 || terms.ReturnID == "" {
		stubJSON(w, http.StatusUnprocessableEntity, stubError("validation_failed", "bad body", nil))
		return
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s|%d|%s|%s", op, terms.ReturnID, terms.DeliveryID, terms.AwardID,
		terms.SenderID, terms.DriverID, terms.FeeMinor, terms.Currency, city)))
	hash := hex.EncodeToString(sum[:])
	scoped := op + ":" + key

	if s.failNext[op] > 0 {
		s.failNext[op]--
		stubJSON(w, http.StatusServiceUnavailable, stubError("service_unavailable", "injected: not applied", nil))
		return
	}
	if prior, ok := s.ops[scoped]; ok {
		if prior.hash != hash {
			stubJSON(w, http.StatusConflict, stubError("idempotency_key_reuse", "key reused with different terms", nil))
			return
		}
		stubJSON(w, prior.status, withReplayed(prior.body))
		return
	}

	status, body := s.apply(op, terms, city)
	if status == http.StatusCreated {
		s.ops[scoped] = stubOp{hash: hash, status: http.StatusCreated, body: body}
	}
	if op == "reserve" && status == http.StatusCreated && s.OnReserve != nil {
		s.mu.Unlock()
		s.OnReserve()
		s.mu.Lock()
	}
	if status == http.StatusCreated && s.failAfterApply[op] > 0 {
		s.failAfterApply[op]--
		stubJSON(w, http.StatusServiceUnavailable, stubError("service_unavailable", "injected: applied, answer lost", nil))
		return
	}
	stubJSON(w, status, body)
}

func sameTerms(c *StubCharge, t stubTerms, city string) bool {
	return c.DeliveryID == t.DeliveryID && c.AwardID == t.AwardID && c.SenderID == t.SenderID &&
		c.DriverID == t.DriverID && c.FeeMinor == t.FeeMinor && c.Currency == t.Currency && c.CityID == city
}

func (s *PaymentStub) apply(op string, t stubTerms, city string) (int, []byte) {
	charge := s.charges[t.ReturnID]
	switch op {
	case "reserve":
		if s.disabledCities[city] {
			return http.StatusNotFound, stubError("feature_disabled", "delivery return fees are not enabled in this city", nil)
		}
		if charge != nil {
			return http.StatusConflict, stubError("conflict", "this return already has a fee charge", map[string]interface{}{"charge": charge.view()})
		}
		if s.spendable[t.SenderID] < t.FeeMinor {
			return http.StatusUnprocessableEntity, stubError("insufficient_funds", "not enough money in the wallet",
				map[string]interface{}{"requiredMinor": t.FeeMinor, "spendableMinor": s.spendable[t.SenderID]})
		}
		s.spendable[t.SenderID] -= t.FeeMinor
		charge = &StubCharge{
			ChargeID: "drc_stub_" + t.ReturnID, ReturnID: t.ReturnID, DeliveryID: t.DeliveryID, AwardID: t.AwardID,
			SenderID: t.SenderID, DriverID: t.DriverID, FeeMinor: t.FeeMinor, Currency: t.Currency, CityID: city,
			State: "reserved", Reserves: 1,
		}
		s.charges[t.ReturnID] = charge
		return http.StatusCreated, s.answer(op, charge, "")
	case "capture":
		if charge == nil {
			return http.StatusNotFound, stubError("not_found", "this delivery return has no fee reservation", nil)
		}
		if !sameTerms(charge, t, city) {
			return http.StatusConflict, stubError("conflict", "this request does not match the return's charge", nil)
		}
		if charge.State != "reserved" {
			return http.StatusConflict, stubError("illegal_transition", "a delivery return charge cannot move from "+charge.State+" to captured",
				map[string]interface{}{"charge": charge.view()})
		}
		s.entrySeq++
		charge.State = "captured"
		charge.Captures++
		charge.CaptureEntryID = fmt.Sprintf("je_stub_%d", s.entrySeq)
		return http.StatusCreated, s.answer(op, charge, charge.CaptureEntryID)
	default: // release
		if charge == nil {
			charge = &StubCharge{
				ChargeID: "drc_stub_" + t.ReturnID, ReturnID: t.ReturnID, DeliveryID: t.DeliveryID, AwardID: t.AwardID,
				SenderID: t.SenderID, DriverID: t.DriverID, FeeMinor: t.FeeMinor, Currency: t.Currency, CityID: city,
				State: "released", Tombstone: true, Releases: 1,
			}
			s.charges[t.ReturnID] = charge
			charge.releaseAnswer = s.answer(op, charge, "")
			return http.StatusCreated, charge.releaseAnswer
		}
		if !sameTerms(charge, t, city) {
			return http.StatusConflict, stubError("conflict", "this request does not match the return's charge", nil)
		}
		switch charge.State {
		case "captured":
			return http.StatusConflict, stubError("illegal_transition", "a delivery return charge cannot move from captured to released",
				map[string]interface{}{"charge": charge.view()})
		case "released":
			return http.StatusOK, withReplayed(charge.releaseAnswer)
		}
		charge.State = "released"
		charge.Releases++
		s.spendable[t.SenderID] += t.FeeMinor
		charge.releaseAnswer = s.answer(op, charge, "")
		return http.StatusCreated, charge.releaseAnswer
	}
}
