package service

import (
	"bytes"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

// TestTripAccessSealerFailsClosed: the composition root builds the sealed
// trip-link delivery only from a usable TRIP_ACCESS_DELIVERY_KEY/KID; a
// missing or malformed key yields NO sealer (guest trip links refused, never
// sent in clear), logged as an alert in production.
func TestTripAccessSealerFailsClosed(t *testing.T) {
	var logs bytes.Buffer
	logger := zerolog.New(&logs)

	if sealer := buildTripAccessSealer(Config{Logger: logger, Environment: "production"}); sealer != nil {
		t.Fatal("no key must mean no sealer")
	}
	if !strings.Contains(logs.String(), `"alert":true`) || !strings.Contains(logs.String(), `"level":"error"`) {
		t.Fatalf("a missing key in production is an alert: %s", logs.String())
	}

	logs.Reset()
	if sealer := buildTripAccessSealer(Config{Logger: logger, Environment: "development",
		TripAccessDeliveryKey: "AAECAwQFBgcICQoLDA0ODw==", TripAccessDeliveryKid: "k1"}); sealer != nil {
		t.Fatal("a 16-byte key is unusable")
	}
	if !strings.Contains(logs.String(), `"level":"warn"`) {
		t.Fatalf("outside production it is a warning: %s", logs.String())
	}

	sealer := buildTripAccessSealer(Config{Logger: logger, Environment: "production",
		TripAccessDeliveryKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", TripAccessDeliveryKid: "2026-09"})
	if sealer == nil || sealer.Kid() != "2026-09" {
		t.Fatal("a usable key builds the sealer")
	}
}
