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
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// fleet-service, as ride-service calls it — INTERNAL CONTRACT A routes 8 and
// 9 (MpFleetVehicleAtSchema / MpFleetVehicleSchema in
// packages/contracts/src/marketplace-fleet.ts):
//
//	GET {FLEET_SERVICE_URL}/internal/fleet/drivers/{driverId}/vehicle-at?from&to
//	GET {FLEET_SERVICE_URL}/internal/fleet/vehicles/{vehicleId}
//	X-Service-Key: FLEET_SERVICE_KEY   (>= 32 characters)
//
// The client holds fleet-service to the contract strictly: every object must
// carry exactly its documented keys, and a malformed answer is refused as a
// whole (ErrFleetServiceUnavailable) — never half-trusted.
//
// NOTHING HERE MAY BLOCK AN AWARD. A short timeout bounds every call; when
// fleet-service is unconfigured, down, slow or malformed, the advance award
// goes ahead without a vehicle (VehicleResolutionPending) and the sweep keeps
// asking. ride-service holds no other record of which vehicle a driver uses
// (the verified driver profile carries a masked plate, never a vehicle id),
// so "the driver's own recorded vehicle" fallback is honestly null: the
// booking is then guarded by the per-driver exclusion alone, as it was
// before the fleet calendar.

// ErrFleetServiceUnavailable means fleet-service gave no usable answer:
// unconfigured, unreachable, timed out, refused or malformed.
var ErrFleetServiceUnavailable = errors.New("fleet service unavailable")

// ErrFleetVehicleUnknown is fleet-service's definite "no such vehicle"
// (route 9 answered 404).
var ErrFleetVehicleUnknown = errors.New("fleet service does not know that vehicle")

// FleetVehicleAt is route 8's answer: the vehicle a fleet driver is assigned
// to for the WHOLE interval under a signed assignment, or all nil.
type FleetVehicleAt struct {
	VehicleID    *string
	AssignmentID *string
	VehicleClass *string
	Capacity     *int
}

// FleetVehicle is route 9's answer (swap revalidation, document checks).
// A document expiry given as a bare date is read conservatively as expiring
// at 00:00 UTC ON that date; nil is a missing document.
type FleetVehicle struct {
	VehicleID        string
	FleetID          string
	Classes          []string
	Capacity         int
	InsuranceExpiry  *time.Time
	InspectionExpiry *time.Time
}

// DocumentsValidThrough reports whether both documents are valid until at
// least `until`.
func (v *FleetVehicle) DocumentsValidThrough(until time.Time) bool {
	return v.InsuranceExpiry != nil && v.InspectionExpiry != nil &&
		!v.InsuranceExpiry.Before(until) && !v.InspectionExpiry.Before(until)
}

// EarliestExpiry is the sooner of the two document expiries (nil when a
// document is missing).
func (v *FleetVehicle) EarliestExpiry() *time.Time {
	if v.InsuranceExpiry == nil || v.InspectionExpiry == nil {
		return nil
	}
	if v.InsuranceExpiry.Before(*v.InspectionExpiry) {
		return v.InsuranceExpiry
	}
	return v.InspectionExpiry
}

// Statuses answered by GET /internal/fleet/drivers/{driverId}/online-vehicle
// (MP_ONLINE_VEHICLE_STATUSES in packages/contracts/src/marketplace-fleet.ts).
const (
	OnlineVehicleNotFleetDriver = "not_fleet_driver"
	OnlineVehicleOK             = "ok"
	OnlineVehicleNoActiveShift  = "no_active_shift"
	OnlineVehicleInactive       = "vehicle_inactive"
	OnlineVehicleDocExpired     = "doc_expired"
)

// FleetOnlineVehicleDetail is the rider-safe vehicle metadata returned by
// fleet-service for a fleet driver's signed shift right now (CC-A01).
type FleetOnlineVehicleDetail struct {
	VehicleID        string
	FleetID          string
	PlateMasked      string
	Make             *string
	Model            *string
	Colour           *string
	BodyType         string
	Classes          []string
	Capacity         int
	InsuranceExpiry  *time.Time
	InspectionExpiry *time.Time
}

