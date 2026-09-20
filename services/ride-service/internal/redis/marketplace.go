package redis

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Marketplace stationary-gate keys. The recent-sample ring and the parked
// confirmation are conveniences for the eligibility evaluator: when Redis is
// cold or unreachable the evaluator sees no samples and answers NOT eligible
// (LOCATION_STALE), which is the fail-closed direction for a gate.
const (
	driverSamplePrefix = "mp:samples:"
	parkedPrefix       = "mp:parked:"

	// driverSampleRingSize caps the per-driver ring. It is a buffer capacity,
	// not commercial policy: at the app's ~1Hz reporting it covers well over
	// any configured dwell window, and the dwell window itself always comes
	// from the city's marketplace policy.
	driverSampleRingSize = 240
	// driverSampleTTL drops an abandoned ring. Physics again, not policy: a
	// ring older than this is stale under any plausible maxLocationAgeSec.
	driverSampleTTL = 15 * time.Minute
)

// DriverSample is one accepted location fix in a driver's recent-sample ring,
// fed from the driver location ingest path and read by the stationary gate.
type DriverSample struct {
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	AccuracyM  float64   `json:"accuracyM"`
	SpeedMps   float64   `json:"speedMps"`
	RecordedAt time.Time `json:"recordedAt"`
}

// RecordDriverSamples appends accepted fixes to the driver's ring, newest
// first. Failures are swallowed: the ring is an eligibility input, and a
// missing ring reads as "not stationary", never as an error a driver sees.
func (c *Client) RecordDriverSamples(ctx context.Context, driverID uuid.UUID, samples []DriverSample) {
	if c == nil || c.client == nil || len(samples) == 0 {
		return
	}
	key := driverSamplePrefix + driverID.String()
	values := make([]interface{}, 0, len(samples))
	for _, sample := range samples {
		encoded, err := json.Marshal(sample)
		if err != nil {
			continue
		}
		values = append(values, string(encoded))
	}
	if len(values) == 0 {
		return
	}
	pipe := c.client.Pipeline()
	pipe.LPush(ctx, key, values...)
	pipe.LTrim(ctx, key, 0, driverSampleRingSize-1)
	pipe.Expire(ctx, key, driverSampleTTL)
	_, _ = pipe.Exec(ctx)
}

// DriverSamples reads the driver's ring, newest first. An unreachable Redis
// returns an empty ring, which the stationary gate treats as "no evidence".
func (c *Client) DriverSamples(ctx context.Context, driverID uuid.UUID, limit int) []DriverSample {
	if c == nil || c.client == nil {
		return nil
	}
	if limit <= 0 || limit > driverSampleRingSize {
		limit = driverSampleRingSize
	}
	raw, err := c.client.LRange(ctx, driverSamplePrefix+driverID.String(), 0, int64(limit-1)).Result()
	if err != nil {
		return nil
	}
	samples := make([]DriverSample, 0, len(raw))
	for _, entry := range raw {
		var sample DriverSample
		if json.Unmarshal([]byte(entry), &sample) == nil {
			samples = append(samples, sample)
		}
	}
	return samples
}

// ConfirmParked records the driver's explicit "I'm parked" confirmation with
// the TTL the caller derived from city policy. The confirmation is one input
// of the stationary gate, never the whole of it: it cannot override telemetry
// that shows the vehicle clearly moving.
func (c *Client) ConfirmParked(ctx context.Context, driverID uuid.UUID, ttl time.Duration) error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Set(ctx, parkedPrefix+driverID.String(), time.Now().UTC().Format(time.RFC3339), ttl).Err()
}

// ParkedConfirmed reports whether a live parked confirmation exists.
func (c *Client) ParkedConfirmed(ctx context.Context, driverID uuid.UUID) bool {
	if c == nil || c.client == nil {
		return false
	}
	value, err := c.client.Get(ctx, parkedPrefix+driverID.String()).Result()
	return err == nil && value != ""
}
