package config

import (
	"strings"
	"testing"
)

// mapGetenv 把 map 适配成 os.Getenv 风格的函数，供 load() 注入。
func mapGetenv(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoad_MissingLicenseKey_ReturnsError(t *testing.T) {
	_, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_SECRET": "s",
	}))
	if err == nil {
		t.Fatal("期望 err，实际 nil")
	}
	if !strings.Contains(err.Error(), "EBT_LICENSE_KEY") {
		t.Fatalf("err 应提及字段名 EBT_LICENSE_KEY，实际: %v", err)
	}
}

func TestLoad_MissingLicenseSecret_ReturnsError(t *testing.T) {
	_, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY": "k",
	}))
	if err == nil {
		t.Fatal("期望 err，实际 nil")
	}
	if !strings.Contains(err.Error(), "EBT_LICENSE_SECRET") {
		t.Fatalf("err 应提及字段名 EBT_LICENSE_SECRET，实际: %v", err)
	}
}

func TestLoad_DefaultsAPIURL(t *testing.T) {
	cfg, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
	}))
	if err != nil {
		t.Fatalf("Load 不应报错: %v", err)
	}
	if cfg.APIURL != defaultAPIURL {
		t.Fatalf("APIURL 默认应 %q，实际 %q", defaultAPIURL, cfg.APIURL)
	}
}

func TestLoad_CustomAPIURL(t *testing.T) {
	cfg, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
		"EBT_API_URL":        "wss://example.com/x",
	}))
	if err != nil {
		t.Fatalf("Load 不应报错: %v", err)
	}
	if cfg.APIURL != "wss://example.com/x" {
		t.Fatalf("APIURL 应原样保留，实际 %q", cfg.APIURL)
	}
}

func TestLoad_InvalidScheme_ReturnsError(t *testing.T) {
	_, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
		"EBT_API_URL":        "http://example.com/x",
	}))
	if err == nil {
		t.Fatal("期望 err（scheme 非 ws/wss），实际 nil")
	}
	if !strings.Contains(err.Error(), "scheme") {
		t.Fatalf("err 应提及 scheme，实际: %v", err)
	}
}

func TestLoad_EmptyHost_ReturnsError(t *testing.T) {
	_, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
		"EBT_API_URL":        "wss:///onlypath",
	}))
	if err == nil {
		t.Fatal("期望 err（空 host），实际 nil")
	}
	if !strings.Contains(err.Error(), "host") {
		t.Fatalf("err 应提及 host，实际: %v", err)
	}
}

func TestLoad_DefaultLogLevel(t *testing.T) {
	cfg, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
	}))
	if err != nil {
		t.Fatalf("Load 不应报错: %v", err)
	}
	if cfg.LogLevel != defaultLogLevel {
		t.Fatalf("LogLevel 默认应 %q，实际 %q", defaultLogLevel, cfg.LogLevel)
	}
}

func TestLoad_CustomLogLevel(t *testing.T) {
	cfg, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "k",
		"EBT_LICENSE_SECRET": "s",
		"EBT_LOG_LEVEL":      "debug",
	}))
	if err != nil {
		t.Fatalf("Load 不应报错: %v", err)
	}
	if cfg.LogLevel != "debug" {
		t.Fatalf("LogLevel 应 %q，实际 %q", "debug", cfg.LogLevel)
	}
}

// TestLoad_TrimsWhitespace 保证 env 里意外带空白时仍能工作。
func TestLoad_TrimsWhitespace(t *testing.T) {
	cfg, err := load(mapGetenv(map[string]string{
		"EBT_LICENSE_KEY":    "  k  ",
		"EBT_LICENSE_SECRET": "\ts\n",
	}))
	if err != nil {
		t.Fatalf("Load 不应报错: %v", err)
	}
	if cfg.LicenseKey != "k" || cfg.LicenseSecret != "s" {
		t.Fatalf("必填项未 trim: key=%q secret=%q", cfg.LicenseKey, cfg.LicenseSecret)
	}
}