// DocumentsValidAt reports whether both documents cover `at`.
func (v *FleetOnlineVehicleDetail) DocumentsValidAt(at time.Time) bool {
	return v != nil && v.InsuranceExpiry != nil && v.InspectionExpiry != nil &&
		!v.InsuranceExpiry.Before(at) && !v.InspectionExpiry.Before(at)
}

// SupportsClass reports whether the vehicle is eligible for `vehicleClass`.
func (v *FleetOnlineVehicleDetail) SupportsClass(vehicleClass string) bool {
	if v == nil {
		return false
	}
	for _, class := range v.Classes {
		if class == vehicleClass {
			return true
		}
	}
	return false
}

// FleetOnlineVehicle is fleet-service's live go-online / award vehicle answer
// (MpFleetOnlineVehicleSchema).
type FleetOnlineVehicle struct {
	FleetMember  bool
	Status       string
	AssignmentID *string
	ShiftEndsAt  *time.Time
	Vehicle      *FleetOnlineVehicleDetail
}

// FleetServicePort is ride-service's port onto fleet-service.
type FleetServicePort interface {
	// VehicleAt answers route 8 for one driver and interval.
	VehicleAt(ctx context.Context, driverID uuid.UUID, from, to time.Time) (*FleetVehicleAt, error)
	// Vehicle answers route 9 for one vehicle.
	Vehicle(ctx context.Context, vehicleID string) (*FleetVehicle, error)
	// OnlineVehicle resolves whether a driver is a fleet driver in `cityID`
	// and which vehicle their signed shift assigns them right now (CC-A01).
	OnlineVehicle(ctx context.Context, driverID uuid.UUID, cityID string, at time.Time) (*FleetOnlineVehicle, error)
}

// unconfiguredFleetService is the port when no fleet-service is wired: it
// answers nothing, honestly.
type unconfiguredFleetService struct{}

func (unconfiguredFleetService) VehicleAt(context.Context, uuid.UUID, time.Time, time.Time) (*FleetVehicleAt, error) {
	return nil, fmt.Errorf("%w: no fleet-service is configured", ErrFleetServiceUnavailable)
}

func (unconfiguredFleetService) Vehicle(context.Context, string) (*FleetVehicle, error) {
	return nil, fmt.Errorf("%w: no fleet-service is configured", ErrFleetServiceUnavailable)
}

func (unconfiguredFleetService) OnlineVehicle(context.Context, uuid.UUID, string, time.Time) (*FleetOnlineVehicle, error) {
	return nil, fmt.Errorf("%w: no fleet-service is configured", ErrFleetServiceUnavailable)
}

// FleetServiceOptions tunes the HTTP port. Zero values take the defaults.
type FleetServiceOptions struct {
	// Client is the HTTP client; its Timeout bounds one call. Default: a
	// client with a 2 s timeout, so a hanging fleet-service costs an advance
	// award at most that long.
	Client *http.Client
}

const (
	defaultFleetTimeout = 2 * time.Second
	// maxFleetBodyBytes bounds one answer; both answers are a few hundred bytes.
	maxFleetBodyBytes = 64 << 10
	// FleetServiceKeyMinLength mirrors FLEET_INTERNAL_KEY_MIN_LENGTH.
	FleetServiceKeyMinLength = 32
	// FleetServiceKeyHeader mirrors FLEET_INTERNAL_KEY_HEADER.
	FleetServiceKeyHeader = "X-Service-Key"
	// fleetServiceName is this service's caller name.
	fleetServiceName = "ride-service"
)

