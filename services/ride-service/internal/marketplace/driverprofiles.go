package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Verified driver profiles (A06 part A) — the ride-service port onto
// user-service's privacy-limited read model:
//
//	GET {USER_SERVICE_URL}/internal/driver-profiles?ids=<uuid>,<uuid>,…
//	x-service-name: ride-service
//	x-service-key:  DRIVER_PROFILE_RIDE_SERVICE_KEY
//
// The contract is DriverProfilesResponseSchema in
// packages/contracts/src/driver-profile.ts, and this client holds user-service
// to it strictly: every object must carry exactly its documented keys, every
// enum and bound is checked, and the answer must resolve exactly the ids that
// were asked for. A malformed answer is refused as a whole — a card that does
// not match the contract is never half-trusted.
//
// Nothing here may block an offer. When user-service is unconfigured, down,
// slow or malformed, the port answers ErrDriverProfilesUnavailable and every
// affected driver renders "details unavailable" — the offer itself is served
// exactly as before. Nothing is fabricated to fill the gap: no rating, no
// trip count, no name.

// ErrDriverProfilesUnavailable means no verified profile could be resolved
// for (some of) the asked drivers: unconfigured, unreachable, timed out,
// refused or malformed.
var ErrDriverProfilesUnavailable = errors.New("driver profiles unavailable")

// DriverProfileBatchMax mirrors DRIVER_PROFILE_BATCH_MAX: at most this many
// ids per call. Larger sets are chunked.
const DriverProfileBatchMax = 50

// The contract's verification statuses (DRIVER_VERIFICATION_STATUSES).
const (
	DriverVerificationVerified      = "verified"
	DriverVerificationPendingReview = "pending_review"
	DriverVerificationNotCurrent    = "not_current"
)

// driverVehicleTypes mirrors DRIVER_VEHICLE_TYPES: the registered body type.
var driverVehicleTypes = map[string]struct{}{
	"sedan": {}, "suv": {}, "van": {}, "motorcycle": {}, "electric": {},
}

var (
	isoDatePattern  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	isoMonthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
)

// DriverProfile is one resolved card. Available=false is user-service's
// deliberate non-disclosure: an unknown id, a non-driver and a suspended or
// not-yet-active driver all look the same, and nothing else is known.
type DriverProfile struct {
	DriverID       uuid.UUID
	Available      bool
	DisplayName    *string
	Initials       *string
	Photo          *DriverProfilePhoto
	Verification   DriverProfileVerification
	Vehicle        *DriverProfileVehicle
	Rating         *DriverProfileRating
	CompletedTrips int
	MemberSince    string
	// AccessibilityStatus is user-service's verified accessibility capability.
	// The contract admits only "unavailable" today: there is no verified
	// vehicle-capability source, so nothing may claim accessible supply.
	AccessibilityStatus string
}

// DriverProfilePhoto is the photo reference and whether it was checked.
type DriverProfilePhoto struct {
	Ref      string `json:"ref"`
	Verified bool   `json:"verified"`
}

// DriverProfileVerification is where the driver's checks stand.
type DriverProfileVerification struct {
	Status     string  `json:"status"`
	VerifiedAt *string `json:"verifiedAt"`
}

// DriverProfileVehicle is the registered vehicle, plate masked.
type DriverProfileVehicle struct {
	Make        *string `json:"make"`
	Model       *string `json:"model"`
	Colour      *string `json:"colour"`
	Type        string  `json:"type"`
	PlateMasked string  `json:"plateMasked"`
}

// DriverProfileRating is the real rating: the mean of completed trips'
// ratings and how many carry one — exactly as user-service computed them.
type DriverProfileRating struct {
	Average float64 `json:"average"`
	Count   int     `json:"count"`
}

// Verified reports whether a consumer may present this card as verified:
// only an available card whose verification status is "verified".
func (p *DriverProfile) Verified() bool {
	return p != nil && p.Available && p.Verification.Status == DriverVerificationVerified
}

// DriverProfilePort resolves verified driver cards by driver USER id (the id
// ride-service stores on bids, awards and claims).
type DriverProfilePort interface {
	// Profiles answers one entry per id it could resolve. A non-nil error
	// means some (or all) ids could not be resolved; the map still carries
	// what is known, and callers render the rest as unavailable.
	Profiles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*DriverProfile, error)
}

