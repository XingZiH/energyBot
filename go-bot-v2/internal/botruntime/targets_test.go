package botruntime

import "testing"

func TestDesiredTargetsIncludesDisabledPlatformForHeartbeat(t *testing.T) {
	targets := DesiredTargets(PlatformBotConfig{
		BotStatus:        "disabled",
		TelegramBotToken: "",
	}, nil)

	if len(targets) != 1 {
		t.Fatalf("expected one platform target, got %d", len(targets))
	}
	target := targets[0]
	if target.Scope != ScopePlatform {
		t.Fatalf("unexpected target scope: %s", target.Scope)
	}
	if target.DesiredStatus != StatusDisabled {
		t.Fatalf("unexpected desired status: %s", target.DesiredStatus)
	}
	if target.TokenConfigured {
		t.Fatal("expected disabled platform target to report missing token")
	}
}

func TestDesiredTargetsIncludesActiveAgentBotConfigsOnly(t *testing.T) {
	targets := DesiredTargets(
		PlatformBotConfig{BotStatus: "enabled", TelegramBotToken: "platform-token"},
		[]AgentBotConfig{
			{AgentID: 7, BotStatus: "enabled", TelegramBotToken: "agent-token", AgentActive: true},
			{AgentID: 8, BotStatus: "disabled", TelegramBotToken: "agent-disabled-token", AgentActive: true},
			{AgentID: 9, BotStatus: "enabled", TelegramBotToken: "inactive-agent-token", AgentActive: false},
		},
	)

	if len(targets) != 3 {
		t.Fatalf("expected platform plus two active agent targets, got %d", len(targets))
	}
	if targets[1].Scope != ScopeAgent || targets[1].AgentID != 7 || targets[1].DesiredStatus != StatusEnabled {
		t.Fatalf("unexpected first agent target: %#v", targets[1])
	}
	if targets[2].Scope != ScopeAgent || targets[2].AgentID != 8 || targets[2].DesiredStatus != StatusDisabled {
		t.Fatalf("unexpected disabled agent target: %#v", targets[2])
	}
}

func TestRuntimeKeySeparatesPlatformAndAgents(t *testing.T) {
	platformKey := RuntimeKey(Target{Scope: ScopePlatform})
	agentKey := RuntimeKey(Target{Scope: ScopeAgent, AgentID: 7})

	if platformKey == agentKey {
		t.Fatalf("runtime keys must differ, got %q", platformKey)
	}
	if platformKey != "platform" {
		t.Fatalf("unexpected platform key: %s", platformKey)
	}
	if agentKey != "agent:7" {
		t.Fatalf("unexpected agent key: %s", agentKey)
	}
}
