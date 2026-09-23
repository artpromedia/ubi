package marketplace

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Book for another adult (A06 part B), behind marketplace_guest_bookings.
//
// Three roles a single user used to play are kept apart on a marketplace ride
// request:
//
//   - the REQUESTER is the authenticated user who publishes, selects the
//     winning offer and may cancel — the only party the gateway identifies;
//   - the PAYER is who funds the fare: the requester (rider funding
//     authorized against them, independent of the driver's 10% commission) —
//     or, on a request booked on an organization (business_trips.go), the
//     organization's budget, never both;
//   - the PASSENGER is a named adult who travels. They are not a UBI user and
//     are never looked up: the requester states their first name and phone
//     and ATTESTS that they are an adult who agreed to be booked for.
//     Unaccompanied minors are out of scope and refused with a clear reason —
//     carrying a child alone needs a separately designed service and policy.
//
// The passenger reaches their trip through a TRIP ACCESS TOKEN: 32 random
// bytes, handed to notification-service once through the outbox (the SMS
// with the link) — SEALED, never in clear (trip_access_seal.go) — and stored
// here only as its SHA-256. A token is bound to ONE
// request, expires, is revocable by the requester, and grants exactly: the
// verified driver card once a driver is committed, live status and ETA, the
// pickup PIN while it is relevant, the support contact, and a free decline
// before pickup. It is served by a token-authenticated sub-router outside the
// gateway-identity middleware (handler/marketplace_guest.go), rate limited per
// token and per client, and reads nothing but its own trip.
//
// Privacy: the requester sees the passenger's details on THAT request only
// (there is no passenger-indexed read of any kind, so a payer never gets a
// passenger's history); the driver sees the passenger's first name and how
// pickup is verified, never the requester's details or the passenger's phone.

// Passenger attestation refusal reasons (details.reason).
const (
	ReasonUnaccompaniedMinor       = "unaccompanied_minor_not_supported"
	ReasonPassengerConsentRequired = "passenger_consent_required"
	ReasonAttestationRequired      = "passenger_attestation_required"
)

// Trip access token lifecycle.
const (
	// tripAccessTokenPrefix marks a UBI trip access token.
	tripAccessTokenPrefix = "uta_"
	// tripAccessTokenBytes is the token's entropy: 256 bits.
	tripAccessTokenBytes = 32
	// tripAccessTTL bounds a token's life: an immediate ride is booked,
	// driven and finished well inside it. Plumbing, not policy.
	tripAccessTTL = 12 * time.Hour
	// TripAccessScopeGuestPassenger is the only scope a token has today.
	TripAccessScopeGuestPassenger = "guest_passenger"
	// passengerDeclinedReason is the linked reason a passenger's decline
	// carries into the request, the award, the reversal and the release.
	passengerDeclinedReason = "passenger_declined"
)

// Token revocation reasons.
const (
	TripAccessRevokedByRequester = "requester_revoked"
	TripAccessReissued           = "reissued"
)

// Idempotency scopes of the guest-booking commands.
const (
	scopePassengerRevoke   = "mp.passenger.access_revoke"
	scopePassengerReissue  = "mp.passenger.access_reissue"
	scopeTripAccessDecline = "mp.trip_access.decline"
)

// subjectTripAccess is the outbox subject of the token events. The events
// are named trip_access.* — deliberately OFF the mp.* channel the realtime
// gateway and the push consumer fan out to riders and drivers — because the
// issued event is the SMS hand-off to notification-service. Even so its
// payload carries the passenger's phone, first name and the one-time link
// token only inside the sealed envelope only notification-service can open:
// the shared relay broadcasts every event and the outbox row persists.
const subjectTripAccess = "trip_access"

// e164 is the phone format the passenger's number must be in.
var e164 = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// PassengerInput is the optional passenger object of POST /v1/mp/requests
// (MpPassengerInputSchema). IsAdult and ConsentConfirmed are the requester's
// attestation; both are required and must be true.
type PassengerInput struct {
	FirstName        string `json:"firstName"`
	LastName         string `json:"lastName,omitempty"`
	Phone            string `json:"phone"`
	IsAdult          *bool  `json:"isAdult"`
	ConsentConfirmed *bool  `json:"consentConfirmed"`
}

// Passenger is one mp.request_passengers row.
type Passenger struct {
	RequestID       uuid.UUID
	RequesterID     uuid.UUID
	PayerID         uuid.UUID
	CityID          string
	FirstName       string
	LastName        string
	Phone           string
	AttestedAdult   bool
	AttestedConsent bool
	AttestedAt      time.Time
	DeclinedAt      *time.Time
	CreatedAt       time.Time
}

// TripAccessToken is one mp.trip_access_tokens row (never the raw token).
type TripAccessToken struct {
	ID           uuid.UUID
	RequestID    uuid.UUID
	Scope        string
	ExpiresAt    time.Time
	RevokedAt    *time.Time
	RevokedBy    string
	RevokeReason string
	LastUsedAt   *time.Time
	CreatedAt    time.Time
}

// RequestPassengerView is the passenger block of the REQUESTER's request view
// (MpRequestPassengerSchema): the details they entered, on this trip only,
// and where the passenger's access stands. The raw token is never here.
type RequestPassengerView struct {
	FirstName    string     `json:"firstName"`
	LastName     *string    `json:"lastName"`
	Phone        string     `json:"phone"`
	PayerRole    string     `json:"payerRole"`
	Attestation  string     `json:"attestation"`
	AttestedAt   time.Time  `json:"attestedAt"`
	AccessStatus string     `json:"accessStatus"`
	AccessSentAt *time.Time `json:"accessSentAt"`
	AccessExpiry *time.Time `json:"accessExpiresAt"`
	DeclinedAt   *time.Time `json:"declinedAt"`
}

// Access statuses on the requester's view.
const (
	AccessStatusActive   = "active"
	AccessStatusRevoked  = "revoked"
	AccessStatusExpired  = "expired"
	AccessStatusDeclined = "declined"
)

// passengerAttestation is the attestation the requester made, stated back.
const passengerAttestation = "The requester confirmed the passenger is an adult who agreed to be booked for this trip."

// DriverPassengerView is the passenger block on the driver's job card
// (MpDriverPassengerSchema): the first name and how pickup is verified.
type DriverPassengerView struct {
	FirstName          string `json:"firstName"`
	BookedForAnother   bool   `json:"bookedForAnother"`
	PickupVerification string `json:"pickupVerification"`
	Note               string `json:"note"`
}

// Pickup verification methods.
const (
	PickupVerificationPin       = "pin"
	PickupVerificationFirstName = "first_name"
)

// ---------------------------------------------------------------------------
// Validation and the publish-time write
// ---------------------------------------------------------------------------

// guestPassenger is a validated passenger input.
type guestPassenger struct {
	firstName string
	lastName  string
	phone     string
}