// HTTPFleetService is the fleet-service client.
type HTTPFleetService struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewHTTPFleetService builds the port. `baseURL` is FLEET_SERVICE_URL and
// `serviceKey` is FLEET_SERVICE_KEY; with the URL empty or the key shorter
// than 32 characters the port answers nothing (fail closed).
func NewHTTPFleetService(baseURL, serviceKey string, options FleetServiceOptions) FleetServicePort {
	if strings.TrimSpace(baseURL) == "" || len(serviceKey) < FleetServiceKeyMinLength {
		return unconfiguredFleetService{}
	}
	port := &HTTPFleetService{
		baseURL:    strings.TrimRight(baseURL, "/"),
		serviceKey: serviceKey,
		client:     options.Client,
	}
	if port.client == nil {
		port.client = &http.Client{Timeout: defaultFleetTimeout}
	}
	return port
}

// FleetServiceConfigured reports whether a port will actually call out.
func FleetServiceConfigured(port FleetServicePort) bool {
	if port == nil {
		return false
	}
	_, unconfigured := port.(unconfiguredFleetService)
	return !unconfigured
}

// get calls one route and returns the body of a 200 (or ErrFleetVehicleUnknown
// on a 404 when notFound is set).
func (f *HTTPFleetService) get(ctx context.Context, path string, query url.Values, notFound error) ([]byte, error) {
	target := f.baseURL + "/internal/fleet" + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFleetServiceUnavailable, err)
	}
	request.Header.Set(FleetServiceKeyHeader, f.serviceKey)
	request.Header.Set("X-Service-Name", fleetServiceName)
	request.Header.Set("Accept", "application/json")
	response, err := f.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFleetServiceUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxFleetBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrFleetServiceUnavailable, err)
	}
	if len(body) > maxFleetBodyBytes {
		return nil, fmt.Errorf("%w: answer too large", ErrFleetServiceUnavailable)
	}
	switch {
	case response.StatusCode == http.StatusOK:
		return body, nil
	case response.StatusCode == http.StatusNotFound && notFound != nil:
		return nil, notFound
	default:
		return nil, fmt.Errorf("%w: status %d", ErrFleetServiceUnavailable, response.StatusCode)
	}
}

// VehicleAt implements FleetServicePort (route 8).
func (f *HTTPFleetService) VehicleAt(ctx context.Context, driverID uuid.UUID, from, to time.Time) (*FleetVehicleAt, error) {
	query := url.Values{}
	query.Set("from", from.UTC().Format(time.RFC3339))
	query.Set("to", to.UTC().Format(time.RFC3339))
	body, err := f.get(ctx, "/drivers/"+url.PathEscape(driverID.String())+"/vehicle-at", query, nil)
	if err != nil {
		return nil, err
	}
	return parseFleetVehicleAt(body)
}

// Vehicle implements FleetServicePort (route 9).
func (f *HTTPFleetService) Vehicle(ctx context.Context, vehicleID string) (*FleetVehicle, error) {
	body, err := f.get(ctx, "/vehicles/"+url.PathEscape(vehicleID), nil, ErrFleetVehicleUnknown)
	if err != nil {
		return nil, err
	}
	vehicle, err := parseFleetVehicle(body)
	if err != nil {
		return nil, err
	}
	if vehicle.VehicleID != vehicleID {
		return nil, fmt.Errorf("%w: answered vehicle %q for %q", ErrFleetServiceUnavailable, vehicle.VehicleID, vehicleID)
	}
	return vehicle, nil
}

// exactFleetObject decodes one JSON object that must carry exactly `keys`.
func exactFleetObject(raw []byte, path string, keys ...string) (map[string]json.RawMessage, error) {
	var object map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&object); err != nil || object == nil || decoder.More() {
		return nil, fmt.Errorf("%w: %s is not a JSON object", ErrFleetServiceUnavailable, path)
	}
	if len(object) != len(keys) {
		got := make([]string, 0, len(object))
		for key := range object {
			got = append(got, key)
		}
		sort.Strings(got)
		return nil, fmt.Errorf("%w: %s carries keys %v, want exactly %v", ErrFleetServiceUnavailable, path, got, keys)
	}
	for _, key := range keys {
		if _, ok := object[key]; !ok {
			return nil, fmt.Errorf("%w: %s lacks %q", ErrFleetServiceUnavailable, path, key)
		}
	}
	return object, nil
}

