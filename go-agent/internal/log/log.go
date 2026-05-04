// Package log 封装 zap 作为 agent 唯一日志后端。
//
// 对外暴露三件事：
//   - New(level) 构造 *zap.Logger，输出到 stderr、console 编码，systemd/journal 友好。
//   - Level(s) 把字符串解析成 zapcore.Level，默认 info。
//   - StdLogger(z, name) 把 *zap.Logger 包成 *log.Logger，兼容现有只接受 stdlib
//     logger 的 client/heartbeat 包。
//
// client/heartbeat 包按决策 D1 保持不变，继续接收 *log.Logger；main.go 通过本
// 包的 StdLogger 适配器把 zap 转给它们。所有输出统一走 stderr，便于 journald
// 捕获；不做彩色，避免日志被 ANSI 序列污染。
package log

import (
	stdlog "log"
	"os"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Level 解析字符串为 zapcore.Level；无法识别或为空时回落 info。
//
// 接受值（大小写、首尾空白均容忍）：debug / info / warn / error。
func Level(s string) zapcore.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return zapcore.DebugLevel
	case "warn", "warning":
		return zapcore.WarnLevel
	case "error":
		return zapcore.ErrorLevel
	default:
		return zapcore.InfoLevel
	}
}

// New 构造用于 systemd/journal 的 *zap.Logger。
//
// 配置要点：
//   - Encoding = console：journal 单行文本更易读。
//   - EncodeLevel = Capital（INFO/WARN/…），不带颜色。
//   - EncodeTime = ISO8601（journal 也会打自己的时间戳，但保留一份给调试）。
//   - Output 统一到 stderr，systemd StandardError=journal 即可捕获。
//
// 极端场景下 zap.Build 失败（例如 OutputPaths 不可写），回落 zap.NewExample
// 以保证进程不因日志初始化而崩溃，并在 stdlib log 里留一条线索。
func New(level zapcore.Level) *zap.Logger {
	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(level)
	cfg.Encoding = "console"
	cfg.EncoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	cfg.OutputPaths = []string{"stderr"}
	cfg.ErrorOutputPaths = []string{"stderr"}
	logger, err := cfg.Build()
	if err != nil {
		// 极少发生；避免 nil 返值让调用方 panic。
		stdlog.Printf("log: zap build failed: %v", err)
		return zap.NewExample()
	}
	return logger
}

// StdLogger 把 *zap.Logger 包成 *log.Logger，供 client/heartbeat 使用。
// name 会作为 zap 的 logger name（例如 "client"、"heartbeat"），便于过滤。
//
// 注意：stdlib logger 没有级别概念，zap.NewStdLog 固定按 InfoLevel 记录。
// 若需要分级输出，直接用 *zap.Logger。
func StdLogger(z *zap.Logger, name string) *stdlog.Logger {
	return zap.NewStdLog(z.Named(name))
}

// SetStderrHook 把 stdlib log 包的默认输出定向到 stderr。
// 用于兜底：即便有代码意外调用了 log.Print(…) 而非 zap，也会进 journal。
func SetStderrHook() {
	stdlog.SetOutput(os.Stderr)
}
