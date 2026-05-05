package config

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func LoadRuntimeFromEnv(ctx context.Context) (Config, error) {
	env := FromOSEnviron()
	databaseURL := normalizeDatabaseURL(envOrDefault(env, "DATABASE_URL", ""))
	if databaseURL == "" {
		return Config{}, fmt.Errorf("missing required config: DATABASE_URL")
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return Config{}, fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()

	return LoadFromDatabase(ctx, env, pgxStore{pool: pool})
}

type pgxStore struct {
	pool *pgxpool.Pool
}

func (s pgxStore) QueryRow(ctx context.Context, sql string, args ...any) RowScanner {
	return s.pool.QueryRow(ctx, sql, args...)
}
