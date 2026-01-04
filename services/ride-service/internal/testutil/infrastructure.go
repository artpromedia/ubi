package testutil

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/modules/redis"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestDB wraps a test database container
type TestDB struct {
	Container *postgres.PostgresContainer
	DB        *sql.DB
	DSN       string
}

// TestRedis wraps a test Redis container
type TestRedis struct {
	Container *redis.RedisContainer
	URL       string
}

// TestInfra holds all test infrastructure
type TestInfra struct {
	DB    *TestDB
	Redis *TestRedis
	ctx   context.Context
}

// NewTestInfra creates test infrastructure with database and Redis
func NewTestInfra(t *testing.T) *TestInfra {
	t.Helper()

	ctx := context.Background()

	infra := &TestInfra{
		ctx: ctx,
	}

	// Start PostgreSQL
	pgContainer, err := postgres.Run(ctx,
		"postgres:15-alpine",
		postgres.WithDatabase("ubi_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("Failed to start postgres container: %v", err)
	}

	dsn, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("Failed to get postgres connection string: %v", err)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("Failed to connect to postgres: %v", err)
	}

	infra.DB = &TestDB{
		Container: pgContainer,
		DB:        db,
		DSN:       dsn,
	}

	// Start Redis
	redisContainer, err := redis.Run(ctx,
		"redis:7-alpine",
	)
	if err != nil {
		t.Fatalf("Failed to start redis container: %v", err)
	}

	redisURL, err := redisContainer.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("Failed to get redis connection string: %v", err)
	}

	infra.Redis = &TestRedis{
		Container: redisContainer,
		URL:       redisURL,
	}

	// Register cleanup
	t.Cleanup(func() {
		infra.Cleanup()
	})

	return infra
}

// Cleanup tears down all test infrastructure
func (ti *TestInfra) Cleanup() {
	if ti.DB != nil && ti.DB.DB != nil {
		ti.DB.DB.Close()
	}
	if ti.DB != nil && ti.DB.Container != nil {
		ti.DB.Container.Terminate(ti.ctx)
	}
	if ti.Redis != nil && ti.Redis.Container != nil {
		ti.Redis.Container.Terminate(ti.ctx)
	}
}

// SetupTestEnv sets environment variables for test infrastructure
func (ti *TestInfra) SetupTestEnv(t *testing.T) {
	t.Helper()

	os.Setenv("DATABASE_URL", ti.DB.DSN)
	os.Setenv("REDIS_URL", ti.Redis.URL)
	os.Setenv("ENVIRONMENT", "test")
}

// RunMigrations runs database migrations
func (ti *TestInfra) RunMigrations(t *testing.T, migrationsPath string) {
	t.Helper()

	// Find all migration files
	files, err := filepath.Glob(filepath.Join(migrationsPath, "*.sql"))
	if err != nil {
		t.Fatalf("Failed to find migration files: %v", err)
	}

	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read migration file %s: %v", file, err)
		}

		_, err = ti.DB.DB.Exec(string(content))
		if err != nil {
			t.Fatalf("Failed to execute migration %s: %v", file, err)
		}
	}
}

// ResetDatabase clears all data from database tables
func (ti *TestInfra) ResetDatabase(t *testing.T) {
	t.Helper()

	tables := []string{
		"ride_ratings",
		"ride_locations",
		"rides",
		"driver_locations",
		"drivers",
		"users",
	}

	for _, table := range tables {
		_, err := ti.DB.DB.Exec(fmt.Sprintf("TRUNCATE TABLE %s CASCADE", table))
		if err != nil {
			// Table might not exist, that's ok
			t.Logf("Warning: Failed to truncate table %s: %v", table, err)
		}
	}
}

// WithTransaction runs a test function within a transaction and rolls back after
func WithTransaction(t *testing.T, db *sql.DB, fn func(tx *sql.Tx)) {
	t.Helper()

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("Failed to begin transaction: %v", err)
	}

	defer tx.Rollback()

	fn(tx)
}

// WaitForReady waits for a service to be ready
func WaitForReady(ctx context.Context, check func() error, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if err := check(); err == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return fmt.Errorf("service not ready after %v", timeout)
}