// unconfiguredDriverProfiles is the port when no user-service is wired: it
// resolves nothing, honestly.
type unconfiguredDriverProfiles struct{}

func (unconfiguredDriverProfiles) Profiles(context.Context, []uuid.UUID) (map[uuid.UUID]*DriverProfile, error) {
	return map[uuid.UUID]*DriverProfile{}, fmt.Errorf("%w: no user-service is configured", ErrDriverProfilesUnavailable)
}

// DriverProfilesOptions tunes the HTTP port. Zero values take the defaults.
type DriverProfilesOptions struct {
	// Client is the HTTP client; its Timeout bounds one call. Default: a
	// client with a 1.5 s timeout, so a hanging user-service costs an offer
	// view at most that long.
	Client *http.Client
	// TTL is how long a resolved card is reused. Default 60 s: short enough
	// that a suspension or a new rating shows within a minute.
	TTL time.Duration
	// Backoff is how long the port stops calling after a failed call.
	// Default 5 s; a negative value disables it.
	Backoff time.Duration
	// Now is injectable for cache tests.
	Now func() time.Time
}

const (
	defaultProfileTimeout = 1500 * time.Millisecond
	defaultProfileTTL     = 60 * time.Second
	defaultProfileBackoff = 5 * time.Second
	// maxProfileBodyBytes bounds one answer: 50 cards are a few kilobytes.
	maxProfileBodyBytes = 1 << 20
	// maxProfileCacheEntries bounds the cache; past it, expired entries are
	// dropped and, if still full, the cache starts over.
	maxProfileCacheEntries = 10_000
	// profileServiceName is this service's caller name on the endpoint.
	profileServiceName = "ride-service"
)

type cachedProfile struct {
	profile *DriverProfile
	expires time.Time
}

// HTTPDriverProfiles is the user-service client: batch, strict, cached.
type HTTPDriverProfiles struct {
	baseURL    string
	serviceKey string
	client     *http.Client
	ttl        time.Duration
	backoff    time.Duration
	now        func() time.Time

	mu        sync.Mutex
	cache     map[uuid.UUID]cachedProfile
	downUntil time.Time
}

// NewHTTPDriverProfiles builds the port. `baseURL` is USER_SERVICE_URL and
// `serviceKey` is DRIVER_PROFILE_RIDE_SERVICE_KEY; with either empty the
// port resolves nothing (every driver renders "details unavailable").
func NewHTTPDriverProfiles(baseURL, serviceKey string, options DriverProfilesOptions) DriverProfilePort {
	if strings.TrimSpace(baseURL) == "" || strings.TrimSpace(serviceKey) == "" {
		return unconfiguredDriverProfiles{}
	}
	port := &HTTPDriverProfiles{
		baseURL:    strings.TrimRight(baseURL, "/"),
		serviceKey: serviceKey,
		client:     options.Client,
		ttl:        options.TTL,
		backoff:    options.Backoff,
		now:        options.Now,
		cache:      map[uuid.UUID]cachedProfile{},
	}
	if port.client == nil {
		port.client = &http.Client{Timeout: defaultProfileTimeout}
	}
	if port.ttl <= 0 {
		port.ttl = defaultProfileTTL
	}
	if port.backoff == 0 {
		port.backoff = defaultProfileBackoff
	}
	if port.now == nil {
		port.now = func() time.Time { return time.Now().UTC() }
	}
	return port
}

// Profiles implements DriverProfilePort.
func (p *HTTPDriverProfiles) Profiles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*DriverProfile, error) {
	out := make(map[uuid.UUID]*DriverProfile, len(ids))
	now := p.now()
	var missing []uuid.UUID
	seen := map[uuid.UUID]bool{}

	p.mu.Lock()
	for _, id := range ids {
		if seen[id] || id == uuid.Nil {
			continue
		}
		seen[id] = true
		if entry, ok := p.cache[id]; ok && now.Before(entry.expires) {
			out[id] = entry.profile
			continue
		}
		missing = append(missing, id)
	}
	down := now.Before(p.downUntil)
	p.mu.Unlock()

	if len(missing) == 0 {
		return out, nil
	}
	if down {
		return out, fmt.Errorf("%w: backing off after a failed call", ErrDriverProfilesUnavailable)
	}

	var firstErr error
	for start := 0; start < len(missing); start += DriverProfileBatchMax {
		end := start + DriverProfileBatchMax
		if end > len(missing) {
			end = len(missing)
		}
		resolved, err := p.fetch(ctx, missing[start:end])
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			p.mu.Lock()
			if p.backoff > 0 {
				p.downUntil = p.now().Add(p.backoff)
			}
			p.mu.Unlock()
			break
		}
		p.mu.Lock()
		if len(p.cache)+len(resolved) > maxProfileCacheEntries {
			p.evictExpiredLocked(now)
		}
		for id, profile := range resolved {
			out[id] = profile
			p.cache[id] = cachedProfile{profile: profile, expires: now.Add(p.ttl)}
		}
		p.mu.Unlock()
	}
	return out, firstErr
}

