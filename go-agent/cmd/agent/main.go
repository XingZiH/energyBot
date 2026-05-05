// Package main 是 energybot-agent 的可执行入口。
//
// 启动流程（严格按 D 系列决策实现）：
//  1. 从 env 读配置（config.Load）。失败 → exit 2。
//  2. 构造 zap 日志 + 适配成 stdlib logger 给 client/heartbeat。
//  3. 构造 collector → client → heartbeat。
//  4. 绑定 SIGINT / SIGTERM 到 ctx。
//  5. 先起 heartbeat（goroutine），再跑 client.Run（主线程阻塞）。
//  6. cli.Run 返 → 等 heartbeat 优雅退出（最长 2s）→ 按 err 给 exit code。
//
// 退出码约定：
//
//	0    正常退出（SIGINT/SIGTERM）
//	1    client 运行期错误
//	2    启动期错误（配置/构造）
//	42   terminal close（4001/4003）— 由 client.ExitFunc=os.Exit 直接触发
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/anomalyco/energybot-agent/internal/botinfo"
	"github.com/anomalyco/energybot-agent/internal/client"
	"github.com/anomalyco/energybot-agent/internal/config"
	"github.com/anomalyco/energybot-agent/internal/host"
	ebtlog "github.com/anomalyco/energybot-agent/internal/log"
	"github.com/anomalyco/energybot-agent/internal/supervisor"
)

// Version 由 ldflags 注入（`-X 'main.Version=x.y.z'`），dev 是本地构建默认值。
var Version = "dev"

func main() {
	// ---- 1. Config ----
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(2)
	}

	// ---- 2. Log ----
	zl := ebtlog.New(ebtlog.Level(cfg.LogLevel))
	// Sync 在 stderr 上偶有 "invalid argument"，忽略即可。
	defer func() { _ = zl.Sync() }()
	ebtlog.SetStderrHook()

	agentLog := ebtlog.StdLogger(zl, "agent")
	agentLog.Printf(
		"energybot-agent %s starting (api=%s, level=%s)",
		Version, cfg.APIURL, cfg.LogLevel,
	)

	// ---- 3. Collector / Supervisor / Client / Heartbeat ----
	collector := host.NewGopsutil()

	// Supervisor（B3-T5）：管理 energybot-bot 子进程生命周期。
	// 若未配置 EBT_BOT_BINARY，则不构造 Manager，走 NoopProvider + 无 Dispatcher
	// 的 B2 兼容路径（agent 只做心跳，不管理 bot）。
	var (
		botProvider  botinfo.Provider = botinfo.NoopProvider{}
		dispatcher   client.Dispatcher
		botMgr       *supervisor.Manager
	)
	if cfg.BotBinary != "" {
		supLogger := ebtlog.StdLogger(zl, "supervisor")
		launcher := supervisor.NewExecLauncher(supLogger)
		botMgr = supervisor.NewManager(launcher, cfg.BotBinary, nil, supLogger)
		botProvider = botMgr
		dispatcher = newBotDispatcher(botMgr, ebtlog.StdLogger(zl, "dispatcher"))
		agentLog.Printf("supervisor: 启用 bot 管理，binary=%s", cfg.BotBinary)
	} else {
		agentLog.Printf("supervisor: 未配置 EBT_BOT_BINARY，跳过 bot 管理（B2 兼容模式）")
	}

	cli, err := client.New(client.Config{
		APIURL:        cfg.APIURL,
		LicenseKey:    cfg.LicenseKey,
		LicenseSecret: cfg.LicenseSecret,
		AgentVersion:  Version,
		Collector:     collector,
		Logger:        ebtlog.StdLogger(zl, "client"),
		Dispatcher:    dispatcher, // nil 时 client 静默丢弃下行消息
		// ExitFunc 不设，默认 os.Exit；terminal close 时直接 42。
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(2)
	}

	hb, err := client.NewHeartbeat(client.HeartbeatConfig{
		Sender:      cli,
		Collector:   collector,
		BotProvider: botProvider,
		Logger:      ebtlog.StdLogger(zl, "heartbeat"),
		// Interval 不设，默认 30s。
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: %v\n", err)
		os.Exit(2)
	}

	// ---- 4. Signal ----
	ctx, stop := signal.NotifyContext(
		context.Background(),
		syscall.SIGTERM, syscall.SIGINT,
	)
	defer stop()

	// ---- 5. 并发跑 heartbeat + client ----
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		// hb.Run 只返 nil（设计如此），故忽略返值。
		_ = hb.Run(ctx)
	}()

	runErr := cli.Run(ctx)

	// ---- 6. 优雅等待 heartbeat 退出（ctx 应已 cancel） ----
	stop() // 主动取消 signal 订阅，确保后续无泄漏。

	// B3-T5：先 Stop bot 子进程，避免 agent 退出后 bot 变孤儿。
	if botMgr != nil {
		if err := botMgr.Stop(); err != nil {
			agentLog.Printf("supervisor: Stop 失败: %v", err)
		}
	}

	waitDone := make(chan struct{})
	go func() {
		wg.Wait()
		close(waitDone)
	}()
	select {
	case <-waitDone:
	case <-time.After(2 * time.Second):
		agentLog.Printf("heartbeat did not exit in 2s, proceeding")
	}

	// ---- 7. Exit code ----
	if runErr != nil {
		agentLog.Printf("client exited with error: %v", runErr)
		os.Exit(1)
	}
	agentLog.Print("agent exited cleanly")
}
