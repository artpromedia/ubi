// Package redis holds the Redis primitives the ride lockstep needs: the
// short-lived accept lock, the PIN attempt rate limiter, and the fan-out of
// offers to driver apps through the realtime gateway.
//
// Nothing durable lives here. Redis shortens a path or refuses a burst; the
// database is what actually decides who got the ride and whether a PIN was
// right, so a cold or unreachable Redis degrades the service without ever
// making it wrong.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

const (
	acceptLockPrefix    = "ride:accept:"
	pinAttemptPrefix    = "ride:pin:"
	driverChannelPrefix = "user:"
)

// Client wraps the Redis primitives this service uses. A nil *Client is legal
// and behaves as "no Redis": locks are granted, rate limits do not trip, and
// publishes are dropped, because every one of those is a second line of
// defence behind a database constraint.
type Client struct {
	client *goredis.Client
}

// New wraps a go-redis client.
func New(client *goredis.Client) *Client { return &Client{client: client} }

// Ping reports whether Redis is reachable.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.client == nil {
		return fmt.Errorf("redis is not configured")
	}
	return c.client.Ping(ctx).Err()
}

// Lock is a held accept lock. Release is safe to call on the zero value.
type Lock struct {
	client *goredis.Client
	key    string
	token  string
}

// Release drops the lock if this holder still owns it. The compare-and-delete
// is done in Lua so a lock that already expired and was re-taken by another
// caller is not deleted out from under them.
func (l *Lock) Release(ctx context.Context) {
	if l == nil || l.client == nil {
		return
	}
	const script = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0`
	_ = l.client.Eval(ctx, script, []string{l.key}, l.token).Err()
}

// AcquireAcceptLock takes the per-ride accept lock with SETNX.
//
// It is the first line of defence against a stampede of concurrent accepts:
// it keeps 500 simultaneous callers from all reaching the database. It is not
// the guarantee — the guarantee is the conditional UPDATE and the partial
// unique index on ride.offers, which hold even when this lock is unavailable.
func (c *Client) AcquireAcceptLock(ctx context.Context, rideID uuid.UUID, ttl time.Duration) (*Lock, bool) {
	if c == nil || c.client == nil {
		return nil, true
	}
	key := acceptLockPrefix + rideID.String()
	token := uuid.NewString()
	ok, err := c.client.SetNX(ctx, key, token, ttl).Result()
	if err != nil {
		// An unreachable Redis must not stop a legitimate accept: the database
		// still decides. Fail open here, closed there.
		return nil, true
	}
	if !ok {
		return nil, false
	}
	return &Lock{client: c.client, key: key, token: token}, true
}

// AllowPinAttempt rate-limits PIN entry for one ride: at most `limit` attempts
// per `window`. This is on top of the ride's own attempt counter, which is what
// permanently locks the PIN; this only stops a fast guessing loop.
func (c *Client) AllowPinAttempt(ctx context.Context, rideID uuid.UUID, limit int, window time.Duration) bool {
	if c == nil || c.client == nil {
		return true
	}
	key := pinAttemptPrefix + rideID.String()
	count, err := c.client.Incr(ctx, key).Result()
	if err != nil {
		return true
	}
	if count == 1 {
		_ = c.client.Expire(ctx, key, window).Err()
	}
	return count <= int64(limit)
}

// ClearPinAttempts drops the rate-limit counter once a PIN is verified.
func (c *Client) ClearPinAttempts(ctx context.Context, rideID uuid.UUID) {
	if c == nil || c.client == nil {
		return
	}
	_ = c.client.Del(ctx, pinAttemptPrefix+rideID.String()).Err()
}

// PublishToDriver sends a message to a driver's realtime channel. The realtime
// gateway subscribes to `user:{id}`; a failed publish is not fatal because the
// offer is already persisted and the driver app can read it back.
func (c *Client) PublishToDriver(ctx context.Context, driverID uuid.UUID, payload any) error {
	if c == nil || c.client == nil {
		return nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("unserialisable driver message: %w", err)
	}
	return c.client.Publish(ctx, driverChannelPrefix+driverID.String(), encoded).Err()
}

// PublishToRide broadcasts on the ride topic the realtime gateway mirrors.
func (c *Client) PublishToRide(ctx context.Context, rideID uuid.UUID, payload any) error {
	if c == nil || c.client == nil {
		return nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("unserialisable ride message: %w", err)
	}
	return c.client.Publish(ctx, "ride."+rideID.String(), encoded).Err()
}
