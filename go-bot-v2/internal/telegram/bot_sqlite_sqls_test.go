// +build integration_sqlite

package telegram

// bot.go 全体 SQL 的 PREPARE 验证：SQLite 能 prepare 即语法 + schema 正确。
// 不跑真查询（Telegram/Tron 依赖太重），只验证 SQL 本身在 SQLite 上合法。

import (
	"path/filepath"
	"testing"

	"github.com/anomalyco/energybot-bot/internal/storage"
)

// 核心 SQL 语句白盒枚举：从 bot.go 里抽出所有独立 SQL 做 PREPARE 检查。
// 若 SQL 有方言残留或引用不存在列/表，PREPARE 会报错。
func TestSQLiteIntegration_AllBotSQLsCompile(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bot.db")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	defer db.Close()

	sqls := []struct {
		name string
		sql  string
	}{
		{"listPackages", `
select p.id,
       p.package_name,
       coalesce(base.energy_amount, p.energy_amount),
       coalesce(base.duration_hours, p.duration_hours),
       p.price_sun,
       coalesce(p.idle_price_sun, p.price_sun),
       coalesce(p.busy_price_sun, p.price_sun)
from energy_packages p
left join energy_packages base on base.id = p.platform_package_id and base.deleted_at is null
where p.status = 'active'
  and p.deleted_at is null
  and p.package_kind = 'user_package'
  and coalesce(base.status, 'active') = 'active'
order by p.sort_order asc, p.id asc`},
		{"findPackage", `
select p.id,
       p.package_name,
       coalesce(base.energy_amount, p.energy_amount),
       coalesce(base.duration_hours, p.duration_hours),
       p.price_sun,
       coalesce(p.idle_price_sun, p.price_sun),
       coalesce(p.busy_price_sun, p.price_sun)
from energy_packages p
left join energy_packages base on base.id = p.platform_package_id and base.deleted_at is null
where p.id = ?1
  and p.status = 'active'
  and p.deleted_at is null
  and p.package_kind = 'user_package'
  and coalesce(base.status, 'active') = 'active'`},
		{"listUserAddresses", `
select id, telegram_chat_id, label, address, is_default
from energy_user_addresses
where telegram_chat_id = ?1
  and status = 'active'
  and deleted_at is null
order by is_default desc, id asc`},
		{"findUserAddress", `
select id, telegram_chat_id, label, address, is_default
from energy_user_addresses
where id = ?1
  and telegram_chat_id = ?2
  and status = 'active'
  and deleted_at is null`},
		{"createUserAddress", `
insert into energy_user_addresses (
  telegram_chat_id, label, address, is_default, status, created_at, updated_at
) values (?1, ?2, ?3, ?4, 'active', ?5, ?5)`},
		{"updateUserAddress", `
update energy_user_addresses
set address = ?1, updated_at = ?2
where id = ?3
  and telegram_chat_id = ?4
  and status = 'active'
  and deleted_at is null`},
		{"deleteUserAddress", `
update energy_user_addresses
set status = 'deleted', deleted_at = ?1, updated_at = ?1, is_default = 0
where id = ?2
  and telegram_chat_id = ?3
  and status = 'active'
  and deleted_at is null`},
		{"setDefaultAddressClear", `
update energy_user_addresses
set is_default = case when id = ?1 then 1 else 0 end,
    updated_at = ?2
where telegram_chat_id = ?3
  and status = 'active'
  and deleted_at is null`},
		{"loadDesignerConfig", `
select coalesce(welcome_text, ''), coalesce(message_config, ''), coalesce(menu_config, '')
from bot_config
where id = 1
limit 1`},
		{"insertOrder", `
insert into energy_orders (
  order_no, package_id, package_name, buyer_address, receiver_address,
  energy_amount, duration_hours, payment_amount_sun, payment_expires_at,
  status, return_status, energy_provider, remark, created_at, updated_at
) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 'none', ?10, ?11, ?12, ?12)`},
	}

	for _, s := range sqls {
		stmt, err := db.Prepare(s.sql)
		if err != nil {
			t.Errorf("%s prepare failed: %v", s.name, err)
			continue
		}
		_ = stmt.Close()
	}
}
