// Package main —— B3-T5 dispatcher 适配器：把服务端 notification 翻译成 supervisor 操作。
//
// 协议（服务端 → agent）：
//   - bot.start                 —— 启动 bot 子进程；params 可选 { config_version }
//   - bot.stop                  —— 停止 bot 子进程
//   - bot.reload                —— 重新加载 bot 配置（当前为 stop-then-start）
//   - agent.applyConfig (T11.5) —— 落库 bot 配置：写 params JSON 到 tmp 文件后
//     exec bot binary 的 apply-config 子命令把内容 UPSERT 到本地 SQLite
//
// 未知 method：日志 + nil（让 client 安静忽略，不断连）。
//
// 设计约束：
//   - Dispatch 必须快返——内部开 goroutine 异步执行，避免阻塞 client 读循环。
//   - 每个操作独立 goroutine，保证并发下不会互相卡（但 supervisor 内部有 mutex
//     保证幂等/串行化）。
//
// agent.applyConfig 设计要点：
//   - 不内联 SQL：bot 进程持有自己的 storage 实例，agent 从外部写库会有锁竞争
//     （SQLite WAL 也只解决并发读，写仍要 BEGIN）；走 exec 模式让 bot 自己 UPSERT
//     干净分隔职责
//   - tmp 文件路径 /tmp/ebt-apply-<unix>-<pid>.json：失败保留以便 cat 诊断；
//     成功才清理
//   - runner 接口可注入：单测用 fakeRunner 替换 exec.Command
package main

import (
	"encoding/json"
	"fmt"
	stdlog "log"
	"os"
	"os/exec"

	"github.com/anomalyco/energybot-agent/internal/supervisor"
)

// commandRunner 是 agent.applyConfig 用来 exec 子进程的最小接口。
// 生产实现 execRunner 直调 exec.Command(...).Run；测试可替换。
type commandRunner interface {
	Run(bin string, args ...string) error
}

// execRunner 用 os/exec 执行命令并把 stdout/stderr 透传给当前进程。
// 透传是为了让 bot 的 "apply-config ok" sentinel 出现在 agent 日志里，便于运维。
type execRunner struct{}

func (execRunner) Run(bin string, args ...string) error {
	cmd := exec.Command(bin, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// botDispatcher 实现 client.Dispatcher，转发下行指令给 supervisor.Manager。
type botDispatcher struct {
	mgr    *supervisor.Manager
	logger *stdlog.Logger

	// T11.5 字段：agent.applyConfig 路径需要拉起 bot binary 的 apply-config 子命令
	// 留空时 agent.applyConfig 直接拒绝（日志记录，不崩）。
	botBinary string
	runner    commandRunner
}

func newBotDispatcher(mgr *supervisor.Manager, logger *stdlog.Logger) *botDispatcher {
	return &botDispatcher{mgr: mgr, logger: logger, runner: execRunner{}}
}

// Dispatch 不阻塞：拿到 method 后启动独立 goroutine 执行动作。
//
// 本方法只处理 server → agent 的 notification（无 id）。
// agent.applyConfig 保留在这里是**向后兼容**——生产路径会走 DispatchRequest
// （T11.10 升级），但保留此 case 让老版本 nest-api 或未来的 reload 场景仍能工作。
func (d *botDispatcher) Dispatch(method string, params json.RawMessage) error {
	switch method {
	case "bot.start":
		go d.runBotStart(params)
	case "bot.stop":
		go d.runBotStop()
	case "bot.reload":
		go d.runBotReload(params)
	case "agent.applyConfig":
		// 向后兼容：fire-and-forget path；生产用 DispatchRequest
		go func() { _, _ = d.runApplyConfigSync(params) }()
	default:
		d.logger.Printf("dispatch: 未知 method=%s，已忽略", method)
	}
	return nil
}

// DispatchRequest 处理 server → agent 的 request（T11.10）。
//
// 返回 (result any, err error)：result 会被 client.go 序列化成 JSON-RPC response
// 的 result 字段；err != nil 时 client.go 回 -40001 业务错 response。
//
// 目前只支持 agent.applyConfig；其他 method 返 method not found（client 侧
// 会把 message 透传为 -40001 错码 + 描述）。
//
// 与 Dispatch 的关键差异：
//   - Dispatch 是 fire-and-forget，内部 go funcs 异步执行
//   - DispatchRequest **同步阻塞**直到 apply-config exec 完成
//     nest-api callAgent 正是要等这个同步完成的语义
func (d *botDispatcher) DispatchRequest(method string, params json.RawMessage) (any, error) {
	switch method {
	case "agent.applyConfig":
		return d.runApplyConfigSync(params)
	default:
		return nil, fmt.Errorf("method not found: %s", method)
	}
}

type startParams struct {
	ConfigVersion int `json:"config_version,omitempty"`
}

func (d *botDispatcher) runBotStart(raw json.RawMessage) {
	// 解析 config_version（可选）
	var p startParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			d.logger.Printf("dispatch: bot.start params 解析失败: %v", err)
			// 继续尝试 Start，版本号留 0
		}
	}
	if p.ConfigVersion > 0 {
		d.mgr.SetConfigVersion(p.ConfigVersion)
	}
	if err := d.mgr.Start(); err != nil {
		d.logger.Printf("dispatch: bot.start 失败: %v", err)
	} else {
		d.logger.Printf("dispatch: bot.start ok, config_version=%d", p.ConfigVersion)
	}
}

