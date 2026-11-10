/*
 * Database Connection
 */

package database

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

const (
	defaultPoolMaxConns = 8
	defaultPoolMinConns = 2
)

// DB wraps the database pool
type DB struct {
	Pool *pgxpool.Pool
}

func hasPoolParam(databaseURL, key string) bool {
	if u, err := url.Parse(databaseURL); err == nil && u.Scheme != "" {
		return u.Query().Has(key)
	}
	for _, field := range strings.Fields(databaseURL) {
		if strings.HasPrefix(field, key+"=") {
			return true
		}
	}
	return false
}

func parsePoolConfig(databaseURL string) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	if !hasPoolParam(databaseURL, "pool_max_conns") {
		config.MaxConns = defaultPoolMaxConns
	}
	if !hasPoolParam(databaseURL, "pool_min_conns") {
		config.MinConns = defaultPoolMinConns
	}
	if config.MinConns > config.MaxConns {
		config.MinConns = config.MaxConns
	}
	config.MaxConnLifetime = 1 * time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = 30 * time.Second
	return config, nil
}

// New creates a new database connection pool
func New(databaseURL string) (*DB, error) {
	config, err := parsePoolConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, err
	}

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	log.Info().Msg("Connected to database")

	return &DB{Pool: pool}, nil
}

// Close closes the database connection
func (db *DB) Close() {
	db.Pool.Close()
	log.Info().Msg("Database connection closed")
}

// Health checks database health
func (db *DB) Health(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}
