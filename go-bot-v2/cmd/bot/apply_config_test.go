package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/anomalyco/energybot-bot/internal/config"
)

// TestApplyConfigFromFile_HappyPath 验证：
//
//  1. 读 JSON → 打开 SQLite → upsert platform_config 和 bot_config
//  2. 之后 config.LoadRuntimeFromEnv 能读出完整 Config（token、地址、welcome）
//  3. 相同 JSON 重复 apply 仍幂等（platform_config 单例 UPDATE，bot_config 同）
//
// 不验证：apply-config 进程行为（exit code）——那属于 main 集成测。
func TestApplyConfigFromFile_HappyPath(t *testing.T) {
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "bot.db")

	// fixture：最小够用的全量配置，对应 T11.4 nest-api 会 push 过来的结构
	input := applyConfigInput{
		DatabaseURL: dbPath, // 本 CLI 模式下 bot 内部复用这个字段作为 sqlite 文件路径
		Platform: platformConfigInput{
			TronAPIBaseURL:           "https://api.trongrid.io",
			TronAPIKey:               "api-key-xyz",
			PlatformReceiveAddress:   "TABC12345",
			JustLendContractAddress:  "TCONTRACT",
			JustLendPayerPrivateKey:  "priv-key-hex",
			EnergyProvider:           "justlend",
			CatFeeEnvironment:        "nile",
			CatFeeNileAPIBaseURL:     "https://nile.catfee.io",
			CatFeeNileAPIKey:         "cf-key",
			CatFeeNileAPISecret:      "cf-secret",
			CatFeeAutoActivate:       true,
			OrderPaymentTTLMinutes:   10,
			TelegramPollingInterval:  2,
			WorkerIntervalSeconds:    60,
			MinTRXReserveSun:         "0",
		},
		Bot: botConfigInput{
			Token:        "123456:TEST-TOKEN",
			Username:     "testbot",
			WelcomeText:  "welcome",
			MenuConfig:   `{"items":[]}`,
			MessageConfig: `{"fallback":"hi"}`,
		},
	}
	jsonPath := writeJSONFixture(t, tmp, input)

	if err := applyConfigFromFile(jsonPath); err != nil {
		t.Fatalf("第一次 applyConfigFromFile 失败: %v", err)
	}

	// 用 LoadRuntimeFromEnv 回读——真实生产路径
	t.Setenv("DATABASE_URL", dbPath)
	cfg, err := config.LoadRuntimeFromEnv(context.Background())
	if err != nil {
		t.Fatalf("LoadRuntimeFromEnv: %v", err)
	}
	if cfg.TelegramBotToken != "123456:TEST-TOKEN" {
		t.Errorf("token 未写入，got=%q", cfg.TelegramBotToken)
	}
	if cfg.PlatformReceiveAddress != "TABC12345" {
		t.Errorf("receive address 未写入，got=%q", cfg.PlatformReceiveAddress)
	}
	if cfg.TronAPIKey != "api-key-xyz" {
		t.Errorf("tron api key 未写入，got=%q", cfg.TronAPIKey)
	}

	// 再 apply 一遍，验证幂等
	if err := applyConfigFromFile(jsonPath); err != nil {
		t.Fatalf("第二次 applyConfigFromFile（幂等）失败: %v", err)
	}
	cfg2, err := config.LoadRuntimeFromEnv(context.Background())
	if err != nil {
		t.Fatalf("LoadRuntimeFromEnv 二次: %v", err)
	}
	if cfg2.TelegramBotToken != cfg.TelegramBotToken {
		t.Errorf("幂等失败：token 漂移 %q -> %q", cfg.TelegramBotToken, cfg2.TelegramBotToken)
	}
}

// TestApplyConfigFromFile_BadJSON 验证错误路径：JSON 语法错 / 字段缺失 / DB 打不开
func TestApplyConfigFromFile_BadJSON(t *testing.T) {
	tmp := t.TempDir()
	bad := filepath.Join(tmp, "bad.json")
	if err := writeFile(bad, "{ not-json "); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	if err := applyConfigFromFile(bad); err == nil {
		t.Error("bad json 应返 err")
	}

	// 缺 DatabaseURL
	empty := filepath.Join(tmp, "empty.json")
	if err := writeFile(empty, `{}`); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	if err := applyConfigFromFile(empty); err == nil {
		t.Error("缺 DatabaseURL 应返 err")
	}
}

// --- helpers ---

func writeJSONFixture(t *testing.T, dir string, v applyConfigInput) string {
	t.Helper()
	p := filepath.Join(dir, "apply.json")
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := writeFile(p, string(data)); err != nil {
		t.Fatalf("writeFile: %v", err)
	}
	return p
}
