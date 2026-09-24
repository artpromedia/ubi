package testutil

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The delivery tests run against the REAL Prisma schema: every table they
// touch (deliveries, riders, users, delivery_custody, delivery_proofs,
// delivery_proof_uploads, delivery_returns …) and every foreign key on them
// comes from packages/database/prisma/migrations, applied with
// `prisma migrate deploy` — packages/database is the single migration owner.
// There is no handcrafted, permissive test schema anywhere in this service:
// if the database is behind the migrations directory, the harness applies the
// pending migrations with Prisma itself, and if it still is not current (or
// the real sender foreign key is missing) the run fails loudly instead of
// testing against something production does not have.

var (
	migrateOnce sync.Once
	migrateErr  error
)

var migrationDirPattern = regexp.MustCompile(`^\d{14}_[A-Za-z0-9_]+$`)

// repoRoot is the monorepo root, found from this source file's location.
func repoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	// services/delivery-service/internal/testutil/migrations.go -> repo root
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
}

// migrationNames lists the Prisma migration directories, sorted.
func migrationNames() ([]string, error) {
	dir := filepath.Join(repoRoot(), "packages", "database", "prisma", "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read the Prisma migrations directory %s: %w", dir, err)
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() && migrationDirPattern.MatchString(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil, fmt.Errorf("no Prisma migrations found under %s", dir)
	}
	return names, nil
}

// pendingMigrations returns the migrations the database has not applied.
func pendingMigrations(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	names, err := migrationNames()
	if err != nil {
		return nil, err
	}
	applied := map[string]bool{}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public._prisma_migrations') IS NOT NULL`).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		rows, err := pool.Query(ctx, `
			SELECT migration_name FROM _prisma_migrations
			WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
		`)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			applied[name] = true
		}
		rows.Close()
	}
	var pending []string
	for _, name := range names {
		if !applied[name] {
			pending = append(pending, name)
		}
	}
	return pending, nil
}

// prismaURL is the database URL in the form Prisma accepts (it reads
// sslmode itself, so the Go-style URL passes through unchanged).
func prismaURL(dbURL string) string {
	return strings.Replace(dbURL, "postgres://", "postgresql://", 1)
}

// runPrismaMigrateDeploy applies the pending migrations with Prisma — the
// same command CI's unit-go job runs before these tests.
func runPrismaMigrateDeploy(dbURL string) error {
	dir := filepath.Join(repoRoot(), "packages", "database")
	cmd := exec.Command("npx", "--no-install", "prisma", "migrate", "deploy")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "DATABASE_URL="+prismaURL(dbURL))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("prisma migrate deploy failed: %w\n%s", err, out)
	}
	return nil
}

// ensurePrismaMigrated makes sure the test database IS the Prisma schema at
// HEAD, once per test process. It is fatal when that cannot be established.
func ensurePrismaMigrated(t *testing.T, pool *pgxpool.Pool, dbURL string) {
	t.Helper()
	migrateOnce.Do(func() {
		ctx := context.Background()
		pending, err := pendingMigrations(ctx, pool)
		if err != nil {
			migrateErr = err
			return
		}
		if len(pending) > 0 {
			if err := runPrismaMigrateDeploy(dbURL); err != nil {
				migrateErr = fmt.Errorf("the test database is missing %d Prisma migration(s) (%s) and applying them failed: %w",
					len(pending), strings.Join(pending, ", "), err)
				return
			}
			if pending, err = pendingMigrations(ctx, pool); err != nil {
				migrateErr = err
				return
			}
			if len(pending) > 0 {
				migrateErr = fmt.Errorf("prisma migrate deploy ran but %s are still not applied", strings.Join(pending, ", "))
				return
			}
		}
		migrateErr = assertRealSenderForeignKey(ctx, pool)
	})
	if migrateErr != nil {
		t.Fatalf("the delivery tests need the real Prisma schema (run `DATABASE_URL=... pnpm --filter @ubi/database exec prisma migrate deploy`): %v", migrateErr)
	}
}

// assertRealSenderForeignKey proves the constraint the sender-identity fix is
// about is really there: deliveries.sender_id references riders(id).
func assertRealSenderForeignKey(ctx context.Context, pool *pgxpool.Pool) error {
	var referenced string
	err := pool.QueryRow(ctx, `
		SELECT confrelid::regclass::text
		FROM pg_constraint
		WHERE conrelid = 'public.deliveries'::regclass AND contype = 'f'
			AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.deliveries'::regclass AND attname = 'sender_id')]::smallint[]
	`).Scan(&referenced)
	if err != nil {
		return fmt.Errorf("deliveries.sender_id has no foreign key in the test database: %w", err)
	}
	if referenced != "riders" {
		return fmt.Errorf("deliveries.sender_id references %q, not riders", referenced)
	}
	return nil
}
