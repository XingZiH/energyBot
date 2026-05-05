// Package botinfo 描述 energybot-bot 子进程在 agent 心跳中上报的运行信息。
//
// B3 设计要点：
//   - agent supervisor（T5 实现）spawn energybot-bot 后，掌握 pid / startedAt /
//     configVersion 等信息；心跳 tick 时通过 Provider 接口读取当前值。
//   - BotInfo 字段直接映射 wire 协议 agent.heartbeat.params.bot.*，与主站
//     nest-api 侧 AgentHeartbeatParamsSchema 的 bot 扩展字段严格对齐。
//   - Provider.Snapshot() 必须非阻塞（在心跳 tick 的 hot path），supervisor
//     内部应用 atomic/mutex 缓存最新值。
//   - NoopProvider 是默认实现，返回 BotStatusUnknown（或更明确的 not_managed），
//     让心跳 payload 里的 bot 字段变成 nil 或 status-only，保证 T3 阶段可以单独
//     上线而不需要等 T5 supervisor。
package botinfo

import "time"

// BotStatus 枚举 bot 进程运行状态，与 nest-api 的 AgentSchema 保持同一字符串。
type BotStatus string

const (
	// BotStatusUnknown agent 未管理 bot（如 supervisor 未启动或平台配置禁用）。
	BotStatusUnknown BotStatus = "unknown"
	// BotStatusStopped agent supervisor 已接管但 bot 进程未启动。
	BotStatusStopped BotStatus = "stopped"
	// BotStatusStarting bot 进程刚刚 spawn，还未进入稳定运行。
	BotStatusStarting BotStatus = "starting"
	// BotStatusRunning bot 进程运行中，Telegram long-poll 正常。
	BotStatusRunning BotStatus = "running"
	// BotStatusError bot 进程退出（crash 或 token 失效等），supervisor 可能正在 backoff。
	BotStatusError BotStatus = "error"
)

// BotInfo 是 agent supervisor 向心跳报告的 bot 子进程当前状态快照。
//
// wire 字段命名约定（JSON 序列化时）：
//
//	Status          → status（BotStatus 字符串）
//	PID             → pid（int；未启动时 0）
//	UptimeSeconds   → uptime_seconds（int；未启动时 0）
//	ConfigVersion   → config_version（int；bot_config.config_version，0 表示未下发过）
//	LastTGPollAt    → last_tg_poll_at（Unix 毫秒；0 表示尚无记录）
//	LastError       → last_error（可选，仅当 Status=error 时非空）
//
// 空 / 零值字段在序列化时应被省略（omitempty），以保持 wire payload 精简
// 并兼容未接入 T5 的旧版本 agent。
type BotInfo struct {
	Status         BotStatus `json:"status"`
	PID            int       `json:"pid,omitempty"`
	UptimeSeconds  int64     `json:"uptime_seconds,omitempty"`
	ConfigVersion  int       `json:"config_version,omitempty"`
	LastTGPollAt   int64     `json:"last_tg_poll_at,omitempty"`
	LastError      string    `json:"last_error,omitempty"`
}

// Provider 被 heartbeat 调用以获取当前 bot 信息。
//
// 实现方必须做到：
//   - 非阻塞、幂等、无副作用。
//   - 返回 (nil, nil) 表示「本 agent 不管理 bot」，心跳 payload 将完全省略 bot 字段。
//   - 返回 (&BotInfo{Status:Unknown}, nil) 表示「agent 管理 bot 但当前状态未知」。
type Provider interface {
	Snapshot() (*BotInfo, error)
}

// NoopProvider 是 T3 阶段的占位实现：永远返回 (nil, nil)，心跳 payload 不带 bot 字段。
//
// T5 supervisor 接入后，cmd/agent/main.go 会用真实的 supervisor.Provider 替换此默认值。
type NoopProvider struct{}

// Snapshot 返回 (nil, nil) —— 表示 agent 不管理 bot，心跳省略 bot 字段。
func (NoopProvider) Snapshot() (*BotInfo, error) {
	return nil, nil
}

// Now 返回当前时间戳（Unix 毫秒），仅供实现方填充 LastTGPollAt 时使用。
// 抽成函数便于测试时注入假时钟（虽然 T3 阶段暂未使用）。
func Now() int64 {
	return time.Now().UnixMilli()
}
