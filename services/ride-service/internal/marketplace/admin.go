package marketplace

import (
	"context"
	"errors"
	"fmt"
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
	AskedMinor int64              `json:"askedMinor"`
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
			AskedMinor: request.RequestedMinor,
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

	rows, err := s.deps.Store.Pool().Query(ctx, `
		SELECT name, occurred_at, payload
		FROM public.outbox_events
		WHERE name LIKE 'mp.%'
			AND (aggregate_id = $1 OR payload->>'requestId' = $1)
		ORDER BY occurred_at ASC, id ASC`, requestID.String())
	if err != nil {
		return nil, asDomainError(err)
	}
	defer rows.Close()

	timeline := &AdminTimeline{
		RequestID:     request.ID.String(),
		PolicyVersion: request.PolicyVersion,
		Events:        []*TimelineEvent{},
	}
	for rows.Next() {
		var name string
		var at time.Time
		var payload []byte
		if err := rows.Scan(&name, &at, &payload); err != nil {
			return nil, asDomainError(err)
		}
		timeline.Events = append(timeline.Events, &TimelineEvent{
			At:     at,
			Type:   name,
			Detail: string(payload),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, asDomainError(err)
	}
	return timeline, nil
}
