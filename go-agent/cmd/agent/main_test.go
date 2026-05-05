// Package main 单测：buildBotEnv 等小工具。
//
// agent main 的主流程（signal/select/wait）依赖 fake API + fake bot binary
// 才能跑通，那部分留给 supervisor 和 client 各自包内单测覆盖。这里只盯
// 纯函数级别的 unit。
package main

import (
	"os"
	"strings"
	"testing"
)

// TestBuildBotEnv_Basics 验证：
//  1. 输出含 DATABASE_URL=<裸文件路径>（不是 sqlite:// scheme）
//  2. 父进程 PATH/HOME 等系统变量被透传
//  3. 父进程 EBT_LICENSE_KEY 这类 agent 私货**不应该**出现在 bot env
//
// 不验证：env 顺序——调用方 SetEnv 不应该依赖顺序。
func TestBuildBotEnv_Basics(t *testing.T) {
	// 设置一个 agent 私有 env（绝不能泄漏给 bot）和一个标准系统 env
	t.Setenv("EBT_LICENSE_KEY", "secret-should-not-leak")
	t.Setenv("PATH", "/usr/local/sbin:/usr/local/bin")
	t.Setenv("HOME", "/var/lib/energybot-agent")

	got := buildBotEnv("/var/lib/energybot-agent/bot.db")

	hasPair := func(k, v string) bool {
		want := k + "=" + v
		for _, kv := range got {
			if kv == want {
				return true
			}
		}
		return false
	}
	hasKey := func(k string) bool {
		prefix := k + "="
		for _, kv := range got {
			if strings.HasPrefix(kv, prefix) {
				return true
			}
		}
		return false
	}

	if !hasPair("DATABASE_URL", "/var/lib/energybot-agent/bot.db") {
		t.Errorf("DATABASE_URL 缺失或格式不对，got=%v", got)
	}
	if strings.Contains(strings.Join(got, "\n"), "sqlite://") {
		t.Errorf("DATABASE_URL 不应含 sqlite:// scheme（go-bot-v2 storage.Open 不剥），got=%v", got)
	}
	if !hasPair("PATH", "/usr/local/sbin:/usr/local/bin") {
		t.Errorf("PATH 未透传，got=%v", got)
	}
	if !hasPair("HOME", "/var/lib/energybot-agent") {
		t.Errorf("HOME 未透传，got=%v", got)
	}
	if hasKey("EBT_LICENSE_KEY") {
		t.Errorf("agent 私有 env EBT_LICENSE_KEY 泄漏到 bot env，got=%v", got)
	}
}

// TestBuildBotEnv_OmitsEmptySystemVars 验证：
// 父进程没设的系统变量（如 LC_ALL）不应该出现空字符串占位。
//
// 反例：env=["LC_ALL=" ...] 会让 bot 看到“显式空”而非“未设”，glibc locale
// 解析行为会偏向 POSIX，可能影响日志时区/时间格式输出。
func TestBuildBotEnv_OmitsEmptySystemVars(t *testing.T) {
	// 强制清掉 LC_ALL，确保 buildBotEnv 不会把空值塞进去
	if err := os.Unsetenv("LC_ALL"); err != nil {
		t.Fatalf("Unsetenv: %v", err)
	}

	got := buildBotEnv("/tmp/bot.db")
	for _, kv := range got {
		if kv == "LC_ALL=" {
			t.Errorf("LC_ALL 父进程未设，buildBotEnv 不应该塞空值，got=%v", got)
		}
	}
}
