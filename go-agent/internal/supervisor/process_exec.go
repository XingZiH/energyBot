// Package supervisor —— 生产路径的 ProcessLauncher 实现：真·exec.Cmd。
//
// 测试绝不走这里（用 fakeLauncher）。
//
// 实现要点：
//   - 用 exec.CommandContext 以便未来可 ctx 驱动强制停
//   - 子进程 stderr/stdout 分别起 goroutine 读，前缀 [bot-stdout] / [bot-stderr] 转给 logger
//   - SIGTERM / Kill 走 os.Process
package supervisor

import (
	"bufio"
	"io"
	"os/exec"
	"syscall"
)

// ExecLauncher 用 os/exec 启真子进程。
type ExecLauncher struct {
	logger Logger
}

// NewExecLauncher 返回生产 launcher。logger 用于打印子进程 stdout/stderr。
func NewExecLauncher(logger Logger) *ExecLauncher {
	return &ExecLauncher{logger: logger}
}

// Launch fork+exec energybot-bot。
// env 为空时子进程继承父进程 env；非空时**完全替换**（不合并）——调用方需自行
// 确保必要的系统 env（如 PATH/HOME）已包含在内。
func (l *ExecLauncher) Launch(bin string, args []string, env []string) (Process, error) {
	cmd := exec.Command(bin, args...)
	if len(env) > 0 {
		cmd.Env = env
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	// 确保不继承 agent 自己的 stdin
	cmd.Stdin = nil

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	// 独立 goroutine 逐行读子进程输出转给 agent logger
	go pumpLines(stdout, l.logger, "bot-stdout")
	go pumpLines(stderr, l.logger, "bot-stderr")

	return &execProcess{cmd: cmd}, nil
}

type execProcess struct {
	cmd *exec.Cmd
}

func (p *execProcess) Pid() int {
	if p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *execProcess) Signal(sig string) error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	var s syscall.Signal
	switch sig {
	case "SIGTERM":
		s = syscall.SIGTERM
	case "SIGHUP":
		s = syscall.SIGHUP
	default:
		s = syscall.SIGTERM
	}
	return p.cmd.Process.Signal(s)
}

func (p *execProcess) Kill() error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}

func (p *execProcess) Wait() (int, error) {
	err := p.cmd.Wait()
	if err == nil {
		return 0, nil
	}
	// 尝试从 exec.ExitError 提取 exit code
	if ee, ok := err.(*exec.ExitError); ok {
		return ee.ExitCode(), err
	}
	return -1, err
}

// pumpLines 将子进程 stdout/stderr 逐行转给 logger。
// EOF 或其它错误时静默退出——父 goroutine 的 Wait 会报真正的退出原因。
func pumpLines(r io.Reader, logger Logger, tag string) {
	scanner := bufio.NewScanner(r)
	// 默认 token 大小 64k，遇到超长行拆成多条；bot 的日志行极少 >64k。
	for scanner.Scan() {
		logger.Printf("[%s] %s", tag, scanner.Text())
	}
}
