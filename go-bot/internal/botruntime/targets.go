package botruntime

import (
	"fmt"
	"sort"
	"strings"
)

const (
	ScopePlatform = "platform"
	ScopeAgent    = "agent"

	StatusEnabled  = "enabled"
	StatusDisabled = "disabled"

	RuntimeRunning = "running"
	RuntimeStopped = "stopped"
	RuntimeError   = "error"
	RuntimeUnknown = "unknown"

	PollingPolling = "polling"
	PollingStopped = "stopped"
	PollingError   = "error"
)

type PlatformBotConfig struct {
	BotStatus        string
	TelegramBotToken string
}

type AgentBotConfig struct {
	AgentID          int
	BotStatus        string
	TelegramBotToken string
	AgentActive      bool
}

type Target struct {
	Scope           string
	AgentID         int
	DesiredStatus   string
	Token           string
	TokenConfigured bool
}

func DesiredTargets(platform PlatformBotConfig, agents []AgentBotConfig) []Target {
	targets := []Target{
		{
			Scope:           ScopePlatform,
			DesiredStatus:   normalizeStatus(platform.BotStatus),
			Token:           strings.TrimSpace(platform.TelegramBotToken),
			TokenConfigured: strings.TrimSpace(platform.TelegramBotToken) != "",
		},
	}

	sort.SliceStable(agents, func(i, j int) bool {
		return agents[i].AgentID < agents[j].AgentID
	})
	for _, agent := range agents {
		if !agent.AgentActive || agent.AgentID <= 0 {
			continue
		}
		token := strings.TrimSpace(agent.TelegramBotToken)
		targets = append(targets, Target{
			Scope:           ScopeAgent,
			AgentID:         agent.AgentID,
			DesiredStatus:   normalizeStatus(agent.BotStatus),
			Token:           token,
			TokenConfigured: token != "",
		})
	}
	return targets
}

func RuntimeKey(target Target) string {
	if target.Scope == ScopeAgent {
		return fmt.Sprintf("%s:%d", ScopeAgent, target.AgentID)
	}
	return ScopePlatform
}

func normalizeStatus(value string) string {
	if strings.TrimSpace(value) == StatusEnabled {
		return StatusEnabled
	}
	return StatusDisabled
}
