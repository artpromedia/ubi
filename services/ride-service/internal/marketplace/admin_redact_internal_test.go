package marketplace

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestTimelineRedactionNeverShowsSecrets pins redactTimelineDetail itself,
// independent of what today's payloads happen to carry: a payload holding a
// sealed trip-link envelope, its SMS copy, a raw token, a PIN, phones (under
// a phone key, under an innocuous key, E.164 and national) and coordinates
// (lat/lng pairs, suffixed keys like pickupLat, nested location structures)
// renders with none of them — while ids, states, times and integer minor
// amounts stay exactly as written.
func TestTimelineRedactionNeverShowsSecrets(t *testing.T) {
	secrets := map[string]string{
		"sealed ciphertext":        "q8Zc1vB0l3xS9mKfPz7Yw2==",
		"sealed iv":                "bm9uY2Utdml2LTk2",
		"sms copy":                 "Your UBI ride is on its way: {link}",
		"raw token":                "tat_7f3a9c1e5b2d4f6a8c0e1b3d5f7a9c1e",
		"access token":             "eyJhbGciOiJIUzI1NiJ9.payload.sig",
		"pickup pin":               "4821",
		"phone key":                "+2348031234567",
		"phone value, E.164":       "+44 20 7946 0958",
		"phone value, national":    "0803-123-4567",
		"latitude":                 "6.4550575",
		"longitude":                "3.3941795",
		"suffixed latitude":        "6.5243793",
		"suffixed longitude":       "3.3792057",
		"nested location":          "7.3775355",
		"passenger name":           "Adaeze",
		"passenger e-mail address": "adaeze@example.com",
	}
	payload := `{
		"tokenId": "8b0d1f7e-2c4a-4d5e-9f10-0000000000aa",
		"requestId": "3f6c1a52-9d0e-4b7e-8a1d-0000000000dd",
		"state": "issued",
		"expiresAt": "2026-09-23T12:00:00Z",
		"fareMinor": {"amountMinor": 9007199254740991, "currency": "NGN"},
		"sequence": 12345678901234567,
		"recipient": {"channel": "sms", "phone": "+2348031234567"},
		"smsCopy": "Your UBI ride is on its way: {link}",
		"sealed": {"v": 1, "alg": "A256GCM", "kid": "k1", "iv": "bm9uY2Utdml2LTk2", "ct": "q8Zc1vB0l3xS9mKfPz7Yw2==", "tag": "dGFn"},
		"rawToken": "tat_7f3a9c1e5b2d4f6a8c0e1b3d5f7a9c1e",
		"passenger": {"accessToken": "eyJhbGciOiJIUzI1NiJ9.payload.sig", "firstName": "Adaeze", "email": "adaeze@example.com"},
		"pickupPin": "4821",
		"contact": "+44 20 7946 0958",
		"alternates": ["0803-123-4567", "(0803) 123 4567"],
		"alternate": "0803-123-4567",
		"pickup": {"lat": 6.4550575, "lng": 3.3941795},
		"driverPosition": {"pickupLat": 6.5243793, "pickupLng": 3.3792057},
		"evidence": {"location": {"coordinates": [7.3775355, 3.9470396]}}
	}`
	rendered := redactTimelineDetail([]byte(payload))

	for what, secret := range secrets {
		if strings.Contains(rendered, secret) {
			t.Errorf("the redacted detail still shows the %s (%q): %s", what, secret, rendered)
		}
	}
	var detail map[string]any
	if err := json.Unmarshal([]byte(rendered), &detail); err != nil {
		t.Fatalf("the redacted detail is JSON: %v (%s)", err, rendered)
	}
	if detail["alternate"] != timelineRedacted || detail["contact"] != timelineRedacted {
		t.Fatalf("phone-like values are blanked under any key: %v / %v", detail["alternate"], detail["contact"])
	}
	for _, key := range []string{"recipient", "smsCopy", "sealed", "rawToken", "pickupPin", "pickup"} {
		if detail[key] != timelineRedacted {
			t.Errorf("%s reads %q, got %v", key, timelineRedacted, detail[key])
		}
	}
	for _, kept := range []string{
		`"tokenId":"8b0d1f7e-2c4a-4d5e-9f10-0000000000aa"`,
		`"requestId":"3f6c1a52-9d0e-4b7e-8a1d-0000000000dd"`,
		`"state":"issued"`,
		`"expiresAt":"2026-09-23T12:00:00Z"`,
		`"amountMinor":9007199254740991`,
		`"sequence":12345678901234567`,
	} {
		if !strings.Contains(rendered, kept) {
			t.Errorf("ids, states, times and integers stay exactly as written: %s missing from %s", kept, rendered)
		}
	}

	for _, unreadable := range []string{`not json`, `{"a":1} {"b":2}`, ``} {
		if got := redactTimelineDetail([]byte(unreadable)); got != `{"detail":"[redacted]"}` {
			t.Errorf("an unreadable payload %q is never echoed: %s", unreadable, got)
		}
	}
}