func (p *HTTPDriverProfiles) evictExpiredLocked(now time.Time) {
	for id, entry := range p.cache {
		if !now.Before(entry.expires) {
			delete(p.cache, id)
		}
	}
	if len(p.cache) >= maxProfileCacheEntries {
		p.cache = map[uuid.UUID]cachedProfile{}
	}
}

// fetch performs one batch call and validates the whole answer.
func (p *HTTPDriverProfiles) fetch(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*DriverProfile, error) {
	values := make([]string, 0, len(ids))
	for _, id := range ids {
		values = append(values, id.String())
	}
	endpoint := p.baseURL + "/internal/driver-profiles?ids=" + url.QueryEscape(strings.Join(values, ","))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDriverProfilesUnavailable, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("x-service-name", profileServiceName)
	request.Header.Set("x-service-key", p.serviceKey)

	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDriverProfilesUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxProfileBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: reading the answer: %v", ErrDriverProfilesUnavailable, err)
	}
	if len(body) > maxProfileBodyBytes {
		return nil, fmt.Errorf("%w: the answer is larger than %d bytes", ErrDriverProfilesUnavailable, maxProfileBodyBytes)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: user-service answered %d", ErrDriverProfilesUnavailable, response.StatusCode)
	}
	profiles, err := parseDriverProfiles(body, ids)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDriverProfilesUnavailable, err)
	}
	return profiles, nil
}

// ---------------------------------------------------------------------------
// Strict decoding of DriverProfilesResponseSchema
// ---------------------------------------------------------------------------

// exactObject decodes a JSON object and insists on exactly these keys: a
// missing key (the contract's nullable fields are required-but-nullable) and
// an unknown key are both malformed.
func exactObject(raw json.RawMessage, path string, keys ...string) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, fmt.Errorf("%s is not an object", path)
	}
	want := map[string]bool{}
	for _, key := range keys {
		want[key] = true
		if _, ok := object[key]; !ok {
			return nil, fmt.Errorf("%s is missing %q", path, key)
		}
	}
	var unknown []string
	for key := range object {
		if !want[key] {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, fmt.Errorf("%s carries unknown keys %v", path, unknown)
	}
	return object, nil
}

func isNull(raw json.RawMessage) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}

// nonEmptyString decodes a required non-empty string.
func nonEmptyString(raw json.RawMessage, path string) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || value == "" {
		return "", fmt.Errorf("%s must be a non-empty string", path)
	}
	return value, nil
}

// nullableString decodes null or a non-empty string.
func nullableString(raw json.RawMessage, path string) (*string, error) {
	if isNull(raw) {
		return nil, nil
	}
	value, err := nonEmptyString(raw, path)
	if err != nil {
		return nil, fmt.Errorf("%s must be null or a non-empty string", path)
	}
	return &value, nil
}

// integer decodes a JSON number that is a whole number.
func integer(raw json.RawMessage, path string) (int, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var number json.Number
	if err := decoder.Decode(&number); err != nil {
		return 0, fmt.Errorf("%s must be an integer", path)
	}
	value, err := number.Int64()
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", path)
	}
	return int(value), nil
}

