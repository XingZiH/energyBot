package botinfo

import (
	"encoding/json"
	"testing"
)

// TestNoopProvider_ReturnsNilPair 确保 NoopProvider 返回 (nil, nil)，
// 心跳 payload 能正确省略 bot 字段。
func TestNoopProvider_ReturnsNilPair(t *testing.T) {
	info, err := NoopProvider{}.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot err = %v, want nil", err)
	}
	if info != nil {
		t.Errorf("Snapshot info = %+v, want nil", info)
	}
}

// TestBotInfo_JSONSerialization 验证 wire 字段名与 B3 spec 一致，
// 零值字段被 omitempty 省略。
func TestBotInfo_JSONSerialization(t *testing.T) {
	cases := []struct {
		name     string
		info     BotInfo
		wantJSON string
	}{
		{
			name:     "unknown only status",
			info:     BotInfo{Status: BotStatusUnknown},
			wantJSON: `{"status":"unknown"}`,
		},
		{
			name: "full running",
			info: BotInfo{
				Status:        BotStatusRunning,
				PID:           1234,
				UptimeSeconds: 3600,
				ConfigVersion: 7,
				LastTGPollAt:  1745000000000,
			},
			wantJSON: `{"status":"running","pid":1234,"uptime_seconds":3600,"config_version":7,"last_tg_poll_at":1745000000000}`,
		},
		{
			name: "error with message",
			info: BotInfo{
				Status:    BotStatusError,
				PID:       2345,
				LastError: "401 Unauthorized",
			},
			wantJSON: `{"status":"error","pid":2345,"last_error":"401 Unauthorized"}`,
		},
		{
			name:     "stopped empty",
			info:     BotInfo{Status: BotStatusStopped},
			wantJSON: `{"status":"stopped"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.info)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			if string(raw) != tc.wantJSON {
				t.Errorf("JSON mismatch\n got: %s\nwant: %s", raw, tc.wantJSON)
			}
		})
	}
}

// TestBotStatus_AllValuesString 文档化所有合法状态的 wire 表达。
func TestBotStatus_AllValuesString(t *testing.T) {
	tests := map[BotStatus]string{
		BotStatusUnknown:  "unknown",
		BotStatusStopped:  "stopped",
		BotStatusStarting: "starting",
		BotStatusRunning:  "running",
		BotStatusError:    "error",
	}
	for s, want := range tests {
		if string(s) != want {
			t.Errorf("BotStatus(%v) = %q, want %q", s, string(s), want)
		}
	}
}