func fleetNullableString(raw json.RawMessage, path string) (*string, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || value == "" {
		return nil, fmt.Errorf("%w: %s must be a non-empty string or null", ErrFleetServiceUnavailable, path)
	}
	return &value, nil
}

func fleetPositiveInt(raw json.RawMessage, path string) (int, error) {
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil || value != float64(int(value)) || value <= 0 {
		return 0, fmt.Errorf("%w: %s must be a positive integer", ErrFleetServiceUnavailable, path)
	}
	return int(value), nil
}

// parseFleetExpiry reads an ISO date (conservatively: expired from 00:00 UTC
// on that date) or an ISO-8601 instant; null is a missing document.
func parseFleetExpiry(raw json.RawMessage, path string) (*time.Time, error) {
	text, err := fleetNullableString(raw, path)
	if err != nil || text == nil {
		return nil, err
	}
	if at, err := time.Parse("2006-01-02", *text); err == nil {
		at = at.UTC()
		return &at, nil
	}
	at, err := time.Parse(time.RFC3339Nano, *text)
	if err != nil {
		return nil, fmt.Errorf("%w: %s must be an ISO date or instant", ErrFleetServiceUnavailable, path)
	}
	at = at.UTC()
	return &at, nil
}

// parseFleetVehicleAt validates a route 8 answer (MpFleetVehicleAtSchema).
func parseFleetVehicleAt(body []byte) (*FleetVehicleAt, error) {
	object, err := exactFleetObject(body, "vehicle-at", "vehicleId", "assignmentId", "vehicleClass", "capacity")
	if err != nil {
		return nil, err
	}
	out := &FleetVehicleAt{}
	if out.VehicleID, err = fleetNullableString(object["vehicleId"], "vehicleId"); err != nil {
		return nil, err
	}
	if out.AssignmentID, err = fleetNullableString(object["assignmentId"], "assignmentId"); err != nil {
		return nil, err
	}
	if out.VehicleClass, err = fleetNullableString(object["vehicleClass"], "vehicleClass"); err != nil {
		return nil, err
	}
	if string(object["capacity"]) != "null" {
		capacity, err := fleetPositiveInt(object["capacity"], "capacity")
		if err != nil {
			return nil, err
		}
		out.Capacity = &capacity
	}
	// A vehicle is only ever answered under a signed assignment, and "no
	// covering assignment" is all null — anything in between is malformed.
	if (out.VehicleID == nil) != (out.AssignmentID == nil) ||
		(out.VehicleID == nil && (out.VehicleClass != nil || out.Capacity != nil)) {
		return nil, fmt.Errorf("%w: vehicle-at mixes an assignment with nulls", ErrFleetServiceUnavailable)
	}
	return out, nil
}

// parseFleetVehicle validates a route 9 answer (MpFleetVehicleSchema).
func parseFleetVehicle(body []byte) (*FleetVehicle, error) {
	object, err := exactFleetObject(body, "vehicle", "vehicleId", "fleetId", "classes", "capacity", "documents")
	if err != nil {
		return nil, err
	}
	out := &FleetVehicle{}
	id, err := fleetNullableString(object["vehicleId"], "vehicleId")
	if err != nil || id == nil {
		return nil, fmt.Errorf("%w: vehicleId is required", ErrFleetServiceUnavailable)
	}
	out.VehicleID = *id
	fleet, err := fleetNullableString(object["fleetId"], "fleetId")
	if err != nil || fleet == nil {
		return nil, fmt.Errorf("%w: fleetId is required", ErrFleetServiceUnavailable)
	}
	out.FleetID = *fleet
	if err := json.Unmarshal(object["classes"], &out.Classes); err != nil || out.Classes == nil {
		return nil, fmt.Errorf("%w: classes must be an array of strings", ErrFleetServiceUnavailable)
	}
	for _, class := range out.Classes {
		if class == "" {
			return nil, fmt.Errorf("%w: classes carries an empty class", ErrFleetServiceUnavailable)
		}
	}
	if out.Capacity, err = fleetPositiveInt(object["capacity"], "capacity"); err != nil {
		return nil, err
	}
	documents, err := exactFleetObject(object["documents"], "documents", "insuranceExpiry", "inspectionExpiry")
	if err != nil {
		return nil, err
	}
	if out.InsuranceExpiry, err = parseFleetExpiry(documents["insuranceExpiry"], "documents.insuranceExpiry"); err != nil {
		return nil, err
	}
	if out.InspectionExpiry, err = parseFleetExpiry(documents["inspectionExpiry"], "documents.inspectionExpiry"); err != nil {
		return nil, err
	}
	return out, nil
}