// validatePassenger checks a publish's passenger input BEFORE anything is
// written: the flag, the service, the attestation (a minor is refused with
// its own reason), the name and the phone. nil input means "the requester
// travels".
func (s *Service) validatePassenger(ctx context.Context, actor Actor, quote *Quote, input *PassengerInput) (*guestPassenger, error) {
	if input == nil {
		return nil, nil
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceGuestBookings, actor, quote.CityID); err != nil {
		return nil, err
	}
	if s.deps.TripAccessSealer == nil {
		// Fail closed: a guest booking needs the passenger's trip link, and
		// without the sealed-delivery key it cannot be sent without putting
		// the phone and token in clear. Refused before anything is written;
		// booking the ride for yourself is unaffected.
		return nil, tripLinkDeliveryUnavailable()
	}
	if quote.Service != ServiceRide {
		return nil, domain.Errorf(domain.CodeValidationFailed, "booking for another person is available for rides only").
			WithDetails(map[string]any{"field": "passenger"})
	}
	if input.IsAdult == nil || input.ConsentConfirmed == nil {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"confirm that the passenger is an adult and agreed to be booked for").
			WithDetails(map[string]any{"field": "passenger", "reason": ReasonAttestationRequired})
	}
	if !*input.IsAdult {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"UBI cannot carry a child travelling alone. An adult must travel with them, or book for themselves").
			WithDetails(map[string]any{"field": "passenger.isAdult", "reason": ReasonUnaccompaniedMinor})
	}
	if !*input.ConsentConfirmed {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"only book for someone who has agreed to it").
			WithDetails(map[string]any{"field": "passenger.consentConfirmed", "reason": ReasonPassengerConsentRequired})
	}
	firstName, err := cleanName(input.FirstName, 40, "passenger.firstName", true, false)
	if err != nil {
		return nil, err
	}
	lastName, err := cleanName(input.LastName, 60, "passenger.lastName", false, true)
	if err != nil {
		return nil, err
	}
	phone := strings.TrimSpace(input.Phone)
	if !e164.MatchString(phone) {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"the passenger's phone must be an international number such as +234…").
			WithDetails(map[string]any{"field": "passenger.phone"})
	}
	return &guestPassenger{firstName: firstName, lastName: lastName, phone: phone}, nil
}

// cleanName trims a name and refuses over-long input and anything that is
// not a name: only letters (any script), combining marks, spaces, hyphens and
// apostrophes — and full stops where `allowPeriod` (a family name's "St.").
// The first name is the opening word of a UBI-sent SMS to a phone the
// requester chose, so digits, slashes, colons, "@" and dotted domains are
// refused: the field can never carry a link or a call to action.
func cleanName(raw string, limit int, field string, required, allowPeriod bool) (string, error) {
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" {
		if required {
			return "", domain.Errorf(domain.CodeValidationFailed, "the passenger's first name is required").
				WithDetails(map[string]any{"field": field})
		}
		return "", nil
	}
	if utf8.RuneCountInString(name) > limit {
		return "", domain.Errorf(domain.CodeValidationFailed, "that name is too long (%d characters at most)", limit).
			WithDetails(map[string]any{"field": field})
	}
	for _, r := range name {
		switch {
		case unicode.IsLetter(r), unicode.IsMark(r), r == ' ', r == '-', r == '\'', r == '\u2019':
		case r == '.' && allowPeriod:
		default:
			return "", domain.Errorf(domain.CodeValidationFailed, "that name has characters we cannot use").
				WithDetails(map[string]any{"field": field})
		}
	}
	return name, nil
}

// newTripAccessToken mints a raw token and its stored hash.
func newTripAccessToken() (string, string, error) {
	buf := make([]byte, tripAccessTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := tripAccessTokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	return raw, hashTripAccessToken(raw), nil
}

// hashTripAccessToken is the only form a token is stored or looked up in.
func hashTripAccessToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// wellFormedTripAccessToken rejects anything that cannot be a token before a
// database read.
func wellFormedTripAccessToken(raw string) bool {
	if !strings.HasPrefix(raw, tripAccessTokenPrefix) {
		return false
	}
	body := raw[len(tripAccessTokenPrefix):]
	if len(body) != base64.RawURLEncoding.EncodedLen(tripAccessTokenBytes) {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(body)
	return err == nil
}

// guestSMSTemplate is the passenger's SMS as a TEMPLATE: notification-service
// fills {firstName} from the opened sealed envelope and {link} from its
// configured trip-link base and the token, so neither is ever in clear on the
// event. It never promises a driver: at publish time none is committed.
const guestSMSTemplate = "{firstName}, a UBI rider has requested a ride for you. No driver is confirmed yet. " +
	"Follow the trip, see your driver and pickup PIN once one is confirmed, or decline for free before pickup: {link}"

// writePassenger records the passenger and issues their first trip access
// token inside the publishing transaction, with the SMS hand-off event and
// the audit row. The raw token leaves ride-service exactly once: sealed in
// the outbox payload notification-service opens and turns into the SMS.
func (s *Service) writePassenger(ctx context.Context, tx pgx.Tx, request *Request, actor Actor, passenger *guestPassenger, now time.Time) (*RequestPassengerView, error) {
	row := &Passenger{
		RequestID:       request.ID,
		RequesterID:     actor.UserID,
		PayerID:         actor.UserID,
		CityID:          request.CityID,
		FirstName:       passenger.firstName,
		LastName:        passenger.lastName,
		Phone:           passenger.phone,
		AttestedAdult:   true,
		AttestedConsent: true,
		AttestedAt:      now,
		CreatedAt:       now,
	}
	if err := s.deps.Store.InsertPassenger(ctx, tx, row); err != nil {
		return nil, err
	}
	token, err := s.issueTripAccess(ctx, tx, row, "rider", actor.UserID.String(), now)
	if err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, AuditRecord{
		ActorID:     actor.UserID.String(),
		ActorRole:   actor.Role,
		Action:      "mp.request.passenger_named",
		SubjectType: subjectRequest,
		SubjectID:   request.ID.String(),
		After: map[string]any{
			"payer":            passengerPayerRole(request),
			"attestedAdult":    true,
			"attestedConsent":  true,
			"tripAccessId":     token.ID.String(),
			"tripAccessExpiry": token.ExpiresAt.Format(time.RFC3339),
		},
		Reason: "requester booked the ride for another adult and attested their age and consent",
	}); err != nil {
		return nil, err
	}
	return passengerViewOf(row, passengerPayerRole(request), token, now), nil
}

// issueTripAccess mints and stores one token for a passenger and writes the
// trip_access.issued event — the TRIP-LINK SEALED DELIVERY CONTRACT
// (trip_access_seal.go): the payload keeps only non-sensitive fields (token
// id, request, scope, expiry, the channel and the SMS template) and carries
// the phone, the raw token and the first name ONLY inside `sealed`,
// AES-256-GCM under TRIP_ACCESS_DELIVERY_KEY with AAD
// "ubi.trip_access.v1|<tokenId>" and a fresh random IV. Without a sealer it
// refuses, so the transaction rolls back and nothing is written in clear.
func (s *Service) issueTripAccess(ctx context.Context, tx pgx.Tx, passenger *Passenger, actorType, actorID string, now time.Time) (*TripAccessToken, error) {
	sealer := s.deps.TripAccessSealer
	if sealer == nil {
		return nil, tripLinkDeliveryUnavailable()
	}
	raw, hash, err := newTripAccessToken()
	if err != nil {
		return nil, err
	}
	token := &TripAccessToken{
		ID:        uuid.New(),
		RequestID: passenger.RequestID,
		Scope:     TripAccessScopeGuestPassenger,
		ExpiresAt: now.Add(tripAccessTTL),
		CreatedAt: now,
	}
	sealed, err := sealer.seal(token.ID.String(), tripAccessPlaintext{
		Phone:     passenger.Phone,
		Token:     raw,
		FirstName: passenger.FirstName,
	})
	if err != nil {
		return nil, err
	}
	if err := s.deps.Store.InsertTripAccessToken(ctx, tx, token, hash); err != nil {
		return nil, err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "trip_access.issued",
		AggregateType:  subjectTripAccess,
		AggregateID:    token.ID.String(),
		ToVersion:      1,
		CityID:         passenger.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: "trip_access.issued:" + token.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"tokenId":   token.ID.String(),
			"requestId": passenger.RequestID.String(),
			"scope":     token.Scope,
			"expiresAt": token.ExpiresAt.Format(time.RFC3339),
			"recipient": map[string]any{"channel": "sms"},
			"smsCopy":   guestSMSTemplate,
			"sealed":    sealed,
		},
	}); err != nil {
		return nil, err
	}
	return token, nil
}

