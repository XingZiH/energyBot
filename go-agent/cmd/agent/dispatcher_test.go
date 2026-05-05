// dispatcher_test.go —— B3-T11.5 agent.applyConfig 测试
//
// 测试目标：
//   - Dispatch 收到 "agent.applyConfig" method 时：
//     a) 把 params json 写到临时文件 /tmp/ebt-apply-*.json
//     b) 调 runner.Run(botBinary, "apply-config", "--json", <tmpPath>)
//     c) 成功 → 删临时文件
//     d) 失败 → 保留临时文件并日志记录（便于诊断坏 JSON 或权限问题）
//
// Mock 策略：
//   - fakeRunner 记录调用参数 + 可配置成功/失败返回
//   - 文件残留检测通过 os.Stat 判断
//
// 注意：
//   - Dispatch 异步（goroutine）——测试要 sleep/等 channel 同步
//   - 用 fakeRunner 内部 channel done 通知调用完成
package main

import (
	"encoding/json"
	"errors"
	stdlog "log"
	"os"
	"sync"
	"testing"
	"time"
)

// fakeRunner 记录 commandRunner.Run 调用参数，可配置返回。
type fakeRunner struct {
	mu       sync.Mutex
	calls    []fakeCall
	returnFn func(bin string, args ...string) error
	done     chan struct{} // 每次 Run 调用后关闭（重新 make 以支持多次调用测试）
}

type fakeCall struct {
	bin  string
	args []string
	// 记录临时文件快照：读入内容 + 是否存在
	tmpContent []byte
	tmpExists  bool
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{done: make(chan struct{})}
}

func (r *fakeRunner) Run(bin string, args ...string) error {
	r.mu.Lock()
	call := fakeCall{bin: bin, args: append([]string{}, args...)}
	// 读取 tmp 文件（agent.applyConfig 的 JSON 必定 args 最后一个是 tmpPath）
	if len(args) >= 1 {
		tmp := args[len(args)-1]
		if data, err := os.ReadFile(tmp); err == nil {
			call.tmpContent = data
			call.tmpExists = true
		}
	}
	r.calls = append(r.calls, call)
	fn := r.returnFn
	doneCh := r.done
	r.mu.Unlock()

	var err error
	if fn != nil {
		err = fn(bin, args...)
	}
	close(doneCh)
	return err
}

func (r *fakeRunner) waitDone(t *testing.T, d time.Duration) {
	t.Helper()
	r.mu.Lock()
	ch := r.done
	r.mu.Unlock()
	select {
	case <-ch:
	case <-time.After(d):
		t.Fatalf("fakeRunner.Run 在 %s 内未被调用", d)
	}
}

func (r *fakeRunner) lastCall(t *testing.T) fakeCall {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) == 0 {
		t.Fatal("fakeRunner 无调用")
	}
	return r.calls[len(r.calls)-1]
}

// 快乐路径：Dispatch agent.applyConfig → runner 被调 + tmp 文件写了 + 成功后清理
func TestDispatcher_ApplyConfig_Happy(t *testing.T) {
	runner := newFakeRunner()
	runner.returnFn = func(_ string, _ ...string) error { return nil }

	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	// T11.5 新增字段注入
	d.botBinary = "/usr/local/bin/energybot-bot"
	d.runner = runner

	params := json.RawMessage(`{"bot":{"token":"123:ABC"},"platform":{"energyProvider":"catfee"}}`)
	if err := d.Dispatch("agent.applyConfig", params); err != nil {
		t.Fatalf("Dispatch 返错: %v", err)
	}
	runner.waitDone(t, 2*time.Second)

	call := runner.lastCall(t)
	if call.bin != "/usr/local/bin/energybot-bot" {
		t.Errorf("bin = %q, want /usr/local/bin/energybot-bot", call.bin)
	}
	if len(call.args) != 3 || call.args[0] != "apply-config" || call.args[1] != "--json" {
		t.Errorf("args = %v, want [apply-config --json <path>]", call.args)
	}
	// tmp 文件在 runner 被调时存在且包含原始 JSON
	if !call.tmpExists {
		t.Error("tmp 文件在 Run 调用时不存在")
	}
	if string(call.tmpContent) != string(params) {
		t.Errorf("tmp 内容 = %q, want %q", call.tmpContent, params)
	}
	// 成功后 tmp 应被清理——等 Run 返回后短延时删除
	tmpPath := call.args[2]
	// 等 runBotApplyConfig 的 defer cleanup 完成
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(tmpPath); os.IsNotExist(err) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("tmp 文件 %s 成功后未被清理", tmpPath)
}

