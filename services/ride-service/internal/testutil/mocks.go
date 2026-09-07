package testutil

import (
	"sync"
	"time"
)

// Clock is a controllable clock for tests.
//
// It exists so that expiry, geofence freshness and wait-fee tests can move time
// deliberately instead of sleeping: a test that sleeps for a 12-second offer
// TTL is a test nobody runs.
type Clock struct {
	mu  sync.RWMutex
	now time.Time
}

// NewClock starts a clock at a fixed instant.
func NewClock(start time.Time) *Clock {
	return &Clock{now: start.UTC()}
}

// Now reports the current instant. Its signature matches move.Deps.Now.
func (c *Clock) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.now
}

// Advance moves the clock forward.
func (c *Clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// Set moves the clock to a specific instant.
func (c *Clock) Set(at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = at.UTC()
}