// passengerPayerRole is who funds a passenger's fare: the requester, or the
// organization on a request booked on one (A06 part C; its payment method
// is `business`) — stated identically on every view of the passenger.
func passengerPayerRole(request *Request) string {
	if request.PaymentMethodID == PaymentMethodBusiness {
		return "organization"
	}
	return "requester"
}

// passengerViewOf renders the requester's passenger block.
func passengerViewOf(p *Passenger, payerRole string, token *TripAccessToken, now time.Time) *RequestPassengerView {
	view := &RequestPassengerView{
		FirstName:    p.FirstName,
		Phone:        p.Phone,
		PayerRole:    payerRole,
		Attestation:  passengerAttestation,
		AttestedAt:   p.AttestedAt,
		AccessStatus: AccessStatusRevoked,
		DeclinedAt:   p.DeclinedAt,
	}
	if p.LastName != "" {
		lastName := p.LastName
		view.LastName = &lastName
	}
	if token != nil {
		sent, expiry := token.CreatedAt, token.ExpiresAt
		view.AccessSentAt, view.AccessExpiry = &sent, &expiry
		switch {
		case token.RevokedAt != nil:
			view.AccessStatus = AccessStatusRevoked
		case !now.Before(token.ExpiresAt):
			view.AccessStatus = AccessStatusExpired
		default:
			view.AccessStatus = AccessStatusActive
		}
	}
	if p.DeclinedAt != nil {
		view.AccessStatus = AccessStatusDeclined
	}
	return view
}

// attachPassenger adds the passenger block to the requester's request view
// (a request with no passenger has none). A read failure omits the block
// rather than failing the snapshot.
func (s *Service) attachPassenger(ctx context.Context, view *RequestView, request *Request) {
	passenger, err := s.deps.Store.PassengerForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			s.deps.Logger.Warn().Err(err).Str("request_id", request.ID.String()).Msg("could not read the request's passenger")
		}
		return
	}
	token, err := s.deps.Store.LatestTripAccessToken(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		s.deps.Logger.Warn().Err(err).Str("request_id", request.ID.String()).Msg("could not read the passenger's trip access")
	}
	view.Passenger = passengerViewOf(passenger, passengerPayerRole(request), token, s.now())
}

// driverPassengerFor is the driver job card's passenger block: first name and
// pickup verification, nothing else. Nil when the requester travels.
func (s *Service) driverPassengerFor(ctx context.Context, request *Request) *DriverPassengerView {
	passenger, err := s.deps.Store.PassengerForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		return nil
	}
	method := PickupVerificationPin
	note := "You are picking up " + passenger.FirstName + ", booked by someone else. Ask for the pickup PIN before starting the trip."
	if config, cfgErr := s.config(ctx, request.CityID); cfgErr == nil && !config.PinRequired {
		method = PickupVerificationFirstName
		note = "You are picking up " + passenger.FirstName + ", booked by someone else. Confirm their first name before starting the trip."
	}
	return &DriverPassengerView{
		FirstName:          passenger.FirstName,
		BookedForAnother:   true,
		PickupVerification: method,
		Note:               note,
	}
}

// ---------------------------------------------------------------------------
// The requester's access controls: revoke and reissue
// ---------------------------------------------------------------------------

// passengerRequestFor loads a request the actor owns that has a passenger.
func (s *Service) passengerRequestFor(ctx context.Context, actor Actor, requestID uuid.UUID) (*Request, *Passenger, error) {
	notFound := domain.Errorf(domain.CodeNotFound, "that request does not exist")
	if !actor.IsRider() {
		return nil, nil, notFound
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && request.RequesterID != actor.UserID) {
		return nil, nil, notFound
	}
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	passenger, err := s.deps.Store.PassengerForRequest(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil, domain.Errorf(domain.CodeNotFound, "this request has no passenger booked by you")
	}
	if err != nil {
		return nil, nil, asDomainError(err)
	}
	return request, passenger, nil
}