// OnlineVehicle implements FleetServicePort (CC-A01 live vehicle resolution).
func (f *HTTPFleetService) OnlineVehicle(ctx context.Context, driverID uuid.UUID, cityID string, at time.Time) (*FleetOnlineVehicle, error) {
	query := url.Values{}
	query.Set("at", at.UTC().Format(time.RFC3339))
	if strings.TrimSpace(cityID) != "" {
		query.Set("cityId", cityID)
	}
	body, err := f.get(ctx, "/drivers/"+url.PathEscape(driverID.String())+"/online-vehicle", query, nil)
	if err != nil {
		return nil, err
	}
	return parseFleetOnlineVehicle(body)
}

var validOnlineVehicleStatuses = map[string]bool{
	OnlineVehicleNotFleetDriver: true,
	OnlineVehicleOK:             true,
	OnlineVehicleNoActiveShift:  true,
	OnlineVehicleInactive:       true,
	OnlineVehicleDocExpired:     true,
}

func parseFleetInstant(raw json.RawMessage, path string) (*time.Time, error) {
	text, err := fleetNullableString(raw, path)
	if err != nil || text == nil {
		return nil, err
	}
	at, err := time.Parse(time.RFC3339Nano, *text)
	if err != nil {
		return nil, fmt.Errorf("%w: %s must be an RFC 3339 timestamp", ErrFleetServiceUnavailable, path)
	}
	utc := at.UTC()
	return &utc, nil
}

// parseFleetOnlineVehicle validates MpFleetOnlineVehicleSchema strictly.
func parseFleetOnlineVehicle(body []byte) (*FleetOnlineVehicle, error) {
	object, err := exactFleetObject(body, "online-vehicle", "fleetMember", "status", "assignmentId", "shiftEndsAt", "vehicle")
	if err != nil {
		return nil, err
	}
	out := &FleetOnlineVehicle{}
	switch string(object["fleetMember"]) {
	case "true":
		out.FleetMember = true
	case "false":
		out.FleetMember = false
	default:
		return nil, fmt.Errorf("%w: fleetMember must be a boolean", ErrFleetServiceUnavailable)
	}
	status, err := fleetNullableString(object["status"], "status")
	if err != nil || status == nil || !validOnlineVehicleStatuses[*status] {
		return nil, fmt.Errorf("%w: status is invalid", ErrFleetServiceUnavailable)
	}
	out.Status = *status
	if out.AssignmentID, err = fleetNullableString(object["assignmentId"], "assignmentId"); err != nil {
		return nil, err
	}
	if out.ShiftEndsAt, err = parseFleetInstant(object["shiftEndsAt"], "shiftEndsAt"); err != nil {
		return nil, err
	}
	if string(object["vehicle"]) != "null" {
		detail, err := parseFleetOnlineVehicleDetail(object["vehicle"])
		if err != nil {
			return nil, err
		}
		out.Vehicle = detail
	}

	switch {
	case !out.FleetMember:
		if out.Status != OnlineVehicleNotFleetDriver || out.AssignmentID != nil || out.ShiftEndsAt != nil || out.Vehicle != nil {
			return nil, fmt.Errorf("%w: non-fleet online-vehicle carries fleet fields", ErrFleetServiceUnavailable)
		}
	case out.Status == OnlineVehicleNotFleetDriver:
		return nil, fmt.Errorf("%w: fleetMember=true cannot answer not_fleet_driver", ErrFleetServiceUnavailable)
	case out.Status == OnlineVehicleNoActiveShift && out.Vehicle != nil:
		return nil, fmt.Errorf("%w: no_active_shift cannot carry a vehicle", ErrFleetServiceUnavailable)
	case out.Status == OnlineVehicleOK && (out.AssignmentID == nil || out.Vehicle == nil || len(out.Vehicle.Classes) == 0):
		return nil, fmt.Errorf("%w: ok online-vehicle requires assignmentId, vehicle and classes", ErrFleetServiceUnavailable)
	}
	return out, nil
}

