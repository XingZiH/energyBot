package config

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/anomalyco/energybot-bot/internal/storage"
)

// LoadRuntimeFromEnv 从 OS env 读 DATABASE_URL（在 B3 客户端语义下是 SQLite 文件路径），
// 打开 SQLite，再从 energy_platform_config 表读运行时配置组装 Config。
//
// B1 版本是 *pgxpool.Pool，B3 切到 *sql.DB（mattn/go-sqlite3）。
func LoadRuntimeFromEnv(ctx context.Context) (Config, error) {
	env := FromOSEnviron()
	databaseURL := normalizeDatabaseURL(envOrDefault(env, "DATABASE_URL", ""))
	if databaseURL == "" {
		return Config{}, fmt.Errorf("missing required config: DATABASE_URL")
	}

	db, err := storage.Open(databaseURL)
	if err != nil {
		return Config{}, fmt.Errorf("open sqlite: %w", err)
	}
	defer func() { _ = db.Close() }()

	return LoadFromDatabase(ctx, env, sqlStore{db: db})
}

// sqlStore 把 *sql.DB 适配成 QueryRower 接口。
//
// 与 pgx.QueryRow 的 ABI 差异：
//   - sql.QueryRowContext 返回 *sql.Row（有 Scan 方法），自然实现 RowScanner
//   - sql.Row.Err() 在 Scan 时一并暴露错误，对调用方语义一致
type sqlStore struct {
	db *sql.DB
}

func (s sqlStore) QueryRow(ctx context.Context, query string, args ...any) RowScanner {
	return s.db.QueryRowContext(ctx, query, args...)
}