// RevokePassengerAccess answers POST /v1/mp/requests/{id}/passenger/access/revoke:
// the requester withdraws the passenger's trip link. Idempotent; always
// allowed (a safety control is never behind a flag).
func (s *Service) RevokePassengerAccess(ctx context.Context, actor Actor, requestID uuid.UUID, idempotencyKey string) (*RequestPassengerView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	request, passenger, err := s.passengerRequestFor(ctx, actor, requestID)
	if err != nil {
		return nil, 0, err
	}
	body := map[string]any{"requestId": requestID.String(), "op": "revoke"}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopePassengerRevoke, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestPassengerView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	now := s.now()
	var view *RequestPassengerView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		revoked, err := s.deps.Store.RevokeLiveTripAccess(ctx, tx, requestID, "rider:"+actor.UserID.String(), TripAccessRevokedByRequester, now)
		if err != nil {
			return err
		}
		if revoked != nil {
			if err := s.writeRevokedEvent(ctx, tx, request, revoked, "rider", actor.UserID.String(), now); err != nil {
				return err
			}
			if err := writeAudit(ctx, tx, AuditRecord{
				ActorID: actor.UserID.String(), ActorRole: actor.Role,
				Action: "mp.passenger.access_revoked", SubjectType: subjectRequest, SubjectID: requestID.String(),
				After:  map[string]any{"tripAccessId": revoked.ID.String(), "reason": TripAccessRevokedByRequester},
				Reason: "requester revoked the passenger's trip link",
			}); err != nil {
				return err
			}
		}
		latest, err := s.deps.Store.LatestTripAccessToken(ctx, tx, requestID)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		view = passengerViewOf(passenger, passengerPayerRole(request), latest, now)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopePassengerRevoke, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// ReissuePassengerAccess answers POST /v1/mp/requests/{id}/passenger/access/reissue:
// a fresh link (the old one revoked) sent to the same passenger while the
// trip is still ahead of them. New links are issued only while guest
// bookings are enabled here.
func (s *Service) ReissuePassengerAccess(ctx context.Context, actor Actor, requestID uuid.UUID, idempotencyKey string) (*RequestPassengerView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	request, passenger, err := s.passengerRequestFor(ctx, actor, requestID)
	if err != nil {
		return nil, 0, err
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceGuestBookings, actor, request.CityID); err != nil {
		return nil, 0, err
	}
	if s.deps.TripAccessSealer == nil {
		// Fail closed, before any replay or write: a new link cannot be sent
		// without the sealed-delivery key. Revoking stays available.
		return nil, 0, tripLinkDeliveryUnavailable()
	}
	body := map[string]any{"requestId": requestID.String(), "op": "reissue"}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopePassengerReissue, actor.UserID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view RequestPassengerView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	if passenger.DeclinedAt != nil {
		return nil, 0, domain.Errorf(domain.CodeConflict, "the passenger declined this trip").
			WithDetails(map[string]any{"reason": passengerDeclinedReason})
	}
	if ended, err := s.tripEnded(ctx, request); err != nil {
		return nil, 0, asDomainError(err)
	} else if ended {
		return nil, 0, domain.Errorf(domain.CodeRequestClosed, "this trip has ended; there is nothing to follow").
			WithDetails(map[string]any{"state": request.State})
	}
	now := s.now()
	var view *RequestPassengerView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		// Concurrent reissues serialise on the one-live-link index, so this
		// count cannot be raced past the bound.
		sent, err := s.deps.Store.CountTripAccessTokens(ctx, tx, requestID)
		if err != nil {
			return err
		}
		if sent >= tripAccessMaxLinks {
			return domain.Errorf(domain.CodeRateLimited,
				"this trip link has been sent %d times already; contact support if the passenger still cannot open it", sent).
				WithDetails(map[string]any{"reason": "trip_link_limit", "limit": tripAccessMaxLinks})
		}
		revoked, err := s.deps.Store.RevokeLiveTripAccess(ctx, tx, requestID, "rider:"+actor.UserID.String(), TripAccessReissued, now)
		if err != nil {
			return err
		}
		if revoked != nil {
			if err := s.writeRevokedEvent(ctx, tx, request, revoked, "rider", actor.UserID.String(), now); err != nil {
				return err
			}
		}
		token, err := s.issueTripAccess(ctx, tx, passenger, "rider", actor.UserID.String(), now)
		if err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID: actor.UserID.String(), ActorRole: actor.Role,
			Action: "mp.passenger.access_reissued", SubjectType: subjectRequest, SubjectID: requestID.String(),
			After:  map[string]any{"tripAccessId": token.ID.String(), "tripAccessExpiry": token.ExpiresAt.Format(time.RFC3339)},
			Reason: "requester sent the passenger a fresh trip link",
		}); err != nil {
			return err
		}
		view = passengerViewOf(passenger, passengerPayerRole(request), token, now)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopePassengerReissue, actor.UserID, idempotencyKey, body, 200, view)
	})
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

func (s *Service) writeRevokedEvent(ctx context.Context, tx pgx.Tx, request *Request, token *TripAccessToken, actorType, actorID string, now time.Time) error {
	return writeEvent(ctx, tx, Event{
		Name:           "trip_access.revoked",
		AggregateType:  subjectTripAccess,
		AggregateID:    token.ID.String(),
		ToVersion:      2,
		CityID:         request.CityID,
		ActorType:      actorType,
		ActorID:        actorID,
		IdempotencyKey: "trip_access.revoked:" + token.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"tokenId":   token.ID.String(),
			"requestId": request.ID.String(),
			"reason":    token.RevokeReason,
		},
	})
}

// tripEnded reports whether a request's trip is over (closed without an
// execution, or its execution terminal).
func (s *Service) tripEnded(ctx context.Context, request *Request) (bool, error) {
	switch request.State {
	case machine.MpRequestCancelled, machine.MpRequestExpired, machine.MpRequestNoOffers:
		return true, nil
	case machine.MpRequestExecution:
		award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID)
		if err != nil {
			return false, err
		}
		if award.State != machine.MpAwardConfirmed || award.ExecutionID == nil {
			return true, nil
		}
		ride, err := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *award.ExecutionID)
		if err != nil {
			return false, err
		}
		return !machine.IsRiderActive(ride.State), nil
	default:
		return false, nil
	}
}

// ---------------------------------------------------------------------------
// The passenger's side: token authentication, the trip view, the PIN and the
// free decline
// ---------------------------------------------------------------------------

// TripAccessSession is an authenticated token and the one trip it opens.
// Only AuthenticateTripAccess makes one.
type TripAccessSession struct {
	token     *TripAccessToken
	passenger *Passenger
	request   *Request
}

// Trip-link rate limits: per client address across every trip-link call
// (which also slows any scan for tokens) and per token. Plumbing, not
// policy; enforced in Redis, the house's burst limiter.
const (
	tripAccessClientLimit = 60
	tripAccessTokenLimit  = 30
	tripAccessRateWindow  = time.Minute
)

// tripAccessMaxLinks bounds how many trip links (the first plus reissues)
// one booking can ever send. Every link is an SMS to a phone the requester
// chose, so an unbounded reissue would let a requester make UBI message that
// number at will.
const tripAccessMaxLinks = 5

// LimitTripAccess refuses a trip-link call over its client or token budget
// with 429 rate_limited. It runs BEFORE the token is looked up, so a flood
// of forged tokens never reaches the database past its budget.
func (s *Service) LimitTripAccess(ctx context.Context, clientKey, raw string) error {
	limited := domain.Errorf(domain.CodeRateLimited, "too many requests for this trip link; try again shortly")
	if !s.deps.Redis.AllowRate(ctx, "mp:trip-access:client:"+clientKey, tripAccessClientLimit, tripAccessRateWindow) {
		return limited
	}
	if raw != "" && !s.deps.Redis.AllowRate(ctx, "mp:trip-access:token:"+hashTripAccessToken(raw)[:32], tripAccessTokenLimit, tripAccessRateWindow) {
		return limited
	}
	return nil
}

// Token refusal reasons (details.reason on 401).
const (
	TripAccessInvalid = "invalid"
	TripAccessExpired = "expired"
	TripAccessRevoked = "revoked"
)

func tripAccessRefused(reason string) *domain.Error {
	return domain.Errorf(domain.CodeUnauthorized, "this trip link is not valid").
		WithDetails(map[string]any{"reason": reason})
}

