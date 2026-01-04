/*
 * Redis Client
 */

package redis

import (
	"context"
	"encoding/json"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/rs/zerolog/log"
)

// Client wraps the Redis client
type Client struct {
	client *redis.Client
}

// New creates a new Redis client
func New(redisURL string) (*Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(opt)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	log.Info().Msg("Connected to Redis")

	return &Client{client: client}, nil
}

// Close closes the Redis connection
func (c *Client) Close() error {
	log.Info().Msg("Redis connection closed")
	return c.client.Close()
}

// Health checks Redis health
func (c *Client) Health(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// Get retrieves a value
func (c *Client) Get(ctx context.Context, key string) (string, error) {
	return c.client.Get(ctx, key).Result()
}

// Set stores a value with optional TTL
func (c *Client) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	return c.client.Set(ctx, key, value, ttl).Err()
}

// SetJSON stores a JSON value
func (c *Client) SetJSON(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, key, data, ttl).Err()
}

// GetJSON retrieves a JSON value
func (c *Client) GetJSON(ctx context.Context, key string, dest interface{}) error {
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(data), dest)
}

// Delete removes a key
func (c *Client) Delete(ctx context.Context, keys ...string) error {
	return c.client.Del(ctx, keys...).Err()
}

// Exists checks if a key exists
func (c *Client) Exists(ctx context.Context, key string) (bool, error) {
	n, err := c.client.Exists(ctx, key).Result()
	return n > 0, err
}

// Publish publishes a message to a channel
func (c *Client) Publish(ctx context.Context, channel string, message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return c.client.Publish(ctx, channel, data).Err()
}

// Subscribe subscribes to a channel
func (c *Client) Subscribe(ctx context.Context, channel string) *redis.PubSub {
	return c.client.Subscribe(ctx, channel)
}

// GeoAdd adds a location to a geo set
func (c *Client) GeoAdd(ctx context.Context, key string, longitude, latitude float64, member string) error {
	return c.client.GeoAdd(ctx, key, &redis.GeoLocation{
		Name:      member,
		Longitude: longitude,
		Latitude:  latitude,
	}).Err()
}

// GeoRadius finds members within a radius
func (c *Client) GeoRadius(ctx context.Context, key string, longitude, latitude float64, radiusKm float64) ([]redis.GeoLocation, error) {
	return c.client.GeoRadius(ctx, key, longitude, latitude, &redis.GeoRadiusQuery{
		Radius:      radiusKm,
		Unit:        "km",
		WithCoord:   true,
		WithDist:    true,
		WithGeoHash: true,
		Count:       50,
		Sort:        "ASC",
	}).Result()
}

// SetNX sets a key only if it doesn't exist (for locking)
func (c *Client) SetNX(ctx context.Context, key string, value interface{}, ttl time.Duration) (bool, error) {
	return c.client.SetNX(ctx, key, value, ttl).Result()
}

// Client returns the underlying Redis client
func (c *Client) Client() *redis.Client {
	return c.client
}
