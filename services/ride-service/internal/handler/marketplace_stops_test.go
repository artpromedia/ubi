package handler

import (
	"net/url"
	"strings"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// TestParseStopsParam pins the wire shape of GET /v1/mp/quote's `stops`
// parameter: absent, empty, null and [] are the plain route; exactly one JSON
// array of {lat, lng, label?, purpose?, dwellSec?} is accepted; anything else
// — a repeated parameter, an oversized value, an unknown key (a stop id, a
// price), trailing data — is a validation error naming the field.
func TestParseStopsParam(t *testing.T) {
	for name, query := range map[string]url.Values{
		"absent":      {},
		"blank":       {"stops": {"  "}},
		"null":        {"stops": {"null"}},
		"empty array": {"stops": {"[]"}},
	} {
		stops, err := parseStopsParam(query)
		if err != nil || len(stops) != 0 {
			t.Fatalf("%s must be the plain route: %v %v", name, stops, err)
		}
	}

	stops, err := parseStopsParam(url.Values{"stops": {`[{"lat":6.53,"lng":3.38,"label":"Gate","purpose":"errand","dwellSec":90},{"lat":6.55,"lng":3.37}]`}})
	if err != nil || len(stops) != 2 {
		t.Fatalf("a valid list must parse: %v %v", stops, err)
	}
	if stops[0].Label != "Gate" || stops[0].Purpose != "errand" || stops[0].DwellSec == nil || *stops[0].DwellSec != 90 {
		t.Fatalf("first stop: %+v", stops[0])
	}
	if stops[1].DwellSec != nil || stops[1].Purpose != "" {
		t.Fatalf("omitted fields must stay omitted for the service's defaults: %+v", stops[1])
	}

	for name, query := range map[string]url.Values{
		"repeated":      {"stops": {"[]", "[]"}},
		"oversized":     {"stops": {"[" + strings.Repeat(" ", maxStopsParamBytes) + "]"}},
		"stop id":       {"stops": {`[{"lat":6.53,"lng":3.38,"stopId":"x"}]`}},
		"price":         {"stops": {`[{"lat":6.53,"lng":3.38,"fareMinor":100}]`}},
		"object":        {"stops": {`{"lat":6.53,"lng":3.38}`}},
		"trailing data": {"stops": {`[{"lat":6.53,"lng":3.38}] []`}},
		"not json":      {"stops": {"6.53,3.38"}},
	} {
		_, err := parseStopsParam(query)
		mapped, ok := domain.AsError(err)
		if !ok || mapped.Code != domain.CodeValidationFailed {
			t.Fatalf("%s must be validation_failed: %v", name, err)
		}
		if field, _ := mapped.Details["field"].(string); field != "stops" {
			t.Fatalf("%s must name the stops field: %v", name, mapped.Details)
		}
	}

	// A missing or null coordinate is refused on the stop it belongs to:
	// decoded as 0 it would be a real point on the equator or the meridian
	// (Place.Valid only refuses both being 0) and the route would price it.
	for name, raw := range map[string]string{
		"missing lat":      `[{"lng":3.38}]`,
		"missing lng":      `[{"lat":6.53}]`,
		"null lng":         `[{"lat":6.53,"lng":null}]`,
		"null element":     `[null]`,
		"second stop bare": `[{"lat":6.53,"lng":3.38},{"lat":6.55}]`,
	} {
		_, err := parseStopsParam(url.Values{"stops": {raw}})
		mapped, ok := domain.AsError(err)
		if !ok || mapped.Code != domain.CodeValidationFailed {
			t.Fatalf("%s must be validation_failed: %v", name, err)
		}
		want := "stops[0]"
		if name == "second stop bare" {
			want = "stops[1]"
		}
		if field, _ := mapped.Details["field"].(string); field != want {
			t.Fatalf("%s must name %s: %v", name, want, mapped.Details)
		}
	}
}
