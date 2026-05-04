package client

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/anomalyco/energybot-agent/internal/host"
)

// Config 是 Client 的完整配置。所有可选时间参数允许测试覆盖以加速。
//
// 必填项由 validate() 校验；可选项由 fillDefaults() 补齐。
type Config struct {
	// APIURL 是 WebSocket 接入点，必须形如 "wss://host/path" 或 "ws://host/path"。
	APIURL string
	// LicenseKey 用于 X-License-Key header。
	LicenseKey string
	// LicenseSecret 用于计算 X-Signature，不出现在任何 header 或 log。
	LicenseSecret string
	// AgentVersion 用于 X-Agent-Version header 及 hello 的 agent_version 参数，形如 "1.0.0"。
	AgentVersion string
	// Collector 提供 Hello/Sample。
	Collector host.Collector

	// Logger 为运行时日志输出；不设则用 log.Default()。
	Logger *log.Logger
	// ExitFunc 在 terminal close（4001/4003）时被调，生产传 os.Exit。
	// 约定：client 调用 ExitFunc(42) 后立即 return nil，测试可注入 fake 记录退出码。
	ExitFunc func(code int)
	// HelloTimeout 指 Dial 成功后等待 hello success response 的超时，默认 5s。
	HelloTimeout time.Duration
	// BackoffMin/BackoffMax 指数退避区间，默认 1s/60s。
	BackoffMin time.Duration
	BackoffMax time.Duration
	// DialTimeout 指单次 Dial 的最长等待，默认 10s。
	DialTimeout time.Duration
	// SendBuffer 指 sendCh 容量，默认 16；满则 SendHeartbeat 返 ErrSendBufferFull。
	SendBuffer int
}

// validate 校验必填字段。调用时不修改 c。
func (c *Config) validate() error {
	if c.APIURL == "" {
		return fmt.Errorf("client: APIURL is required")
	}
	if c.LicenseKey == "" {
		return fmt.Errorf("client: LicenseKey is required")
	}
	if c.LicenseSecret == "" {
		return fmt.Errorf("client: LicenseSecret is required")
	}
	if c.AgentVersion == "" {
		return fmt.Errorf("client: AgentVersion is required")
	}
	if c.Collector == nil {
		return fmt.Errorf("client: Collector is required")
	}
	return nil
}

// fillDefaults 填入所有可选字段的默认值。在 validate 之后调用。
func (c *Config) fillDefaults() {
	if c.Logger == nil {
		c.Logger = log.Default()
	}
	if c.ExitFunc == nil {
		c.ExitFunc = os.Exit
	}
	if c.HelloTimeout == 0 {
		c.HelloTimeout = 5 * time.Second
	}
	if c.BackoffMin == 0 {
		c.BackoffMin = 1 * time.Second
	}
	if c.BackoffMax == 0 {
		c.BackoffMax = 60 * time.Second
	}
	if c.DialTimeout == 0 {
		c.DialTimeout = 10 * time.Second
	}
	if c.SendBuffer == 0 {
		c.SendBuffer = 16
	}
}