func (d *botDispatcher) runBotStop() {
	if err := d.mgr.Stop(); err != nil {
		d.logger.Printf("dispatch: bot.stop 失败: %v", err)
	} else {
		d.logger.Printf("dispatch: bot.stop ok")
	}
}

func (d *botDispatcher) runBotReload(raw json.RawMessage) {
	var p startParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			d.logger.Printf("dispatch: bot.reload params 解析失败: %v", err)
		}
	}
	if p.ConfigVersion > 0 {
		d.mgr.SetConfigVersion(p.ConfigVersion)
	}
	if err := d.mgr.Reload(); err != nil {
		d.logger.Printf("dispatch: bot.reload 失败: %v", err)
	} else {
		d.logger.Printf("dispatch: bot.reload ok, config_version=%d", p.ConfigVersion)
	}
}

// runApplyConfigSync —— T11.5 + T11.10。
//
// 流程：
//  1. 拒绝未配置 bot binary 的情况（B2 兼容模式）
//  2. 写 params JSON 到 /tmp/ebt-apply-<unix>-<pid>.json
//  3. exec: <botBinary> apply-config --json <tmpPath>
//  4. 成功 → 删 tmp，返 result map[string]any{"ok": true, ...}
//  5. 失败 → 保留 tmp 便于诊断，返 err
//
// 设计权衡：
//   - 不用 stdin 管 json：systemd + exec 复合路径下 stdin 不稳定，且 bot 子命令
//     要支持命令行调试（sre 手工 cat 某个 tmp 再 replay）
//   - tmp 权限 0o600：payload 含 token 明文（T11.6 加密版前）+ payer 私钥明文
//   - 同步返 (any, error) 让 DispatchRequest path 直接得到结果
func (d *botDispatcher) runApplyConfigSync(raw json.RawMessage) (any, error) {
	if d.botBinary == "" {
		d.logger.Printf("dispatch: agent.applyConfig 拒绝：未配置 EBT_BOT_BINARY")
		return nil, fmt.Errorf("agent.applyConfig: bot binary not configured")
	}
	if d.runner == nil {
		d.logger.Printf("dispatch: agent.applyConfig 拒绝：runner 未注入（内部错误）")
		return nil, fmt.Errorf("agent.applyConfig: runner not injected")
	}

	tmp, err := os.CreateTemp("", fmt.Sprintf("ebt-apply-*-%d.json", os.Getpid()))
	if err != nil {
		d.logger.Printf("dispatch: agent.applyConfig 创建 tmp 失败: %v", err)
		return nil, fmt.Errorf("create tmp: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		d.logger.Printf("dispatch: agent.applyConfig 写 tmp %s 失败: %v", tmpPath, err)
		return nil, fmt.Errorf("write tmp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		d.logger.Printf("dispatch: agent.applyConfig 关闭 tmp %s 失败: %v", tmpPath, err)
		return nil, fmt.Errorf("close tmp: %w", err)
	}

	if err := d.runner.Run(d.botBinary, "apply-config", "--json", tmpPath); err != nil {
		// 失败保留 tmp 以便运维 cat/diff
		d.logger.Printf(
			"dispatch: agent.applyConfig 执行失败（保留 %s 供诊断）: %v",
			tmpPath, err,
		)
		return nil, fmt.Errorf("apply-config exec: %w", err)
	}
	if err := os.Remove(tmpPath); err != nil {
		d.logger.Printf("dispatch: agent.applyConfig ok，但清理 tmp %s 失败: %v", tmpPath, err)
	} else {
		d.logger.Printf("dispatch: agent.applyConfig ok")
	}
	return map[string]any{"ok": true}, nil
}
