// Package config 从环境变量加载 agent 运行时配置。
//
// 所有可配置项均以 EBT_ 前缀命名，便于在 systemd Unit 里集中管理：
//
//	EBT_LICENSE_KEY    （必填）agent license key
//	EBT_LICENSE_SECRET （必填）agent license secret，仅用于签名，不出现在日志
//	EBT_API_URL        （可选）默认 wss://www.feiyijt.com/agent
//	EBT_LOG_LEVEL      （可选）debug|info|warn|error，默认 info
//
// 设计注意：
//   - Load 只读 env、不读文件；系统配置落在 systemd EnvironmentFile 中。
//   - 用 load(getenv) 内部函数 + 依赖注入的 getenv 函数，便于表驱动测试。
//   - 校验逻辑同时负责"必填检查"与"APIURL 合法性"，尽早失败、err 包含字段名。
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config 是 agent 运行时配置快照，由 Load() 填充后只读。
type Config struct {
	LicenseKey    string
	LicenseSecret string
	APIURL        string // wss://... 或 ws://...
	LogLevel      string // debug|info|warn|error（小写）
}

const (
	// defaultAPIURL 与 Nest 端的默认接入点保持一致。若有新环境，覆盖即可。
	defaultAPIURL = "wss://www.feiyijt.com/agent"
	// defaultLogLevel 生产默认 info，避免 debug 日志撑满 journal。
	defaultLogLevel = "info"
)

// Load 读 EBT_* 环境变量并返 *Config。缺必填或非法 APIURL 返 err。
func Load() (*Config, error) {
	return load(os.Getenv)
}

// load 接受 getenv 函数以便测试注入 fake map。生产路径从 Load 走到这里。
func load(getenv func(string) string) (*Config, error) {
	cfg := &Config{
		LicenseKey:    strings.TrimSpace(getenv("EBT_LICENSE_KEY")),
		LicenseSecret: strings.TrimSpace(getenv("EBT_LICENSE_SECRET")),
		APIURL:        strings.TrimSpace(getenv("EBT_API_URL")),
		LogLevel:      strings.TrimSpace(getenv("EBT_LOG_LEVEL")),
	}
	if cfg.LicenseKey == "" {
		return nil, errors.New("config: EBT_LICENSE_KEY is required")
	}
	if cfg.LicenseSecret == "" {
		return nil, errors.New("config: EBT_LICENSE_SECRET is required")
	}
	if cfg.APIURL == "" {
		cfg.APIURL = defaultAPIURL
	}
	u, err := url.Parse(cfg.APIURL)
	if err != nil {
		return nil, fmt.Errorf("config: invalid EBT_API_URL %q: %w", cfg.APIURL, err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return nil, fmt.Errorf(
			"config: EBT_API_URL scheme %q invalid, expect ws or wss",
			u.Scheme,
		)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("config: EBT_API_URL %q missing host", cfg.APIURL)
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = defaultLogLevel
	}
	return cfg, nil
}