func parseFleetOnlineVehicleDetail(raw []byte) (*FleetOnlineVehicleDetail, error) {
	object, err := exactFleetObject(raw, "online-vehicle.vehicle",
		"vehicleId", "fleetId", "plateMasked", "make", "model", "colour", "bodyType", "classes", "capacity", "documents")
	if err != nil {
		return nil, err
	}
	out := &FleetOnlineVehicleDetail{}
	id, err := fleetNullableString(object["vehicleId"], "vehicle.vehicleId")
	if err != nil || id == nil {
		return nil, fmt.Errorf("%w: vehicle.vehicleId is required", ErrFleetServiceUnavailable)
	}
	out.VehicleID = *id
	fleetID, err := fleetNullableString(object["fleetId"], "vehicle.fleetId")
	if err != nil || fleetID == nil {
		return nil, fmt.Errorf("%w: vehicle.fleetId is required", ErrFleetServiceUnavailable)
	}
	out.FleetID = *fleetID
	plate, err := fleetNullableString(object["plateMasked"], "vehicle.plateMasked")
	if err != nil || plate == nil {
		return nil, fmt.Errorf("%w: vehicle.plateMasked is required", ErrFleetServiceUnavailable)
	}
	out.PlateMasked = *plate
	if out.Make, err = fleetNullableString(object["make"], "vehicle.make"); err != nil {
		return nil, err
	}
	if out.Model, err = fleetNullableString(object["model"], "vehicle.model"); err != nil {
		return nil, err
	}
	if out.Colour, err = fleetNullableString(object["colour"], "vehicle.colour"); err != nil {
		return nil, err
	}
	bodyType, err := fleetNullableString(object["bodyType"], "vehicle.bodyType")
	if err != nil || bodyType == nil {
		return nil, fmt.Errorf("%w: vehicle.bodyType is required", ErrFleetServiceUnavailable)
	}
	if _, ok := driverVehicleTypes[*bodyType]; !ok {
		return nil, fmt.Errorf("%w: vehicle.bodyType %q is invalid", ErrFleetServiceUnavailable, *bodyType)
	}
	out.BodyType = *bodyType
	if err := json.Unmarshal(object["classes"], &out.Classes); err != nil || out.Classes == nil {
		return nil, fmt.Errorf("%w: vehicle.classes must be an array of strings", ErrFleetServiceUnavailable)
	}
	for _, class := range out.Classes {
		if class == "" {
			return nil, fmt.Errorf("%w: vehicle.classes carries an empty class", ErrFleetServiceUnavailable)
		}
	}
	if out.Capacity, err = fleetPositiveInt(object["capacity"], "vehicle.capacity"); err != nil {
		return nil, err
	}
	documents, err := exactFleetObject(object["documents"], "vehicle.documents", "insuranceExpiry", "inspectionExpiry")
	if err != nil {
		return nil, err
	}
	if out.InsuranceExpiry, err = parseFleetExpiry(documents["insuranceExpiry"], "vehicle.documents.insuranceExpiry"); err != nil {
		return nil, err
	}
	if out.InspectionExpiry, err = parseFleetExpiry(documents["inspectionExpiry"], "vehicle.documents.inspectionExpiry"); err != nil {
		return nil, err
	}
	return out, nil
}
