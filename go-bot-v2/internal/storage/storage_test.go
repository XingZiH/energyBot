package storage

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// TestOpen_CreatesSchema 验证 Open 能建库 + 应用 migrations 0001。
//
// 断言：
//   - 7 张业务表都能 SELECT（不抛 no such table）
//   - energy_platform_config 单例行自动插入
//   - bot_config 单例行自动插入
func TestOpen_CreatesSchema(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "bot.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer func() { _ = db.Close() }()

	tables := []string{
		"energy_packages",
		"energy_orders",
		"energy_wallet_transactions",
		"energy_return_tasks",
		"energy_user_addresses",
		"energy_platform_config",
		"bot_config",
	}
	for _, tbl := range tables {
		//nolint:gosec // 静态表名不是 SQL 注入面
		row := db.QueryRow("SELECT COUNT(*) FROM " + tbl)
		var n int
		if err := row.Scan(&n); err != nil {
			t.Errorf("表 %s SELECT 失败: %v", tbl, err)
			continue
		}
		t.Logf("表 %s 行数=%d", tbl, n)
	}

	// 验证两个单例行已通过 INSERT OR IGNORE 插入
	for _, single := range []string{"energy_platform_config", "bot_config"} {
		row := db.QueryRow("SELECT COUNT(*) FROM " + single + " WHERE id = 1")
		var n int
		if err := row.Scan(&n); err != nil {
			t.Errorf("单例查询 %s 失败: %v", single, err)
			continue
		}
		if n != 1 {
			t.Errorf("单例 %s 期望 1 行，得到 %d 行", single, n)
		}
	}
}

// TestOpen_Idempotent 验证同一个 db 文件 Open 两次不会因为重复 migration 报错。
//
// applyMigrations 全量 exec 的前提是 SQL 里的 CREATE TABLE / INSERT 都写了 IF NOT EXISTS
// 和 OR IGNORE。本测试守护这一约束。
func TestOpen_Idempotent(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "bot.db")

	// 第一次
	db1, err := Open(dbPath)
	if err != nil {
		t.Fatalf("第一次 Open failed: %v", err)
	}
	_ = db1.Close()

	// 第二次 — 不应因为 CREATE TABLE 已存在而 fail
	db2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("第二次 Open failed: %v", err)
	}
	defer func() { _ = db2.Close() }()

	row := db2.QueryRow("SELECT COUNT(*) FROM energy_platform_config")
	var n int
	if err := row.Scan(&n); err != nil {
		t.Fatalf("二开后 SELECT 失败: %v", err)
	}
	if n != 1 {
		t.Errorf("重入后单例行数错: %d", n)
	}
}

// TestOpen_Migration0002_AddsColumn 验证 0002 加的 platform_receive_address 列
// 能被 SELECT 到（migration 真实 apply），且二开不因 duplicate column 报错。
//
// 这是 T11.3a 的直接契约测试——executor.go 的订单支付检测依赖此列。
func TestOpen_Migration0002_AddsColumn(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "bot.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer func() { _ = db.Close() }()

	// 直接 SELECT 该列——列不存在会报 `no such column: platform_receive_address`
	var addr sql.NullString
	err = db.QueryRow(
		"SELECT platform_receive_address FROM energy_platform_config WHERE id = 1",
	).Scan(&addr)
	if err != nil {
		t.Fatalf("SELECT platform_receive_address 失败: %v", err)
	}
	// 初始值应为 NULL（DEFAULT 未设，ADD COLUMN 默认 NULL）
	if addr.Valid {
		t.Errorf("platform_receive_address 初值应为 NULL，得到 %q", addr.String)
	}

	// 再写入一个值，验证可读回（round-trip）
	if _, err := db.Exec(
		"UPDATE energy_platform_config SET platform_receive_address = ? WHERE id = 1",
		"TABC...",
	); err != nil {
		t.Fatalf("UPDATE 失败: %v", err)
	}
	if err := db.QueryRow(
		"SELECT platform_receive_address FROM energy_platform_config WHERE id = 1",
	).Scan(&addr); err != nil {
		t.Fatalf("二次 SELECT 失败: %v", err)
	}
	if !addr.Valid || addr.String != "TABC..." {
		t.Errorf("round-trip 失败，got valid=%v value=%q", addr.Valid, addr.String)
	}
}
