// Package main 是 energybot-bot 的可执行入口。
//
// B3 阶段最小骨架：
//   - 依赖 mattn/go-sqlite3（cgo）验证交叉编译链路
//   - 当前仅打开/关闭 SQLite 连接，证明二进制能跑
//   - 后续 T1/T2 把 /go-bot/internal/ 的业务代码搬过来
//
// 启动：
//
//	energybot-bot --db=/var/lib/energybot-agent/bot.db
//
// 退出码：
//
//	0 正常退出
//	1 运行期错误
//	2 启动期错误（DB 打不开、配置缺失）
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	_ "github.com/mattn/go-sqlite3"
)

// Version 由 ldflags 注入。
var Version = "dev"

func main() {
	dbPath := flag.String("db", "/var/lib/energybot-agent/bot.db", "SQLite 数据库路径")
	showVersion := flag.Bool("version", false, "打印版本并退出")
	flag.Parse()

	if *showVersion {
		fmt.Println(Version)
		return
	}

	log.Printf("energybot-bot %s starting (db=%s)", Version, *dbPath)

	// ---- 1. 打开 SQLite ----
	db, err := sql.Open("sqlite3", *dbPath+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: open sqlite: %v\n", err)
		os.Exit(2)
	}
	defer func() { _ = db.Close() }()

	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: ping sqlite: %v\n", err)
		os.Exit(2)
	}
	log.Printf("sqlite ready")

	// ---- 2. 等信号 ----
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("received %s, shutting down", sig)
}