// 失败路径：runner 返错 → tmp 文件保留（便于诊断）
func TestDispatcher_ApplyConfig_RunnerError_KeepsTmp(t *testing.T) {
	runner := newFakeRunner()
	runner.returnFn = func(_ string, _ ...string) error {
		return errors.New("mock bot apply-config 失败")
	}

	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	d.botBinary = "/usr/local/bin/energybot-bot"
	d.runner = runner

	params := json.RawMessage(`{"bad":"json"}`)
	_ = d.Dispatch("agent.applyConfig", params)
	runner.waitDone(t, 2*time.Second)

	call := runner.lastCall(t)
	tmpPath := call.args[2]
	// 失败保留 tmp 以便人工 cat 诊断
	time.Sleep(100 * time.Millisecond) // 等 defer 逻辑稳定
	if _, err := os.Stat(tmpPath); err != nil {
		t.Errorf("失败时 tmp 文件应保留，但 Stat 返错: %v", err)
	}
	// 手动清理避免留垃圾
	_ = os.Remove(tmpPath)
}

// botBinary 未配置时：agent.applyConfig 应拒绝且不崩
func TestDispatcher_ApplyConfig_NoBinary(t *testing.T) {
	runner := newFakeRunner()
	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	// botBinary 留空
	d.runner = runner

	params := json.RawMessage(`{}`)
	_ = d.Dispatch("agent.applyConfig", params)

	// 等一小段，确认 runner 从未被调（未配置 bot binary → 直接日志拒绝）
	select {
	case <-runner.done:
		t.Error("botBinary 未配置时 runner 不应被调")
	case <-time.After(200 * time.Millisecond):
		// 符合预期
	}
	runner.mu.Lock()
	n := len(runner.calls)
	runner.mu.Unlock()
	if n != 0 {
		t.Errorf("runner 调用次数 = %d, want 0", n)
	}
}

// ---- T11.10：DispatchRequest 同步路径 ----
//
// agent.applyConfig 升级为 JSON-RPC request/response 后，必须同步返
// result/error，让 client.go 能序列化成 response 回给 nest-api。
// 验证：
//   - 成功：返回 result map[string]any{"ok": true}，无 error；tmp 文件被清理
//   - 失败：返回 error（msg 包含 runner 错）；tmp 文件保留
//   - 未配置 botBinary：返回 error，runner 未被调
//   - 未知 method：返回 error（MethodNotFound 语义）

func TestDispatcher_DispatchRequest_ApplyConfig_Happy(t *testing.T) {
	runner := newFakeRunner()
	runner.returnFn = func(_ string, _ ...string) error { return nil }
	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	d.botBinary = "/usr/local/bin/energybot-bot"
	d.runner = runner

	params := json.RawMessage(`{"bot":{"token":"123:ABC"}}`)
	result, err := d.DispatchRequest("agent.applyConfig", params)
	if err != nil {
		t.Fatalf("DispatchRequest 返错: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result 类型 = %T, want map[string]any", result)
	}
	if m["ok"] != true {
		t.Errorf("result[ok] = %v, want true", m["ok"])
	}

	call := runner.lastCall(t)
	if call.bin != "/usr/local/bin/energybot-bot" {
		t.Errorf("bin = %q", call.bin)
	}
	if len(call.args) != 3 || call.args[0] != "apply-config" {
		t.Errorf("args = %v", call.args)
	}
	// tmp 已清理
	tmpPath := call.args[2]
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("tmp 文件未被清理：%s (err=%v)", tmpPath, err)
	}
}

func TestDispatcher_DispatchRequest_ApplyConfig_RunnerError(t *testing.T) {
	runner := newFakeRunner()
	runner.returnFn = func(_ string, _ ...string) error {
		return errors.New("sqlite locked")
	}
	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	d.botBinary = "/usr/local/bin/energybot-bot"
	d.runner = runner

	params := json.RawMessage(`{}`)
	result, err := d.DispatchRequest("agent.applyConfig", params)
	if err == nil {
		t.Fatal("DispatchRequest 应返错，但返 nil")
	}
	if result != nil {
		t.Errorf("失败时 result 应为 nil，got %v", result)
	}
	// 失败保留 tmp
	call := runner.lastCall(t)
	tmpPath := call.args[2]
	if _, statErr := os.Stat(tmpPath); statErr != nil {
		t.Errorf("失败时 tmp 应保留，Stat 返错: %v", statErr)
	}
	_ = os.Remove(tmpPath)
}

func TestDispatcher_DispatchRequest_ApplyConfig_NoBinary(t *testing.T) {
	runner := newFakeRunner()
	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	d.runner = runner
	// botBinary 留空

	result, err := d.DispatchRequest("agent.applyConfig", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("未配置 botBinary 时 DispatchRequest 应返错")
	}
	if result != nil {
		t.Errorf("result 应为 nil，got %v", result)
	}
	runner.mu.Lock()
	n := len(runner.calls)
	runner.mu.Unlock()
	if n != 0 {
		t.Errorf("runner 不应被调，got %d 次", n)
	}
}

func TestDispatcher_DispatchRequest_UnknownMethod(t *testing.T) {
	logger := stdlog.New(os.Stderr, "", 0)
	d := newBotDispatcher(nil, logger)
	result, err := d.DispatchRequest("agent.unknown", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("未知 method 应返错")
	}
	if result != nil {
		t.Errorf("result 应为 nil")
	}
}