func parseDriverProfiles(body []byte, asked []uuid.UUID) (map[uuid.UUID]*DriverProfile, error) {
	envelope, err := exactObject(body, "response", "success", "data")
	if err != nil {
		return nil, err
	}
	var success bool
	if err := json.Unmarshal(envelope["success"], &success); err != nil || !success {
		return nil, errors.New("response.success must be true")
	}
	data, err := exactObject(envelope["data"], "data", "profiles")
	if err != nil {
		return nil, err
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(data["profiles"], &entries); err != nil || entries == nil {
		return nil, errors.New("data.profiles must be an array")
	}
	if len(entries) > DriverProfileBatchMax {
		return nil, fmt.Errorf("data.profiles carries %d entries; at most %d", len(entries), DriverProfileBatchMax)
	}

	wanted := map[uuid.UUID]bool{}
	for _, id := range asked {
		wanted[id] = true
	}
	out := make(map[uuid.UUID]*DriverProfile, len(entries))
	for index, entry := range entries {
		path := fmt.Sprintf("data.profiles[%d]", index)
		profile, err := parseDriverProfile(entry, path)
		if err != nil {
			return nil, err
		}
		if !wanted[profile.DriverID] {
			return nil, fmt.Errorf("%s resolves a driver that was not asked for", path)
		}
		if _, dup := out[profile.DriverID]; dup {
			return nil, fmt.Errorf("%s resolves a driver twice", path)
		}
		out[profile.DriverID] = profile
	}
	if len(out) != len(wanted) {
		return nil, fmt.Errorf("data.profiles resolves %d of the %d drivers asked for", len(out), len(wanted))
	}
	return out, nil
}

func parseDriverProfile(raw json.RawMessage, path string) (*DriverProfile, error) {
	var head struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, fmt.Errorf("%s is not an object", path)
	}
	switch head.Status {
	case "unavailable":
		object, err := exactObject(raw, path, "driverId", "status")
		if err != nil {
			return nil, err
		}
		id, err := parseDriverID(object["driverId"], path)
		if err != nil {
			return nil, err
		}
		return &DriverProfile{DriverID: id, Available: false}, nil
	case "available":
		return parseAvailableProfile(raw, path)
	default:
		return nil, fmt.Errorf("%s.status must be available or unavailable", path)
	}
}

func parseDriverID(raw json.RawMessage, path string) (uuid.UUID, error) {
	value, err := nonEmptyString(raw, path+".driverId")
	if err != nil {
		return uuid.Nil, err
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s.driverId must be a uuid", path)
	}
	return id, nil
}