// AuthenticateTripAccess resolves a raw token to its trip, or refuses it:
// malformed or unknown (forged) → invalid; revoked → revoked; past its
// expiry → expired. It never says which trip a refused token was for.
func (s *Service) AuthenticateTripAccess(ctx context.Context, raw string) (*TripAccessSession, error) {
	if !wellFormedTripAccessToken(raw) {
		return nil, tripAccessRefused(TripAccessInvalid)
	}
	token, err := s.deps.Store.TripAccessTokenByHash(ctx, s.deps.Store.Pool(), hashTripAccessToken(raw))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, tripAccessRefused(TripAccessInvalid)
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	if token.Scope != TripAccessScopeGuestPassenger {
		return nil, tripAccessRefused(TripAccessInvalid)
	}
	if token.RevokedAt != nil {
		return nil, tripAccessRefused(TripAccessRevoked)
	}
	now := s.now()
	if !now.Before(token.ExpiresAt) {
		return nil, tripAccessRefused(TripAccessExpired)
	}
	passenger, err := s.deps.Store.PassengerForRequest(ctx, s.deps.Store.Pool(), token.RequestID)
	if err != nil {
		return nil, asDomainError(err)
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), token.RequestID)
	if err != nil {
		return nil, asDomainError(err)
	}
	if err := s.deps.Store.TouchTripAccessToken(ctx, s.deps.Store.Pool(), token.ID, now); err != nil {
		s.deps.Logger.Warn().Err(err).Str("trip_access_id", token.ID.String()).Msg("could not record the trip link's use")
	}
	return &TripAccessSession{token: token, passenger: passenger, request: request}, nil
}

// TripAccessView is the passenger's trip (MpTripAccessViewSchema): nothing
// about the requester, the money or any other trip.
type TripAccessView struct {
	Status             string                 `json:"status"`
	StatusLabel        string                 `json:"statusLabel"`
	Passenger          TripAccessPassenger    `json:"passenger"`
	Pickup             TripAccessPlace        `json:"pickup"`
	Dropoff            TripAccessPlace        `json:"dropoff"`
	Driver             *OfferDriverView       `json:"driver"`
	Eta                *TripAccessEta         `json:"eta"`
	PickupVerification TripAccessVerification `json:"pickupVerification"`
	Support            TripAccessSupport      `json:"support"`
	Actions            TripAccessActions      `json:"actions"`
	ExpiresAt          time.Time              `json:"expiresAt"`
	AsOf               time.Time              `json:"asOf"`
}

// TripAccessPassenger is who the link is for (their own first name).
type TripAccessPassenger struct {
	FirstName string `json:"firstName"`
}

// TripAccessPlace is a pickup or dropoff as the requester named it.
type TripAccessPlace struct {
	Label string `json:"label"`
}

// TripAccessEta is the driver's time to pickup, an ESTIMATE with its age.
type TripAccessEta struct {
	Label      string    `json:"label"`
	EtaSeconds *int64    `json:"etaSeconds"`
	Basis      string    `json:"basis"`
	AsOf       time.Time `json:"asOf"`
}

// TripAccessVerification says how pickup is verified and whether the PIN
// can be fetched now (GET /v1/mp/trip-access/pin).
type TripAccessVerification struct {
	Method       string `json:"method"`
	PinAvailable bool   `json:"pinAvailable"`
	Instructions string `json:"instructions"`
}

// TripAccessSupport is who to contact, from the market's configuration.
type TripAccessSupport struct {
	Reference       string  `json:"reference"`
	EmergencyNumber *string `json:"emergencyNumber"`
	Note            string  `json:"note"`
}

// TripAccessActions are the server-decided permitted actions.
type TripAccessActions struct {
	CanDecline    bool   `json:"canDecline"`
	DeclineIsFree bool   `json:"declineIsFree"`
	DeclineNote   string `json:"declineNote"`
}

// Passenger trip statuses.
const (
	TripStatusFindingDriver    = "finding_driver"
	TripStatusConfirmingDriver = "confirming_driver"
	TripStatusDriverQueued     = "driver_queued"
	TripStatusDriverOnTheWay   = "driver_on_the_way"
	TripStatusDriverArrived    = "driver_arrived"
	TripStatusInProgress       = "in_progress"
	TripStatusCompleted        = "completed"
	TripStatusCancelled        = "cancelled"
	TripStatusDeclined         = "declined"
)

// tripAccessState is what the passenger view and the decline both need.
type tripAccessState struct {
	status     string
	award      *Award
	ride       *ExecutionRide
	canDecline bool
}

// resolveTripAccessState reads where the trip stands.
func (s *Service) resolveTripAccessState(ctx context.Context, session *TripAccessSession) (*tripAccessState, error) {
	state := &tripAccessState{}
	request := session.request
	if session.passenger.DeclinedAt != nil {
		state.status = TripStatusDeclined
		return state, nil
	}
	switch request.State {
	case machine.MpRequestOpen:
		state.status, state.canDecline = TripStatusFindingDriver, true
		return state, nil
	case machine.MpRequestAwardPending:
		state.status = TripStatusConfirmingDriver
		return state, nil
	case machine.MpRequestCancelled, machine.MpRequestExpired, machine.MpRequestNoOffers:
		state.status = TripStatusCancelled
		return state, nil
	}
	award, err := s.deps.Store.LatestAwardForRequest(ctx, s.deps.Store.Pool(), request.ID)
	if err != nil {
		return nil, asDomainError(err)
	}
	state.award = award
	if award.State != machine.MpAwardConfirmed {
		state.status = TripStatusCancelled
		return state, nil
	}
	if award.ExecutionID == nil || (award.ExecutionService != ServiceRide && award.ExecutionService != "") {
		// Awarded and queued behind the driver's current trip.
		state.status, state.canDecline = TripStatusDriverQueued, true
		return state, nil
	}
	ride, err := s.deps.Store.ExecutionRideRow(ctx, s.deps.Store.Pool(), *award.ExecutionID)
	if err != nil {
		return nil, asDomainError(err)
	}
	state.ride = ride
	switch ride.State {
	case machine.RiderDriverAssigned:
		state.status, state.canDecline = TripStatusDriverOnTheWay, true
	case machine.RiderDriverArrived:
		state.status, state.canDecline = TripStatusDriverArrived, true
	case machine.RiderPinVerification:
		state.status = TripStatusDriverArrived
	case machine.RiderInProgress, machine.RiderSafetyHold:
		state.status = TripStatusInProgress
	case machine.RiderCompleted, machine.RiderPaymentPending, machine.RiderPaymentFailed, machine.RiderRated:
		state.status = TripStatusCompleted
	default:
		state.status = TripStatusCancelled
	}
	return state, nil
}

func tripStatusLabel(status, firstName string) string {
	switch status {
	case TripStatusFindingDriver:
		return "Finding a driver for you. No driver is confirmed yet."
	case TripStatusConfirmingDriver:
		return "A driver was chosen and is being confirmed."
	case TripStatusDriverQueued:
		return "Your driver is confirmed and finishing another trip before coming to you."
	case TripStatusDriverOnTheWay:
		return "Your driver is on the way."
	case TripStatusDriverArrived:
		return "Your driver has arrived at the pickup point."
	case TripStatusInProgress:
		return "Enjoy your trip, " + firstName + "."
	case TripStatusCompleted:
		return "This trip is complete."
	case TripStatusDeclined:
		return "You declined this trip. Nobody was charged."
	default:
		return "This trip is not going ahead."
	}
}

// TripAccessView answers GET /v1/mp/trip-access for an authenticated token.
func (s *Service) TripAccessView(ctx context.Context, session *TripAccessSession) (*TripAccessView, error) {
	state, err := s.resolveTripAccessState(ctx, session)
	if err != nil {
		return nil, err
	}
	return s.tripAccessViewOf(ctx, session, state), nil
}

