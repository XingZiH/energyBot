// Package main —— B3-T5 dispatcher 适配器：把服务端 notification 翻译成 supervisor 操作。
//
// 协议（服务端 → agent）：
//   - bot.start                 —— 启动 bot 子进程；params 可选 { config_version }
//   - bot.stop                  —— 停止 bot 子进程
//   - bot.reload                —— 重新加载 bot 配置（当前为 stop-then-start）
//
// 未知 method：日志 + nil（让 client 安静忽略，不断连）。
//
// 设计约束：
//   - Dispatch 必须快返——内部开 goroutine 异步执行，避免阻塞 client 读循环。
//   - 每个操作独立 goroutine，保证并发下不会互相卡（但 supervisor 内部有 mutex
//     保证幂等/串行化）。
package main

import (
	"encoding/json"
	stdlog "log"

	"github.com/anomalyco/energybot-agent/internal/supervisor"
)

// botDispatcher 实现 client.Dispatcher，转发下行指令给 supervisor.Manager。
type botDispatcher struct {
	mgr    *supervisor.Manager
	logger *stdlog.Logger
}

func newBotDispatcher(mgr *supervisor.Manager, logger *stdlog.Logger) *botDispatcher {
	return &botDispatcher{mgr: mgr, logger: logger}
}

// Dispatch 不阻塞：拿到 method 后启动独立 goroutine 执行动作。
func (d *botDispatcher) Dispatch(method string, params json.RawMessage) error {
	switch method {
	case "bot.start":
		go d.runBotStart(params)
	case "bot.stop":
		go d.runBotStop()
	case "bot.reload":
		go d.runBotReload(params)
	default:
		d.logger.Printf("dispatch: 未知 method=%s，已忽略", method)
	}
	return nil
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
