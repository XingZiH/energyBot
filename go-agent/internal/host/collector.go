// Package host 负责主机指标采集。
//
// 设计要点：
//   - Collector 是接口，便于上层依赖注入并在单测中替换为 fake。
//   - 真实实现 NewGopsutil() 基于 github.com/shirou/gopsutil/v4。
//   - 字段命名直接对应 wire 协议（agent.hello / agent.heartbeat），
//     不可随意改动以防破坏与 Nest 端 schema 的兼容性。
package host

import (
	"fmt"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	gopshost "github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
)

// HelloInfo 是 agent.hello 的主机字段（一次性，启动时采集）。
//
// 上层序列化约定：
//   - HostName  → wire 的 host_name
//   - OSInfo    → wire 的 os_info
//   - BootTime  → wire 的 boot_time，使用 BootTime.UnixMilli()（毫秒）
type HelloInfo struct {
	HostName string
	OSInfo   string    // kernel 版本串
	BootTime time.Time // 启动时刻
}

// Metrics 是 agent.heartbeat 的指标（周期性采集）。
//
// 字段对应 wire：
//   - UptimeSeconds → uptime_seconds
//   - CPUPercent    → cpu_percent（0-100）
//   - MemUsedBytes  → mem_used_bytes
//   - MemTotalBytes → mem_total_bytes
//   - Loadavg1      → loadavg_1（Linux /proc/loadavg 第 1 项）
type Metrics struct {
	UptimeSeconds uint64
	CPUPercent    float64
	MemUsedBytes  uint64
	MemTotalBytes uint64
	Loadavg1      float64
}

// Collector 抽象主机指标采集，便于单测注入 fake 实现。
type Collector interface {
	// Hello 采集启动一次性字段；通常只在 agent 启动时调用。
	Hello() (HelloInfo, error)
	// Sample 采集周期性指标；每次心跳调用一次。
	Sample() (Metrics, error)
}

// gopsutilCollector 是基于 gopsutil v4 的真实实现。
type gopsutilCollector struct{}

// NewGopsutil 构造走 gopsutil v4 的真实 Collector。
func NewGopsutil() Collector {
	return &gopsutilCollector{}
}

// Hello 采集主机名、kernel 版本、启动时刻。
//
// 错误策略：host.Info() 失败才返错；BootTime 为 0 也允许（容器/异常机可能如此）。
func (c *gopsutilCollector) Hello() (HelloInfo, error) {
	info, err := gopshost.Info()
	if err != nil {
		return HelloInfo{}, fmt.Errorf("host.Info: %w", err)
	}

	var bootTime time.Time
	if info.BootTime > 0 {
		// gopsutil 返回的是 unix 秒数。
		bootTime = time.Unix(int64(info.BootTime), 0).UTC()
	}

	return HelloInfo{
		HostName: info.Hostname,
		OSInfo:   info.KernelVersion,
		BootTime: bootTime,
	}, nil
}

// Sample 采集 uptime / CPU / 内存 / load。
//
// 错误策略：任何一个子调用失败即整体失败并 wrap。
//
// 注意：cpu.Percent(0, false) 非阻塞返回 [自上次调用以来] 的平均 CPU，
// 首次调用可能返 0（gopsutil 已知行为），上层或调用方需能容忍。
func (c *gopsutilCollector) Sample() (Metrics, error) {
	uptime, err := gopshost.Uptime()
	if err != nil {
		return Metrics{}, fmt.Errorf("host.Uptime: %w", err)
	}

	cpuPcts, err := cpu.Percent(0, false)
	if err != nil {
		return Metrics{}, fmt.Errorf("cpu.Percent: %w", err)
	}
	var cpuPercent float64
	if len(cpuPcts) > 0 {
		cpuPercent = cpuPcts[0]
	}

	vm, err := mem.VirtualMemory()
	if err != nil {
		return Metrics{}, fmt.Errorf("mem.VirtualMemory: %w", err)
	}

	la, err := load.Avg()
	if err != nil {
		// load.Avg 在 Windows 上会返错；agent 目标平台为 Linux（macOS 作为开发平台），
		// 这里按正常错误向上返回，由调用方决定如何处理（例如降级或跳过）。
		return Metrics{}, fmt.Errorf("load.Avg: %w", err)
	}

	return Metrics{
		UptimeSeconds: uptime,
		CPUPercent:    cpuPercent,
		MemUsedBytes:  vm.Used,
		MemTotalBytes: vm.Total,
		Loadavg1:      la.Load1,
	}, nil
}