func (s *Service) tripAccessViewOf(ctx context.Context, session *TripAccessSession, state *tripAccessState) *TripAccessView {
	now := s.now()
	request := session.request
	view := &TripAccessView{
		Status:      state.status,
		StatusLabel: tripStatusLabel(state.status, session.passenger.FirstName),
		Passenger:   TripAccessPassenger{FirstName: session.passenger.FirstName},
		Pickup:      TripAccessPlace{Label: request.Pickup.Label},
		Dropoff:     TripAccessPlace{Label: request.Dropoff.Label},
		Actions: TripAccessActions{
			CanDecline:    state.canDecline,
			DeclineIsFree: true,
			DeclineNote:   "Declining before pickup is free: nobody is charged and the driver's commission is returned.",
		},
		ExpiresAt: session.token.ExpiresAt,
		AsOf:      now,
	}
	var config *cityconfig.CityConfig
	if loaded, err := s.config(ctx, request.CityID); err == nil {
		config = loaded
	}
	view.Support = TripAccessSupport{
		Reference: "UBI-" + strings.ToUpper(strings.ReplaceAll(request.ID.String(), "-", "")[:8]),
		Note:      "For help with this trip, contact UBI support and quote this reference.",
	}
	if config != nil && config.EmergencyNumber != "" {
		number := config.EmergencyNumber
		view.Support.EmergencyNumber = &number
		view.Support.Note += " In an emergency call " + number + "."
	}
	method := PickupVerificationPin
	instructions := "When your driver arrives, tell them your pickup PIN. Never share it before then."
	if config != nil && !config.PinRequired {
		method = PickupVerificationFirstName
		instructions = "Your driver will confirm your first name before the trip starts."
	}
	view.PickupVerification = TripAccessVerification{
		Method:       method,
		PinAvailable: method == PickupVerificationPin && state.ride != nil && pinRelevant(state.ride.State),
		Instructions: instructions,
	}
	if state.award != nil && state.award.State == machine.MpAwardConfirmed {
		// A driver is committed: the ONE verified-card projection every
		// rider surface uses.
		driver := s.driverDisplayFor(ctx, state.award.DriverID, request.VehicleClass)
		view.Driver = &driver
	}
	if state.status == TripStatusDriverOnTheWay && state.award != nil {
		view.Eta = s.passengerEta(ctx, state.award.DriverID, request, now)
	}
	return view
}

// passengerEta estimates the driver's time to pickup from their ACTUAL last
// position, rounded up to the minute; unavailable rather than guessed.
func (s *Service) passengerEta(ctx context.Context, driverID uuid.UUID, request *Request, now time.Time) *TripAccessEta {
	eta := &TripAccessEta{Label: "Arrival estimate unavailable", Basis: "unavailable", AsOf: now}
	session, err := s.deps.Store.DriverSessionRow(ctx, s.deps.Store.Pool(), driverID)
	if err != nil || !session.HasLocation() {
		return eta
	}
	seconds, err := s.routeSeconds(ctx, *session.LastLat, *session.LastLng, request.Pickup.Lat, request.Pickup.Lng)
	if err != nil {
		return eta
	}
	minutes := (seconds + 59) / 60
	if minutes < 1 {
		minutes = 1
	}
	rounded := minutes * 60
	eta.EtaSeconds = &rounded
	eta.Basis = "routed_leg"
	if session.LastLocationAt != nil {
		eta.AsOf = *session.LastLocationAt
	}
	eta.Label = "About " + itoa(int(minutes)) + " min away"
	return eta
}

