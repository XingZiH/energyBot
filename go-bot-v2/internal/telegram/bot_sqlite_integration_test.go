// +build integration_sqlite

package telegram

// 该文件用 build tag 隔离，默认 go test 不跑，避免 CI 需要 cgo。
// 本地验证跑：go test -tags integration_sqlite ./internal/telegram/...
//
// 目的：用真 SQLite DB 验证 T2.3 方言改造 + T2.4 单 agent 改造后，
//      bot.go 内所有原生 SQL 语句都能在客户机 SQLite schema 上通过。
//      只测 SQL 语法/语义正确性，不测 Telegram HTTP 交互。

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/anomalyco/energybot-bot/internal/config"
	"github.com/anomalyco/energybot-bot/internal/storage"
)

func setupTestBot(t *testing.T) *Bot {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "bot.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	bot, err := NewBot(config.Config{
		TronAPIBaseURL:          "https://api.trongrid.io",
		TelegramBotToken:        "dummy-token-for-integration-test",
		TelegramPollingInterval: 2 * time.Second,
		OrderPaymentTTL:         10 * time.Minute,
	}, db, nil)
	if err != nil {
		t.Fatalf("NewBot: %v", err)
	}
	return bot
}

// 用一份套餐种子数据（客户机 user_package + platform_package_id 指向 admin 镜像）
func seedPackage(t *testing.T, bot *Bot) int {
	t.Helper()
	ctx := context.Background()
	// 先插入一个 admin_package 作为 base（主站镜像）
	var baseID int
	err := bot.db.QueryRowContext(ctx, `
insert into energy_packages (
  package_kind, package_name, energy_amount, duration_hours,
  price_sun, status, sort_order
) values ('admin_package', '基础套餐', 65000, 1, '5000000', 'active', 0)
returning id`).Scan(&baseID)
	// SQLite 不支持 RETURNING 直到 3.35，但我们使用 LastInsertId 备用
	if err != nil {
		// 退回 LastInsertId
		res, execErr := bot.db.ExecContext(ctx, `
insert into energy_packages (
  package_kind, package_name, energy_amount, duration_hours,
  price_sun, status, sort_order
) values ('admin_package', '基础套餐', 65000, 1, '5000000', 'active', 0)`)
		if execErr != nil {
			t.Fatalf("seed admin_package: %v", execErr)
		}
		lid, _ := res.LastInsertId()
		baseID = int(lid)
	}

	res, err := bot.db.ExecContext(ctx, `
insert into energy_packages (
  platform_package_id, package_kind, package_name, energy_amount, duration_hours,
  price_sun, status, sort_order
) values (?1, 'user_package', '我家套餐', 65000, 1, '5500000', 'active', 1)`, baseID)
	if err != nil {
		t.Fatalf("seed user_package: %v", err)
	}
	lid, _ := res.LastInsertId()
	return int(lid)
}

// listPackages 应能查到 user_package
func TestSQLiteIntegration_ListPackages(t *testing.T) {
	bot := setupTestBot(t)
	seedPackage(t, bot)

	packages, err := bot.listPackages(context.Background())
	if err != nil {
		t.Fatalf("listPackages: %v", err)
	}
	if len(packages) == 0 {
		t.Fatal("expected at least 1 package")
	}
	pkg := packages[0]
	if pkg.PackageName != "我家套餐" {
		t.Errorf("package name = %q, want 我家套餐", pkg.PackageName)
	}
	if pkg.EnergyAmount != 65000 {
		t.Errorf("energy amount = %d, want 65000", pkg.EnergyAmount)
	}
}

// findPackage 按 id 查
func TestSQLiteIntegration_FindPackage(t *testing.T) {
	bot := setupTestBot(t)
	id := seedPackage(t, bot)

	pkg, err := bot.findPackage(context.Background(), id)
	if err != nil {
		t.Fatalf("findPackage: %v", err)
	}
	if pkg.ID != id {
		t.Errorf("id = %d, want %d", pkg.ID, id)
	}
}

// createUserAddress + listUserAddresses + findUserAddress + updateUserAddress
func TestSQLiteIntegration_UserAddresses_CRUD(t *testing.T) {
	bot := setupTestBot(t)
	ctx := context.Background()
	chatID := int64(12345)

	// create
	if err := bot.createUserAddress(ctx, chatID, "TRXaddr1"); err != nil {
		t.Fatalf("createUserAddress: %v", err)
	}
	if err := bot.createUserAddress(ctx, chatID, "TRXaddr2"); err != nil {
		t.Fatalf("createUserAddress 2: %v", err)
	}

	// list
	addrs, err := bot.listUserAddresses(ctx, chatID)
	if err != nil {
		t.Fatalf("listUserAddresses: %v", err)
	}
	if len(addrs) != 2 {
		t.Fatalf("addresses count = %d, want 2", len(addrs))
	}

	// find
	first := addrs[0]
	found, err := bot.findUserAddress(ctx, chatID, first.ID)
	if err != nil {
		t.Fatalf("findUserAddress: %v", err)
	}
	if found.Address != first.Address {
		t.Errorf("found = %q, want %q", found.Address, first.Address)
	}

	// update
	if err := bot.updateUserAddress(ctx, chatID, first.ID, "TRXnewAddr"); err != nil {
		t.Fatalf("updateUserAddress: %v", err)
	}
	updated, _ := bot.findUserAddress(ctx, chatID, first.ID)
	if updated.Address != "TRXnewAddr" {
		t.Errorf("updated address = %q, want TRXnewAddr", updated.Address)
	}

	// delete
	if err := bot.deleteUserAddress(ctx, chatID, first.ID); err != nil {
		t.Fatalf("deleteUserAddress: %v", err)
	}
	addrs2, _ := bot.listUserAddresses(ctx, chatID)
	if len(addrs2) != 1 {
		t.Errorf("after delete count = %d, want 1", len(addrs2))
	}
}

// loadDesignerConfig 读 bot_config 单例
func TestSQLiteIntegration_LoadDesignerConfig(t *testing.T) {
	bot := setupTestBot(t)
	ctx := context.Background()

	// 更新 bot_config 单例
	_, err := bot.db.ExecContext(ctx, `
update bot_config
set welcome_text = '欢迎',
    message_config = '{}',
    menu_config = '[]',
    applied_at = ?1
where id = 1`, time.Now())
	if err != nil {
		t.Fatalf("update bot_config: %v", err)
	}

	cfg, err := bot.loadDesignerConfig(ctx)
	if err != nil {
		t.Fatalf("loadDesignerConfig: %v", err)
	}
	if cfg.WelcomeText != "欢迎" {
		t.Errorf("welcome = %q, want 欢迎", cfg.WelcomeText)
	}
}