func parseAvailableProfile(raw json.RawMessage, path string) (*DriverProfile, error) {
	object, err := exactObject(raw, path,
		"driverId", "status", "displayName", "initials", "photo", "verification",
		"vehicle", "rating", "completedTrips", "memberSince", "accessibility")
	if err != nil {
		return nil, err
	}
	profile := &DriverProfile{Available: true}
	if profile.DriverID, err = parseDriverID(object["driverId"], path); err != nil {
		return nil, err
	}
	if profile.DisplayName, err = nullableString(object["displayName"], path+".displayName"); err != nil {
		return nil, err
	}
	if profile.Initials, err = nullableString(object["initials"], path+".initials"); err != nil {
		return nil, err
	}

	if !isNull(object["photo"]) {
		photo, err := exactObject(object["photo"], path+".photo", "ref", "verified")
		if err != nil {
			return nil, err
		}
		ref, err := nonEmptyString(photo["ref"], path+".photo.ref")
		if err != nil {
			return nil, err
		}
		var verified bool
		if err := json.Unmarshal(photo["verified"], &verified); err != nil {
			return nil, fmt.Errorf("%s.photo.verified must be a boolean", path)
		}
		profile.Photo = &DriverProfilePhoto{Ref: ref, Verified: verified}
	}

	verification, err := exactObject(object["verification"], path+".verification", "status", "verifiedAt")
	if err != nil {
		return nil, err
	}
	status, err := nonEmptyString(verification["status"], path+".verification.status")
	if err != nil {
		return nil, err
	}
	switch status {
	case DriverVerificationVerified, DriverVerificationPendingReview, DriverVerificationNotCurrent:
	default:
		return nil, fmt.Errorf("%s.verification.status %q is not a contract status", path, status)
	}
	profile.Verification.Status = status
	if profile.Verification.VerifiedAt, err = nullableString(verification["verifiedAt"], path+".verification.verifiedAt"); err != nil {
		return nil, err
	}
	if at := profile.Verification.VerifiedAt; at != nil && !isoDatePattern.MatchString(*at) {
		return nil, fmt.Errorf("%s.verification.verifiedAt must be YYYY-MM-DD", path)
	}

	if !isNull(object["vehicle"]) {
		vehicle, err := exactObject(object["vehicle"], path+".vehicle", "make", "model", "colour", "type", "plateMasked")
		if err != nil {
			return nil, err
		}
		parsed := &DriverProfileVehicle{}
		if parsed.Make, err = nullableString(vehicle["make"], path+".vehicle.make"); err != nil {
			return nil, err
		}
		if parsed.Model, err = nullableString(vehicle["model"], path+".vehicle.model"); err != nil {
			return nil, err
		}
		if parsed.Colour, err = nullableString(vehicle["colour"], path+".vehicle.colour"); err != nil {
			return nil, err
		}
		if parsed.Type, err = nonEmptyString(vehicle["type"], path+".vehicle.type"); err != nil {
			return nil, err
		}
		if _, ok := driverVehicleTypes[parsed.Type]; !ok {
			return nil, fmt.Errorf("%s.vehicle.type %q is not a contract vehicle type", path, parsed.Type)
		}
		if parsed.PlateMasked, err = nonEmptyString(vehicle["plateMasked"], path+".vehicle.plateMasked"); err != nil {
			return nil, err
		}
		profile.Vehicle = parsed
	}

	if !isNull(object["rating"]) {
		rating, err := exactObject(object["rating"], path+".rating", "average", "count")
		if err != nil {
			return nil, err
		}
		var average float64
		if err := json.Unmarshal(rating["average"], &average); err != nil || average < 1 || average > 5 {
			return nil, fmt.Errorf("%s.rating.average must be a number from 1 to 5", path)
		}
		count, err := integer(rating["count"], path+".rating.count")
		if err != nil {
			return nil, err
		}
		if count <= 0 {
			return nil, fmt.Errorf("%s.rating.count must be positive (no ratings is rating: null)", path)
		}
		profile.Rating = &DriverProfileRating{Average: average, Count: count}
	}

	if profile.CompletedTrips, err = integer(object["completedTrips"], path+".completedTrips"); err != nil {
		return nil, err
	}
	if profile.CompletedTrips < 0 {
		return nil, fmt.Errorf("%s.completedTrips must not be negative", path)
	}
	if profile.MemberSince, err = nonEmptyString(object["memberSince"], path+".memberSince"); err != nil {
		return nil, err
	}
	if !isoMonthPattern.MatchString(profile.MemberSince) {
		return nil, fmt.Errorf("%s.memberSince must be YYYY-MM", path)
	}

	accessibility, err := exactObject(object["accessibility"], path+".accessibility", "status")
	if err != nil {
		return nil, err
	}
	accessibilityStatus, err := nonEmptyString(accessibility["status"], path+".accessibility.status")
	if err != nil {
		return nil, err
	}
	if accessibilityStatus != AccessibilityUnavailable {
		// The contract admits no verified accessibility capability yet; a
		// card claiming one is ahead of the contract and is not trusted.
		return nil, fmt.Errorf("%s.accessibility.status %q is not a contract status", path, accessibilityStatus)
	}
	profile.AccessibilityStatus = accessibilityStatus
	return profile, nil
}

// driverProfilesFor resolves the cards behind a set of drivers for a rider
// projection. It never fails: what cannot be resolved is simply absent (and
// renders "details unavailable"); the reason is logged, not surfaced.
func (s *Service) driverProfilesFor(ctx context.Context, ids []uuid.UUID) map[uuid.UUID]*DriverProfile {
	if len(ids) == 0 {
		return map[uuid.UUID]*DriverProfile{}
	}
	port := s.deps.DriverProfiles
	if port == nil {
		port = unconfiguredDriverProfiles{}
	}
	profiles, err := port.Profiles(ctx, ids)
	if err != nil && !errors.Is(err, ErrDriverProfilesUnavailable) {
		err = fmt.Errorf("%w: %v", ErrDriverProfilesUnavailable, err)
	}
	if err != nil {
		s.deps.Logger.Warn().Err(err).Int("drivers", len(ids)).Msg("verified driver details unavailable; offers are served without them")
	}
	if profiles == nil {
		profiles = map[uuid.UUID]*DriverProfile{}
	}
	return profiles
}
