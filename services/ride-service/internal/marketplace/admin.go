package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// AdminRequestRow is one line of the marketplace monitor (A01).
type AdminRequestRow struct {
	RequestID  string             `json:"requestId"`
	State      string             `json:"state"`
	Service    string             `json:"service"`
	CityID     string             `json:"cityId"`
	AskedMinor Money              `json:"askedMinor"`
	Bids       int                `json:"bids"`
	Reach      int                `json:"reach"`
	Envelope   SearchEnvelopeView `json:"envelope"`
}

// AdminRequestsPage answers GET /v1/admin/mp/requests.
type AdminRequestsPage struct {
	Rows       []*AdminRequestRow `json:"rows"`
	NextCursor *string            `json:"nextCursor"`
}

// AdminRequests is the monitor: read-only rows for operators. Admin role
// only; there are no mutation endpoints on this surface.
func (s *Service) AdminRequests(ctx context.Context, actor Actor, cityID, state, cursor string) (*AdminRequestsPage, error) {
	if actor.Role != move.RoleAdmin {
		return nil, domain.Errorf(domain.CodeForbidden, "only an operator can read the marketplace monitor")
	}

	query := `
		SELECT ` + requestColumns + `
		FROM mp.requests
		WHERE ($1 = '' OR city_id = $1) AND ($2 = '' OR state = $2)`
	args := []any{cityID, state}
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return nil, domain.Errorf(domain.CodeValidationFailed, "that is not a monitor cursor")
		}
		query += ` AND (created_at, id) < ($3, $4)`
		args = append(args, at, id)
	}
	query += fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT %d`, feedPageSize)

	rows, err := s.deps.Store.Pool().Query(ctx, query, args...)
	if err != nil {
		return nil, asDomainError(err)
	}
	defer rows.Close()

	var requests []*Request
	for rows.Next() {
		request, err := scanRequest(rows)
		if err != nil {
			return nil, asDomainError(err)
		}
		requests = append(requests, request)
	}
	if err := rows.Err(); err != nil {
		return nil, asDomainError(err)
	}

	page := &AdminRequestsPage{Rows: []*AdminRequestRow{}}
	for _, request := range requests {
		var total, live int
		if err := s.deps.Store.Pool().QueryRow(ctx,
			`SELECT COUNT(*) FROM mp.bids WHERE request_id = $1`, request.ID).Scan(&total); err != nil {
			return nil, asDomainError(err)
		}
		live, err := s.deps.Store.LiveBidCountForRequest(ctx, s.deps.Store.Pool(), request.ID)
		if err != nil {
			return nil, asDomainError(err)
		}
		page.Rows = append(page.Rows, &AdminRequestRow{
			RequestID:  request.ID.String(),
			State:      request.State,
			Service:    request.Service,
			CityID:     request.CityID,
			AskedMinor: money(request.RequestedMinor, request.Currency),
			Bids:       live,
			Reach:      total,
			Envelope: SearchEnvelopeView{
				Step:         request.EnvelopeStep,
				RadiusMeters: request.EnvelopeRadiusM,
				PickupEtaSec: request.EnvelopeEtaSec,
			},
		})
	}
	if len(requests) == feedPageSize {
		last := requests[len(requests)-1]
		next := encodeCursor(last.CreatedAt, last.ID)
		page.NextCursor = &next
	}
	return page, nil
}

// TimelineEvent is one appended line of a request's history.
type TimelineEvent struct {
	At     time.Time `json:"at"`
	Type   string    `json:"type"`
	Detail string    `json:"detail"`
}

// AdminTimeline answers GET /v1/admin/mp/requests/{id}/timeline: the
// append-only story of one request, read straight from the outbox and audit
// rows the transactions wrote. Nothing here mutates anything.
type AdminTimeline struct {
	RequestID     string           `json:"requestId"`
	PolicyVersion int              `json:"policyVersion"`
	Events        []*TimelineEvent `json:"events"`
}

// AdminRequestTimeline builds the timeline for one request.
func (s *Service) AdminRequestTimeline(ctx context.Context, actor Actor, requestID uuid.UUID) (*AdminTimeline, error) {
	if actor.Role != move.RoleAdmin {
		return nil, domain.Errorf(domain.CodeForbidden, "only an operator can read the marketplace timeline")
	}
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}

	events, err := s.outboxTimelineEvents(ctx, requestID)
	if err != nil {
		return nil, err
	}
	return &AdminTimeline{
		RequestID:     request.ID.String(),
		PolicyVersion: request.PolicyVersion,
		Events:        events,
	}, nil
}

// outboxTimelineEvents reads the append-only outbox history for one request
// — the shared read behind both the plain per-request timeline (A02) and the
// unified resolution view (C08): its mp.* rows, the trip_access.* rows of its
// guest passenger's link, the business_booking.* rows of its organization-
// budget funding, and the ride.* rows of its execution rides (the awards'
// execution ids). Every detail is REDACTED server-side (redactTimelineDetail):
// an operator never reads a sealed envelope, SMS copy, coordinates, a raw
// token or a phone number, whatever a payload carries.
func (s *Service) outboxTimelineEvents(ctx context.Context, requestID uuid.UUID) ([]*TimelineEvent, error) {
	rows, err := s.deps.Store.Pool().Query(ctx, `
		WITH awards AS (SELECT id, execution_id FROM mp.awards WHERE request_id = $1)
		SELECT name, occurred_at, payload
		FROM public.outbox_events
		WHERE ((name LIKE 'mp.%' OR name LIKE 'trip_access.%' OR name LIKE 'business_booking.%')
				AND (aggregate_id = $2 OR payload->>'requestId' = $2
					OR aggregate_id IN (SELECT id::text FROM awards)))
			OR (name LIKE 'ride.%'
				AND aggregate_id IN (SELECT execution_id::text FROM awards WHERE execution_id IS NOT NULL))
		ORDER BY occurred_at ASC, id ASC`, requestID, requestID.String())
	if err != nil {
		return nil, asDomainError(err)
	}
	defer rows.Close()

	events := []*TimelineEvent{}
	for rows.Next() {
		var name string
		var at time.Time
		var payload []byte
		if err := rows.Scan(&name, &at, &payload); err != nil {
			return nil, asDomainError(err)
		}
		events = append(events, &TimelineEvent{At: at, Type: name, Detail: redactTimelineDetail(payload)})
	}
	if err := rows.Err(); err != nil {
		return nil, asDomainError(err)
	}
	return events, nil
}

// Timeline redaction: keys whose VALUE an operator never reads, whatever
// its type — the trip link's sealed envelope and SMS copy, coordinates and
// location-bearing structures, raw tokens and PINs, phones and names.
// Matched case-insensitively; ids (tokenId, requesterId, …) stay.
var timelineRedactedKeys = map[string]bool{
	"sealed": true, "envelope": true, "ciphertext": true, "smscopy": true, "recipient": true,
	"lat": true, "lng": true, "lon": true, "latitude": true, "longitude": true, "location": true,
	"coordinates": true, "geometry": true, "polyline": true, "position": true, "pickup": true,
	"dropoff": true, "stops": true, "origin": true, "destination": true, "address": true,
	"token": true, "rawtoken": true, "accesstoken": true, "triptoken": true, "tripaccesstoken": true,
	"tokenhash": true, "pin": true, "pickuppin": true, "pinhash": true, "secret": true, "signature": true,
	"firstname": true, "lastname": true, "fullname": true, "email": true,
}

// timelineRedactedSuffixes widen the key list to the names a future payload
// is likely to use for the same things (pickupLat, driverLng, rawToken,
// verifyPin, …): a key ENDING in one of them is redacted too. Ids never end
// in one (tokenId, pinId stay readable).
var timelineRedactedSuffixes = []string{"lat", "lng", "latitude", "longitude", "token", "pin", "secret"}

// timelineKeyRedacted reports a key whose value an operator never reads.
func timelineKeyRedacted(key string) bool {
	lower := strings.ToLower(key)
	if timelineRedactedKeys[lower] || strings.Contains(lower, "phone") {
		return true
	}
	for _, suffix := range timelineRedactedSuffixes {
		if strings.HasSuffix(lower, suffix) {
			return true
		}
	}
	return false
}

// phoneLike matches a phone number written as a value, once spaces, dashes
// and brackets are removed: E.164 (+ and 8-15 digits) or a national number
// (a leading 0 and 10-12 digits). Dates and amounts never match.
var phoneLike = regexp.MustCompile(`^(\+[1-9][0-9]{7,14}|0[0-9]{9,11})$`)

// phoneSeparators are stripped before a value is judged phone-like.
var phoneSeparators = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "")

// timelineRedacted is what a redacted value reads as.
const timelineRedacted = "[redacted]"

// redactTimelineDetail renders an outbox payload for an operator with every
// sensitive key's value replaced (and any key naming a phone), and any
// phone-like string value blanked wherever it sits. An unreadable payload is
// never echoed.
func redactTimelineDetail(payload []byte) string {
	// Numbers stay exactly as written (json.Number): an integer minor
	// amount or a sequence is never re-rendered through a float.
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil || decoder.More() {
		return `{"detail":"` + timelineRedacted + `"}`
	}
	encoded, err := json.Marshal(redactTimelineValue(decoded))
	if err != nil {
		return `{"detail":"` + timelineRedacted + `"}`
	}
	return string(encoded)
}

func redactTimelineValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, inner := range typed {
			if timelineKeyRedacted(key) {
				out[key] = timelineRedacted
				continue
			}
			out[key] = redactTimelineValue(inner)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, inner := range typed {
			out[i] = redactTimelineValue(inner)
		}
		return out
	case string:
		if phoneLike.MatchString(phoneSeparators.Replace(strings.TrimSpace(typed))) {
			return timelineRedacted
		}
		return typed
	default:
		return typed
	}
}
