package host

import (
	"errors"
	"runtime"
	"testing"
	"time"
)

// fakeCollector 是一个纯内存的 Collector 实现，用于测试接口形状。
type fakeCollector struct {
	hello    HelloInfo
	helloErr error

	sample    Metrics
	sampleErr error
}

func (f *fakeCollector) Hello() (HelloInfo, error) {
	return f.hello, f.helloErr
}

func (f *fakeCollector) Sample() (Metrics, error) {
	return f.sample, f.sampleErr
}

// 编译期断言 fakeCollector 实现了 Collector 接口。
var _ Collector = (*fakeCollector)(nil)

// Case 1：HelloInfo 字段防守测试（wire 字段名/类型不可漂移）。
func TestHelloInfo_Fields(t *testing.T) {
	boot := time.Unix(1_700_000_000, 0).UTC()
	h := HelloInfo{
		HostName: "host-xyz",
		OSInfo:   "Linux 6.1.0",
		BootTime: boot,
	}

	if got := h.HostName; got != "host-xyz" {
		t.Errorf("HostName = %q, want %q", got, "host-xyz")
	}
	if got := h.OSInfo; got != "Linux 6.1.0" {
		t.Errorf("OSInfo = %q, want %q", got, "Linux 6.1.0")
	}
	if !h.BootTime.Equal(boot) {
		t.Errorf("BootTime = %v, want %v", h.BootTime, boot)
	}
	// BootTime 用 UnixMilli() 序列化到 wire 的 boot_time。
	if got := h.BootTime.UnixMilli(); got != 1_700_000_000_000 {
		t.Errorf("BootTime.UnixMilli() = %d, want %d", got, 1_700_000_000_000)
	}
}

// Case 2：Metrics 字段防守测试。
func TestMetrics_Fields(t *testing.T) {
	m := Metrics{
		UptimeSeconds: 12345,
		CPUPercent:    42.5,
		MemUsedBytes:  1 << 30,
		MemTotalBytes: 2 << 30,
		Loadavg1:      1.23,
	}

	if m.UptimeSeconds != 12345 {
		t.Errorf("UptimeSeconds = %d, want 12345", m.UptimeSeconds)
	}
	if m.CPUPercent != 42.5 {
		t.Errorf("CPUPercent = %v, want 42.5", m.CPUPercent)
	}
	if m.MemUsedBytes != 1<<30 {
		t.Errorf("MemUsedBytes = %d, want %d", m.MemUsedBytes, uint64(1<<30))
	}
	if m.MemTotalBytes != 2<<30 {
		t.Errorf("MemTotalBytes = %d, want %d", m.MemTotalBytes, uint64(2<<30))
	}
	if m.Loadavg1 != 1.23 {
		t.Errorf("Loadavg1 = %v, want 1.23", m.Loadavg1)
	}
}

// Case 3：fake Collector 的 Hello 行为。
func TestFakeCollector_Hello(t *testing.T) {
	boot := time.Unix(1_600_000_000, 0).UTC()
	want := HelloInfo{
		HostName: "fake-host",
		OSInfo:   "FakeOS 1.0",
		BootTime: boot,
	}
	fc := &fakeCollector{hello: want}

	got, err := fc.Hello()
	if err != nil {
		t.Fatalf("Hello() err = %v, want nil", err)
	}
	if got != want {
		t.Errorf("Hello() = %+v, want %+v", got, want)
	}

	// 错误传播。
	sentinel := errors.New("boom")
	fc2 := &fakeCollector{helloErr: sentinel}
	if _, err := fc2.Hello(); !errors.Is(err, sentinel) {
		t.Errorf("Hello() err = %v, want %v", err, sentinel)
	}
}

// Case 4：fake Collector 的 Sample 行为。
func TestFakeCollector_Sample(t *testing.T) {
	want := Metrics{
		UptimeSeconds: 99,
		CPUPercent:    7.5,
		MemUsedBytes:  100,
		MemTotalBytes: 200,
		Loadavg1:      0.5,
	}
	fc := &fakeCollector{sample: want}

	got, err := fc.Sample()
	if err != nil {
		t.Fatalf("Sample() err = %v, want nil", err)
	}
	if got != want {
		t.Errorf("Sample() = %+v, want %+v", got, want)
	}

	sentinel := errors.New("sample-fail")
	fc2 := &fakeCollector{sampleErr: sentinel}
	if _, err := fc2.Sample(); !errors.Is(err, sentinel) {
		t.Errorf("Sample() err = %v, want %v", err, sentinel)
	}
}

// Case 5：真 gopsutil 的冒烟测试，只断言非空/非零，容 OS 差异。
func TestGopsutilCollector_Smoke(t *testing.T) {
	if runtime.GOOS == "windows" {
		// load.Avg 在 Windows 上会返错，agent 目标平台仅 Linux（macOS 开发用），跳过。
		t.Skip("gopsutil load.Avg not supported on windows; agent targets linux")
	}

	c := NewGopsutil()
	if c == nil {
		t.Fatal("NewGopsutil() returned nil")
	}

	hello, err := c.Hello()
	if err != nil {
		t.Fatalf("Hello() err = %v", err)
	}
	if hello.HostName == "" {
		t.Errorf("Hello().HostName is empty; any real OS should report a hostname")
	}
	if hello.BootTime.Unix() <= 0 {
		t.Errorf("Hello().BootTime = %v, want a positive unix time", hello.BootTime)
	}
	t.Logf("smoke Hello: HostName=%q OSInfo=%q BootTime=%v",
		hello.HostName, hello.OSInfo, hello.BootTime)

	sample1, err := c.Sample()
	if err != nil {
		t.Fatalf("Sample() #1 err = %v", err)
	}
	if sample1.MemTotalBytes == 0 {
		t.Errorf("Sample().MemTotalBytes = 0, want > 0")
	}
	if sample1.UptimeSeconds == 0 {
		t.Errorf("Sample().UptimeSeconds = 0, want > 0")
	}
	// CPUPercent 首次调用返 0 是 gopsutil 已知行为，只记录不断言。
	t.Logf("smoke Sample #1: Uptime=%ds CPU=%.2f%% MemUsed=%d MemTotal=%d Load1=%.2f",
		sample1.UptimeSeconds, sample1.CPUPercent,
		sample1.MemUsedBytes, sample1.MemTotalBytes, sample1.Loadavg1)

	time.Sleep(200 * time.Millisecond)

	sample2, err := c.Sample()
	if err != nil {
		t.Fatalf("Sample() #2 err = %v", err)
	}
	// 第二次 CPU 采样值可能 > 0，但低负载时仍可能为 0，不强断言，只记录。
	t.Logf("smoke Sample #2: Uptime=%ds CPU=%.2f%% MemUsed=%d MemTotal=%d Load1=%.2f",
		sample2.UptimeSeconds, sample2.CPUPercent,
		sample2.MemUsedBytes, sample2.MemTotalBytes, sample2.Loadavg1)
}
