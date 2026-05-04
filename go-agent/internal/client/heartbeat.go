package client

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/anomalyco/energybot-agent/internal/host"
)

// Heartbeat 周期采集主机指标并投递给 Client.SendHeartbeat。
//
// 生命周期：
//   - Run(ctx) 阻塞直到 ctx 取消，取消时返 nil
//   - Sample 失败：log + skip，不中断循环
//   - SendHeartbeat 返 ErrSendBufferFull：log + 继续，不中断循环
//   - 首次 tick 在等满一个 interval 后才发（不立即发）
type Heartbeat struct {
	sender    heartbeatSender
	collector host.Collector
	interval  time.Duration
	logger    *log.Logger
}

// heartbeatSender 仅为测试时注入 fake 留的最小接口，生产即 *Client。
//
// Ready() 返 client 的 ready 信号（首次 hello OK 后被 close）。heartbeat
// 启动后先阻塞等待 ready，避免在 client 尚未进入 ready 时发心跳造成
// ErrSendBufferFull 日志噪声。
type heartbeatSender interface {
	SendHeartbeat(host.Metrics) error
	Ready() <-chan struct{}
}

// HeartbeatConfig 是 Heartbeat 构造参数。
type HeartbeatConfig struct {
	// Sender 必填，生产传 *Client。
	Sender heartbeatSender
	// Collector 必填。
	Collector host.Collector
	// Interval 可选，默认 30s。
	Interval time.Duration
	// Logger 可选，默认 log.Default()。
	Logger *log.Logger
}

// NewHeartbeat 校验参数后返 Heartbeat。Sender/Collector 必填；
// Interval <= 0 视为未设，走默认 30s。
func NewHeartbeat(cfg HeartbeatConfig) (*Heartbeat, error) {
	if cfg.Sender == nil {
		return nil, errors.New("heartbeat: Sender is required")
	}
	if cfg.Collector == nil {
		return nil, errors.New("heartbeat: Collector is required")
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.Default()
	}
	return &Heartbeat{
		sender:    cfg.Sender,
		collector: cfg.Collector,
		interval:  interval,
		logger:    logger,
	}, nil
}

// Run 按 interval 周期采集并发送 heartbeat。ctx 取消时返 nil。
//
// 进入 tick loop 前先等 sender.Ready()：这是 Client 首次 hello OK 的信号。
// 如此 heartbeat 的"首发"时刻 = max(interval, hello 完成时刻)，避免在 client
// 未就绪时发送、触发 ErrSendBufferFull 日志污染。若 ctx 先于 ready 取消，
// Run 直接返 nil。
//
// 首次 tick 在等完 Ready 后再等一个完整 interval 才触发（time.NewTicker 语义）。
func (h *Heartbeat) Run(ctx context.Context) error {
	// 等 client 首次进入 ready 状态。
	select {
	case <-ctx.Done():
		return nil
	case <-h.sender.Ready():
	}
	h.logger.Printf("heartbeat: client ready, interval=%v", h.interval)

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			h.logger.Printf("heartbeat: stopped")
			return nil
		case <-ticker.C:
			h.tick()
		}
	}
}

// tick 执行一轮采集 + 发送。失败路径仅 log 不返错，保证 ticker 不被中断。
func (h *Heartbeat) tick() {
	metrics, err := h.collector.Sample()
	if err != nil {
		h.logger.Printf("heartbeat: sample failed: %v", err)
		return
	}
	if err := h.sender.SendHeartbeat(metrics); err != nil {
		if errors.Is(err, ErrSendBufferFull) {
			h.logger.Printf("heartbeat: dropped, buffer full")
			return
		}
		// 其他未预期错误（当前实现下应不出现）：log 但不中断。
		h.logger.Printf("heartbeat: send failed: %v", err)
		return
	}
	// 成功路径：打一条 INFO 便于生产排查（journald 可过滤；频率 30s 不会噪）
	h.logger.Printf("heartbeat: sent cpu=%.1f%% mem=%d/%d uptime=%ds",
		metrics.CPUPercent, metrics.MemUsedBytes, metrics.MemTotalBytes, metrics.UptimeSeconds)
}
