// Package main 是 energybot-bot 的可执行入口。
//
// B3 架构（T11.3d 重构后）：
//  1. 默认模式 `energybot-bot`：守护进程，长驻 getUpdates + worker 循环
//     - LoadRuntimeFromEnv：DATABASE_URL → 打开 SQLite → 读 platform_config + bot_config
//     - 创建 executor（订单收款检测 + 能量归还）+ telegram.Bot（getUpdates + 消息路由）
//     - 两者各自在 goroutine 跑；任一 err 或收到 SIGINT/SIGTERM 就退出
//
//  2. 子命令 `energybot-bot apply-config --json <path>`：一次性任务
//     - 从 JSON 文件读全量配置（platform + token + welcome + menu + message）
//     - 打开 SQLite → upsert energy_platform_config + bot_config → exit 0
//     - 失败 exit 1；成功 exit 0。由 agent supervisor 在收到 jsonrpc agent.applyConfig 时调用
//
// B3 拆掉的旧逻辑：
//   - internal/botruntime/Manager：B1 multi-agent reconcile，单租户下没必要
//   - telegram.NewAgentBot：B1 多 agent 入口，单租户无此维度
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/anomalyco/energybot-bot/internal/config"
	"github.com/anomalyco/energybot-bot/internal/executor"
	"github.com/anomalyco/energybot-bot/internal/scheduler"
	"github.com/anomalyco/energybot-bot/internal/storage"
	"github.com/anomalyco/energybot-bot/internal/telegram"
)

func main() {
	log.SetOutput(os.Stdout)

	// ---- 子命令分派 ----
	//
	// 设计抉择：不引入 cobra——一个子命令不值得。flag.Args() 手动判 os.Args[1]。
	// 注意 os.Args[0] 是可执行文件名，os.Args[1] 才是第一个 argv。
	if len(os.Args) >= 2 && os.Args[1] == "apply-config" {
		if err := runApplyConfig(os.Args[2:]); err != nil {
			log.Fatalf("apply-config: %v", err)
		}
		return
	}

	if err := runDaemon(); err != nil {
		log.Fatal(err)
	}
}

// runDaemon 默认长驻模式。
func runDaemon() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadRuntimeFromEnv(ctx)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	db, err := storage.Open(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	defer func() { _ = db.Close() }()

	executorService, err := executor.New(cfg, db, log.Default())
	if err != nil {
		return fmt.Errorf("create executor: %w", err)
	}

	worker, err := scheduler.New(cfg.WorkerInterval, executorService.RunOnce)
	if err != nil {
		return fmt.Errorf("create scheduler: %w", err)
	}

	// B3 单租户：直接 NewBot，不走 botruntime.Manager reconcile。
	// 若 token 为空（bot_config 还没 applyConfig），NewBot 会返错——我们选择 fatal 退出，
	// 由 agent supervisor 记录并向主站汇报 bot_last_error，避免进程空转。
	bot, err := telegram.NewBot(cfg, db, log.Default())
	if err != nil {
		return fmt.Errorf("create telegram bot: %w", err)
	}

	log.Println("energybot-bot started (B3 single-tenant)")
	errCh := make(chan error, 2)
	go func() { errCh <- worker.Run(ctx) }()
	go func() { errCh <- bot.Run(ctx) }()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			return fmt.Errorf("run bot: %w", err)
		}
		return nil
	}
}

// runApplyConfig 解析 CLI flag，加载 JSON 配置，写入 SQLite，exit 0/1。
//
// 设计抉择：
//   - 配置走 JSON 文件而非 stdin——systemd + exec 场景下 stdin 行为不稳定；
//     文件可明确传路径（/tmp/apply-{pid}-{timestamp}.json）+ 用完由调用方清
//   - 失败用 err 返，由 main 的 log.Fatalf 打印——保证 exit code=1
//   - 成功明确打印 "apply-config ok"，agent dispatcher 可用它做 sentinel
func runApplyConfig(args []string) error {
	fs := flag.NewFlagSet("apply-config", flag.ContinueOnError)
	jsonPath := fs.String("json", "", "path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *jsonPath == "" {
		return errors.New("--json is required")
	}

	return applyConfigFromFile(*jsonPath)
}
