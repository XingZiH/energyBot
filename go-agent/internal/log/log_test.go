package log

import (
	"bytes"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func TestLevel_ParsesKnownValues(t *testing.T) {
	cases := map[string]zapcore.Level{
		"debug":   zapcore.DebugLevel,
		"DEBUG":   zapcore.DebugLevel,
		"  info ": zapcore.InfoLevel,
		"warn":    zapcore.WarnLevel,
		"warning": zapcore.WarnLevel,
		"error":   zapcore.ErrorLevel,
		"":        zapcore.InfoLevel,
		"weird":   zapcore.InfoLevel,
	}
	for in, want := range cases {
		if got := Level(in); got != want {
			t.Errorf("Level(%q) = %v，期望 %v", in, got, want)
		}
	}
}

// TestStdLogger_WritesThroughZap 确保 StdLogger 返回的 *log.Logger
// 真的把输出路由给了 zap（而不是绕过 zap 直接写 stderr）。
func TestStdLogger_WritesThroughZap(t *testing.T) {
	var buf bytes.Buffer
	// 直接手搓一个写入 bytes.Buffer 的 zap.Logger，避免依赖 stderr。
	encoder := zapcore.NewConsoleEncoder(zap.NewProductionEncoderConfig())
	core := zapcore.NewCore(encoder, zapcore.AddSync(&buf), zapcore.InfoLevel)
	z := zap.New(core)

	std := StdLogger(z, "smoke")
	std.Print("hello-smoke")
	_ = z.Sync()

	if !bytes.Contains(buf.Bytes(), []byte("hello-smoke")) {
		t.Fatalf("zap 输出未包含原文: %s", buf.String())
	}
	if !bytes.Contains(buf.Bytes(), []byte("smoke")) {
		t.Fatalf("zap 输出未包含 logger name: %s", buf.String())
	}
}

// TestNew_DoesNotPanic 只是构造 + Sync 的烟雾测试，确保配置正确。
func TestNew_DoesNotPanic(t *testing.T) {
	z := New(Level("info"))
	if z == nil {
		t.Fatal("New 返 nil")
	}
	// Sync 在 stderr 上可能返 "sync /dev/stderr: invalid argument"，忽略即可。
	_ = z.Sync()
}
