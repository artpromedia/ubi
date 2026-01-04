/*
 * Database Connection
 */

package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// DB wraps the database pool
type DB struct {
	Pool *pgxpool.Pool
}

// New creates a new database connection pool
func New(databaseURL string) (*DB, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	// Pool configuration
	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = 1 * time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = 30 * time.Second

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
