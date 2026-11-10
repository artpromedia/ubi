package database

import "testing"

func TestParsePoolConfigHonoursExplicitPoolMaxConns(t *testing.T) {
	defaultCfg, err := parsePoolConfig("postgresql://ubi:secret@localhost:5432/ubi_production?sslmode=disable")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if defaultCfg.MaxConns != 8 || defaultCfg.MinConns != 2 {
		t.Fatalf("expected default MaxConns=8 MinConns=2, got MaxConns=%d MinConns=%d", defaultCfg.MaxConns, defaultCfg.MinConns)
	}

	explicitCfg, err := parsePoolConfig("postgresql://ubi:secret@localhost:5432/ubi_production?sslmode=disable&pool_max_conns=14&pool_min_conns=4")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if explicitCfg.MaxConns != 14 || explicitCfg.MinConns != 4 {
		t.Fatalf("expected explicit MaxConns=14 MinConns=4, got MaxConns=%d MinConns=%d", explicitCfg.MaxConns, explicitCfg.MinConns)
	}

	clampedCfg, err := parsePoolConfig("postgresql://ubi:secret@localhost:5432/ubi_production?sslmode=disable&pool_max_conns=1")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if clampedCfg.MaxConns != 1 || clampedCfg.MinConns != 1 {
		t.Fatalf("expected MinConns clamped to MaxConns=1, got MaxConns=%d MinConns=%d", clampedCfg.MaxConns, clampedCfg.MinConns)
	}
}
