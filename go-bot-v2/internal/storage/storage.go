// Package storage 是 energybot-bot 的 SQLite 持久层。
//
// B3 设计要点：
//   - 客户机器本地 SQLite，路径 /var/lib/energybot-agent/bot.db（生产），
//     工程内测试用临时文件
//   - 用 mattn/go-sqlite3（cgo），与主站 PostgreSQL schema 同源但去除多租户列
//   - migrations 内嵌（go:embed），Open 时自动应用、幂等
//   - WAL 模式 + busy_timeout=5s 适配 agent supervisor 短暂占用 DB 写时的锁竞争
package storage

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open 打开 SQLite 文件并应用所有 migrations。
//
// path 为 .db 文件绝对路径；不存在会自动创建（含父目录需调用方保证）。
//
// 连接串里的关键参数：
//
//	_busy_timeout=5000   写锁等待 5s（agent supervisor reload 配置时短暂占用）
//	_journal_mode=WAL    并发读写不互斥
//	_foreign_keys=on     启用外键约束
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("%s?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open sqlite3: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	if err := applyMigrations(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply migrations: %w", err)
	}

	return db, nil
}

// applyMigrations 把 migrations/*.sql 按文件名排序后顺序执行。
//
// 简单实现（B3 阶段够用）：每次 Open 都全量 exec，依赖 SQL 内部 IF NOT EXISTS / OR IGNORE
// 保证幂等。后续若需要严格版本管理再引入 schema_migrations 表。
//
// 特殊处理：SQLite 的 `ALTER TABLE ... ADD COLUMN` 重复执行会报
// `duplicate column name: xxx`——这是 SQLite 3.35 之前唯一的提示方式，没有
// IF NOT EXISTS。我们**宽容吞掉**此类错，使 ADD COLUMN 型 migration 天然幂等。
// 代价：如果 migration 里 **真正**的 schema bug 触发了此错，会被静默——但实际
// 工程里 ADD COLUMN 的列名冲突几乎都是因为再跑一次，不是 bug 来源。
func applyMigrations(db *sql.DB) error {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		data, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if _, err := db.Exec(string(data)); err != nil {
			if isDuplicateColumnErr(err) {
				// 已经存在的列——视作幂等成功
				continue
			}
			return fmt.Errorf("exec migration %s: %w", name, err)
		}
	}
	return nil
}

// isDuplicateColumnErr 判断是不是 SQLite 重复添加列的错。
//
// mattn/go-sqlite3 的错误信息格式：`duplicate column name: platform_receive_address`
// 没有稳定的错误 code 可用（sqlite3.Error.ExtendedCode 对 ADD COLUMN 不区分），
// 只能做字符串匹配。
func isDuplicateColumnErr(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "duplicate column name")
}