// TripAccessPinView is the guest passenger's pickup PIN
// (MpTripAccessPinSchema): the PIN, the state that makes it retrievable and
// its expiry — deliberately WITHOUT the execution ride id the requester's
// PinView carries. A trip link identifies nothing internal.
type TripAccessPinView struct {
	Pin       string    `json:"pin"`
	State     string    `json:"state"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// TripAccessPin answers GET /v1/mp/trip-access/pin: the pickup PIN, only
// while it is relevant, under the vault's own retrieval rate limit (shared
// with the requester's retrieval of the same PIN).
func (s *Service) TripAccessPin(ctx context.Context, session *TripAccessSession) (*TripAccessPinView, error) {
	if session.passenger.DeclinedAt != nil {
		return nil, domain.Errorf(domain.CodeConflict, "you declined this trip").
			WithDetails(map[string]any{"reason": passengerDeclinedReason})
	}
	pin, err := s.retrieveVaultPin(ctx, session.request.ID)
	if err != nil {
		return nil, err
	}
	return &TripAccessPinView{Pin: pin.Pin, State: pin.State, ExpiresAt: pin.ExpiresAt}, nil
}

// DeclineTrip answers POST /v1/mp/trip-access/decline: the passenger declines
// before pickup, free for everyone. An open request closes (every live bid's
// hold released); a queued award is cancelled with the driver's commission
// returned and the requester's funding released; an execution not yet at
// pickup ends in cancelled_by_rider with no fee, through the same unwind a
// driver cancellation uses (commission reversed, funding released, the claim
// freed). Once the passenger is aboard — or the PIN is being verified — it is
// refused. A replay (same key) answers the first result.
func (s *Service) DeclineTrip(ctx context.Context, session *TripAccessSession, idempotencyKey string) (*TripAccessView, int, error) {
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	body := map[string]any{"requestId": session.request.ID.String(), "op": "decline"}
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopeTripAccessDecline, session.token.ID, idempotencyKey, body)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay != nil {
		var view TripAccessView
		if err := decodeJSON(replay.Response, &view); err != nil {
			return nil, 0, asDomainError(err)
		}
		return &view, replay.StatusCode, nil
	}
	state, err := s.resolveTripAccessState(ctx, session)
	if err != nil {
		return nil, 0, err
	}
	if state.status == TripStatusDeclined {
		// Already declined (another key): the same outcome, nothing moves.
		return s.tripAccessViewOf(ctx, session, state), 200, nil
	}
	if state.status == TripStatusConfirmingDriver {
		return nil, 0, domain.Errorf(domain.CodeAwardUnresolved, "a driver is being confirmed; try again in a moment")
	}
	if !state.canDecline {
		return nil, 0, domain.Errorf(domain.CodeConflict, "this trip can no longer be declined").
			WithDetails(map[string]any{"reason": "past_pickup", "status": state.status})
	}

	actorID := "trip_access:" + session.token.ID.String()
	now := s.now()
	switch {
	case state.award == nil:
		err = s.declineOpenRequest(ctx, session, actorID, now)
	case state.ride == nil:
		err = s.declineQueuedAward(ctx, session, state.award, actorID, now)
	default:
		err = s.declineExecution(ctx, session, state.award, actorID, now)
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}

	passenger, err := s.deps.Store.PassengerForRequest(ctx, s.deps.Store.Pool(), session.request.ID)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	session.passenger = passenger
	final := &tripAccessState{status: TripStatusDeclined}
	view := s.tripAccessViewOf(ctx, session, final)
	if err := s.deps.Store.SaveIdempotent(ctx, s.deps.Store.Pool(), scopeTripAccessDecline, session.token.ID, idempotencyKey, body, 200, view); err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// markDeclined stamps the passenger's decline and publishes it (for the
// requester's notification) inside the caller's transaction. It reports
// false when the passenger had already declined.
func (s *Service) markDeclined(ctx context.Context, tx pgx.Tx, session *TripAccessSession, actorID string, now time.Time) (bool, error) {
	marked, err := s.deps.Store.MarkPassengerDeclined(ctx, tx, session.request.ID, now)
	if err != nil || !marked {
		return false, err
	}
	if err := writeEvent(ctx, tx, Event{
		Name:           "trip_access.declined",
		AggregateType:  subjectTripAccess,
		AggregateID:    session.token.ID.String(),
		ToVersion:      2,
		CityID:         session.request.CityID,
		ActorType:      "rider",
		ActorID:        actorID,
		IdempotencyKey: "trip_access.declined:" + session.request.ID.String(),
		OccurredAt:     now,
		Payload: map[string]any{
			"tokenId":     session.token.ID.String(),
			"requestId":   session.request.ID.String(),
			"requesterId": session.request.RequesterID.String(),
			"reason":      passengerDeclinedReason,
			"feeMinor":    0,
		},
	}); err != nil {
		return false, err
	}
	return true, writeAudit(ctx, tx, AuditRecord{
		ActorID: actorID, ActorRole: "guest_passenger",
		Action: "mp.passenger.declined", SubjectType: subjectRequest, SubjectID: session.request.ID.String(),
		After:  map[string]any{"reason": passengerDeclinedReason, "feeMinor": 0},
		Reason: "the passenger declined the trip before pickup through their trip link",
	})
}

// declineOpenRequest closes an open request on the passenger's decline.
func (s *Service) declineOpenRequest(ctx context.Context, session *TripAccessSession, actorID string, now time.Time) error {
	var releases []*Bid
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		request, err := s.deps.Store.RequestForUpdate(ctx, tx, session.request.ID)
		if err != nil {
			return err
		}
		if request.State != machine.MpRequestOpen {
			return domain.Errorf(domain.CodeConflict, "this trip changed while you were declining; look again").
				WithDetails(map[string]any{"state": request.State})
		}
		marked, err := s.markDeclined(ctx, tx, session, actorID, now)
		if err != nil || !marked {
			return err
		}
		reason := passengerDeclinedReason
		fromVersion := request.Version
		moved, err := s.deps.Store.TransitionRequest(ctx, tx, request, machine.MpRequestCancelled, RequestUpdate{CloseReason: &reason})
		if err != nil {
			return err
		}
		if releases, err = s.invalidateLiveBids(ctx, tx, moved, "request_cancelled", now); err != nil {
			return err
		}
		return writeEvent(ctx, tx, Event{
			Name:           "mp.request.closed",
			AggregateType:  subjectRequest,
			AggregateID:    request.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         request.CityID,
			ActorType:      "rider",
			ActorID:        actorID,
			IdempotencyKey: "mp.request.closed:" + request.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"requestId":       request.ID.String(),
				"requesterId":     request.RequesterID.String(),
				"reason":          reason,
				"invalidatedBids": len(releases),
			},
		})
	})
	if err != nil {
		return err
	}
	s.releaseBidReservations(ctx, releases)
	return nil
}

// declineQueuedAward cancels a confirmed, still-queued award on the
// passenger's decline: the driver's commission returned with a linked
// reversal and the requester's funding released.
func (s *Service) declineQueuedAward(ctx context.Context, session *TripAccessSession, award *Award, actorID string, now time.Time) error {
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return err
	}
	// The queued award's rider funding was authorized at selection and its
	// commission captured; the decline is free, so both come back. The two
	// money intents are written DURABLY inside the cancellation's
	// transaction (the driver-cancel unwind's own funnel), so a crash after
	// the commit still owes the reversal and the release to the sweep.
	unwind := &driverCancelUnwind{
		award: award, bid: bid, request: session.request,
		reverseRowID: uuid.New(), fundingRowID: uuid.New(),
		reason: passengerDeclinedReason, actorType: "rider", actorID: actorID,
	}
	if _, err := s.cancelQueuedAward(ctx, award, passengerDeclinedReason, actorID, "rider",
		func(tx pgx.Tx, _ *Request) error {
			if _, err := s.markDeclined(ctx, tx, session, actorID, now); err != nil {
				return err
			}
			// The award is cancelled in this transaction whatever the
			// passenger row said, so its money intents are always owed.
			return s.insertUnwindIntents(ctx, tx, unwind)
		}); err != nil {
		return err
	}
	// Re-drives the reversal cancelQueuedAward already attempted (same award
	// key: one linked entry) and the release, resolving the intents on a
	// confirmed answer.
	s.driveDriverCancelReversal(ctx, unwind, now)
	return nil
}

// declineExecution ends an execution ride that has not reached pickup:
// cancelled_by_rider with no fee, the driver freed, and the award unwound
// through the driver-cancel funnel with the passenger's reason. The claim is
// released (and any queued job promoted) by the shared terminal handling.
func (s *Service) declineExecution(ctx context.Context, session *TripAccessSession, award *Award, actorID string, now time.Time) error {
	bid, err := s.deps.Store.BidByID(ctx, s.deps.Store.Pool(), award.BidID)
	if err != nil {
		return err
	}
	unwind := &driverCancelUnwind{
		award: award, bid: bid, request: session.request,
		reverseRowID: uuid.New(), fundingRowID: uuid.New(),
		reason: passengerDeclinedReason, actorType: "rider", actorID: actorID,
	}
	mv := s.deps.Store.Move()
	unwound := false
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		ride, err := mv.RideForUpdate(ctx, tx, *award.ExecutionID)
		if err != nil {
			return err
		}
		if ride.State != machine.RiderDriverAssigned && ride.State != machine.RiderDriverArrived {
			return domain.Errorf(domain.CodeConflict, "this trip can no longer be declined").
				WithDetails(map[string]any{"reason": "past_pickup", "state": ride.State})
		}
		marked, err := s.markDeclined(ctx, tx, session, actorID, now)
		if err != nil || !marked {
			return err
		}
		role, code := move.RoleRider, passengerDeclinedReason
		fromVersion := ride.Version
		moved, err := mv.Transition(ctx, tx, ride, machine.RiderCancelledByRider, move.RideUpdate{
			CancelledAt: &now, CancelledByRole: &role, CancelReasonCode: &code,
		})
		if err != nil {
			return err
		}
		if ride.DriverID != nil {
			if err := freeDriverSession(ctx, tx, mv, *ride.DriverID); err != nil {
				return err
			}
		}
		if err := writeEvent(ctx, tx, Event{
			Name:           "ride.cancelled_by_rider",
			AggregateType:  "ride",
			AggregateID:    ride.ID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      moved.Version,
			CityID:         ride.CityID,
			ActorType:      "rider",
			ActorID:        actorID,
			IdempotencyKey: "ride.cancelled_by_rider:" + ride.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"rideId":   ride.ID.String(),
				"reason":   passengerDeclinedReason,
				"feeMinor": 0,
				"currency": ride.Currency,
				"awardId":  award.ID.String(),
			},
		}); err != nil {
			return err
		}
		applied, err := s.unwindDriverCancelledAward(ctx, tx, unwind, now)
		unwound = applied
		return err
	})
	if err != nil {
		return err
	}
	if unwound {
		s.driveDriverCancelReversal(ctx, unwind, now)
	}
	// The execution is terminal and committed: the claim is released (and a
	// queued job promoted) by the SAME terminal handling a move-core
	// cancellation triggers; the sweep converges anything this call misses.
	if err := s.handleExecutionTerminal(ctx, *award.ExecutionID); err != nil {
		s.deps.Logger.Warn().Err(err).Str("award_id", award.ID.String()).
			Msg("claim release after the passenger's decline deferred; the sweep will converge it")
	}
	return nil
}

// freeDriverSession walks the driver's session back to available through the
// driver machine's cancellation edge, exactly as the move core releases a
// driver when a rider cancels.
func freeDriverSession(ctx context.Context, tx pgx.Tx, mv *move.Store, driverID uuid.UUID) error {
	session, err := mv.SessionForUpdate(ctx, tx, driverID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if session.State == machine.DriverAvailable || session.State == machine.DriverOffline {
		return nil
	}
	if session, err = mv.TransitionDriver(ctx, tx, session, machine.DriverCancelled, move.SessionUpdate{}); err != nil {
		return err
	}
	_, err = mv.TransitionDriver(ctx, tx, session, machine.DriverAvailable, move.SessionUpdate{ClearRide: true})
	return err
}

// ---------------------------------------------------------------------------
// Store: mp.request_passengers and mp.trip_access_tokens
// ---------------------------------------------------------------------------

// InsertPassenger records a request's passenger inside the publishing
// transaction.
func (s *Store) InsertPassenger(ctx context.Context, tx pgx.Tx, p *Passenger) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO mp.request_passengers (
			request_id, requester_id, payer_id, city_id, first_name, last_name, phone_e164,
			attested_adult, attested_consent, attested_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		p.RequestID, p.RequesterID, p.PayerID, p.CityID, p.FirstName, nullable(p.LastName), p.Phone,
		p.AttestedAdult, p.AttestedConsent, p.AttestedAt, p.CreatedAt); err != nil {
		return err
	}
	return nil
}

const passengerColumns = `request_id, requester_id, payer_id, city_id, first_name, COALESCE(last_name, ''),
	phone_e164, attested_adult, attested_consent, attested_at, declined_at, created_at`

func scanPassenger(row pgx.Row) (*Passenger, error) {
	var p Passenger
	err := row.Scan(&p.RequestID, &p.RequesterID, &p.PayerID, &p.CityID, &p.FirstName, &p.LastName,
		&p.Phone, &p.AttestedAdult, &p.AttestedConsent, &p.AttestedAt, &p.DeclinedAt, &p.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// PassengerForRequest reads one request's passenger. It is keyed by the
// request id ONLY — there is deliberately no read by phone or by passenger.
func (s *Store) PassengerForRequest(ctx context.Context, db DB, requestID uuid.UUID) (*Passenger, error) {
	return scanPassenger(db.QueryRow(ctx, `SELECT `+passengerColumns+` FROM mp.request_passengers WHERE request_id = $1`, requestID))
}

// MarkPassengerDeclined stamps the decline once; false when already stamped.
func (s *Store) MarkPassengerDeclined(ctx context.Context, tx pgx.Tx, requestID uuid.UUID, now time.Time) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE mp.request_passengers SET declined_at = $2
		WHERE request_id = $1 AND declined_at IS NULL`, requestID, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

const tripAccessColumns = `id, request_id, scope, expires_at, revoked_at, COALESCE(revoked_by, ''),
	COALESCE(revoke_reason, ''), last_used_at, created_at`

func scanTripAccessToken(row pgx.Row) (*TripAccessToken, error) {
	var t TripAccessToken
	err := row.Scan(&t.ID, &t.RequestID, &t.Scope, &t.ExpiresAt, &t.RevokedAt, &t.RevokedBy,
		&t.RevokeReason, &t.LastUsedAt, &t.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

// InsertTripAccessToken stores a token by its hash. The partial unique index
// refuses a second live token for the request.
func (s *Store) InsertTripAccessToken(ctx context.Context, tx pgx.Tx, t *TripAccessToken, hash string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO mp.trip_access_tokens (id, request_id, token_hash, scope, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		t.ID, t.RequestID, hash, t.Scope, t.ExpiresAt, t.CreatedAt)
	if isUniqueViolation(err, "trip_access_tokens_one_live_per_request") {
		return domain.Errorf(domain.CodeConflict, "another trip link was issued for this trip at the same time; look again")
	}
	return err
}

// TripAccessTokenByHash resolves a presented token.
func (s *Store) TripAccessTokenByHash(ctx context.Context, db DB, hash string) (*TripAccessToken, error) {
	return scanTripAccessToken(db.QueryRow(ctx, `SELECT `+tripAccessColumns+` FROM mp.trip_access_tokens WHERE token_hash = $1`, hash))
}

// LatestTripAccessToken reads a request's current token: the live one when
// there is one (at most one exists), otherwise the most recent.
func (s *Store) LatestTripAccessToken(ctx context.Context, db DB, requestID uuid.UUID) (*TripAccessToken, error) {
	return scanTripAccessToken(db.QueryRow(ctx, `
		SELECT `+tripAccessColumns+` FROM mp.trip_access_tokens
		WHERE request_id = $1 ORDER BY (revoked_at IS NULL) DESC, created_at DESC, id DESC LIMIT 1`, requestID))
}

// RevokeLiveTripAccess revokes the request's live token, returning it (nil
// when there was none to revoke).
func (s *Store) RevokeLiveTripAccess(ctx context.Context, tx pgx.Tx, requestID uuid.UUID, by, reason string, now time.Time) (*TripAccessToken, error) {
	token, err := scanTripAccessToken(tx.QueryRow(ctx, `
		UPDATE mp.trip_access_tokens SET revoked_at = $2, revoked_by = $3, revoke_reason = $4
		WHERE request_id = $1 AND revoked_at IS NULL
		RETURNING `+tripAccessColumns, requestID, now, by, reason))
	if errors.Is(err, domain.ErrNotFound) {
		return nil, nil
	}
	return token, err
}

// CountTripAccessTokens counts every link ever issued for a request.
func (s *Store) CountTripAccessTokens(ctx context.Context, db DB, requestID uuid.UUID) (int, error) {
	var count int
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM mp.trip_access_tokens WHERE request_id = $1`, requestID).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// TouchTripAccessToken records a token's latest use.
func (s *Store) TouchTripAccessToken(ctx context.Context, db DB, tokenID uuid.UUID, now time.Time) error {
	_, err := db.Exec(ctx, `UPDATE mp.trip_access_tokens SET last_used_at = $2 WHERE id = $1`, tokenID, now)
	return err
}
