package projects

// stubs.go — placeholder shims for dock-internal helpers that the
// extracted handler code references. The extraction PR keeps these as
// no-ops + logged TODOs so the package compiles + boots; the follow-up
// PR wires real SDK calls or migrates the underlying tables.
//
// Each block names which dock function/type it stubs and what the
// real wiring will look like.

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/networkextension/polar-sdk"
)

// ---- Cross-domain types --------------------------------------------
//
// These are stripped-down copies of dock-side types. We keep the field
// names projects code reads, but skip unrelated columns.

// LLMConfig mirrors dock's LLMConfig as seen by projects code. The
// HasAPIKey bool is a convenience the dock SDK doesn't surface;
// listAvailableLLMConfigs (stub) returns nil so this never matters
// in production until the follow-up PR.
type LLMConfig struct {
	ID        int64
	Name      string
	BaseURL   string
	Model     string
	ProxyURL  string
	HasAPIKey bool
}

// BotUser is the projects-flavored view of dock's bot_users row.
// Fields chosen to match handler usages (SystemPrompt, BotKind,
// LLMConfigID, WorkspaceID, Name).
type BotUser struct {
	WorkspaceID  string
	Name         string
	SystemPrompt string
	BotKind      string
	LLMConfigID  int64
}

// IOSApp — minimum surface for handleProjectCreate / buildPickupBody.
type IOSApp struct {
	WorkspaceID string
	BundleID    string
}

// chatThread + llmThread — minimal records mirroring dock's chat_threads
// / llm_threads.
type chatThread struct{ ID int64 }
type llmThread struct{ ID int64 }

// BotKindPassthrough — sentinel constant referenced by handleProjectDecompose
// when validating bot configuration. Matches dock's
// bot_users.bot_kind enum value.
const BotKindPassthrough = "passthrough"

// ---- LLM dispatch ---------------------------------------------------

// aiRuntimeConfig + aiChatCompletionRequest/Message + aiAgentTask
// originally lived in dock's ai_agent.go. We keep the shape so the
// extracted code compiles; the dispatch path itself is stubbed
// (see Plugin.aiAgent and Plugin.agentHub below).
type aiRuntimeConfig struct {
	APIKey       string
	BaseURL      string
	Model        string
	SystemPrompt string
	ProxyURL     string
	Endpoint     string
}

type aiChatCompletionMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiChatCompletionRequest struct {
	Model    string                    `json:"model"`
	Messages []aiChatCompletionMessage `json:"messages"`
}

type aiChatCompletionChoice struct {
	Message aiChatCompletionMessage `json:"message"`
}

type aiChatCompletionResponse struct {
	Choices []aiChatCompletionChoice `json:"choices"`
}

type aiAgentTask struct {
	ThreadID        int64
	LLMThreadID     *int64
	UserID          string
	ResponderUserID string
	ResponderName   string
	Content         string
	WorkdirSubpath  string
	GitRemoteURL    string
}

// aiAgentStub satisfies the surface handleProjectDecompose +
// handleProjectTaskPickup poke at (.requestChatCompletion, .enqueue).
// requestChatCompletion is a TODO; enqueue forwards to dock's
// /internal/v1/agent/dispatch via the SDK.
type aiAgentStub struct {
	dock *sdk.Client
}

func (a *aiAgentStub) requestChatCompletion(rc aiRuntimeConfig, payload aiChatCompletionRequest) (*aiChatCompletionResponse, error) {
	// TODO(extract): SDK has no synchronous chat-completion path; dock's
	// requestChatCompletion talked to the upstream LLM directly. Wire
	// either (a) a vendored llm_client from dock or (b) a new SDK
	// surface that lets the plugin call upstream LLMs with cost
	// accounting routed through AgentLLMCallRecord. Returning ErrNotWired
	// keeps the decompose endpoint clean-failing instead of silently
	// dropping requests.
	log.Printf("projects: TODO(extract) requestChatCompletion endpoint=%s model=%s — SDK signature mismatch, returning ErrNotWired", rc.Endpoint, rc.Model)
	return nil, errors.New("projects: chat completion not yet wired in extracted svc (TODO follow-up PR)")
}

func (a *aiAgentStub) enqueue(t aiAgentTask) {
	// Forward to dock's /internal/v1/agent/dispatch. Best-effort —
	// the original in-process queue had retry; SDK relies on dock
	// to do the retry server-side.
	if a == nil || a.dock == nil {
		return
	}
	_, err := a.dock.AgentDispatch(sdk.AgentDispatchRequest{
		ThreadID:        t.ThreadID,
		LLMThreadID:     t.LLMThreadID,
		UserID:          t.UserID,
		ResponderUserID: t.ResponderUserID,
		ResponderName:   t.ResponderName,
		Content:         t.Content,
	})
	if err != nil {
		log.Printf("projects: aiAgent.enqueue dispatch failed: %v", err)
	}
}

// agentHubStub satisfies the .lookup() call from handleProjectTaskPickup.
// Returns non-nil when the bot has an attached agent so the handler
// proceeds; nil for "agent offline". Backed by SDK AgentPresenceGet.
type agentHubStub struct {
	dock *sdk.Client
}

func (h *agentHubStub) lookup(botUserID string) any {
	if h == nil || h.dock == nil {
		return nil
	}
	pres, err := h.dock.AgentPresenceGet(botUserID)
	if err != nil || pres == nil || !pres.Attached {
		return nil
	}
	return pres
}

// ---- Plugin glue ---------------------------------------------------

// Plugin.aiAgent + Plugin.agentHub — initialized lazily in New().
// Methods on *Plugin returning these are split out so the receiver
// stays consistent.
func (p *Plugin) attachAIAgent() {
	if p.aiAgent == nil {
		p.aiAgent = &aiAgentStub{dock: p.Dock}
	}
	if p.agentHub == nil {
		p.agentHub = &agentHubStub{dock: p.Dock}
	}
}

// ---- Bot / LLM lookup --------------------------------------------

// getBotUserByUserID — was dock's store-side lookup. Now SDK-backed.
// Notes: SDK's BotUser shape doesn't include system_prompt yet, so
// SystemPrompt comes back empty — persona prefix loses fidelity in
// the extracted build. Tracked as TODO for follow-up.
func (p *Plugin) getBotUserByUserID(botUserID string) (*BotUser, error) {
	b, err := p.Dock.BotUserGet(botUserID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}
	return &BotUser{
		WorkspaceID:  b.WorkspaceID,
		Name:         b.Name,
		SystemPrompt: "", // TODO(extract): expose via SDK BotUserGet
		BotKind:      b.BotKind,
		LLMConfigID:  b.LLMConfigID,
	}, nil
}

// listAvailableLLMConfigs — was dock's store query against llm_configs
// joined with workspace ACLs. Stubbed: returns empty list, which makes
// handleProjectDecompose fail clean ("没有可用的 LLM 配置"). Follow-up
// PR will add SDK LLMConfigList(workspaceID).
func (p *Plugin) listAvailableLLMConfigs(workspaceID string) ([]LLMConfig, error) {
	log.Printf("projects: TODO(extract) listAvailableLLMConfigs workspace=%s — returning empty list", workspaceID)
	return nil, nil
}

// getAvailableLLMConfigWithAPIKey — was dock's resolve-cfg-and-decrypt path.
// SDK exposes LLMConfigGet which returns plaintext APIKey. Wire that
// straight through; the workspace check is delegated to dock.
func (p *Plugin) getAvailableLLMConfigWithAPIKey(workspaceID string, configID int64) (*LLMConfig, string, error) {
	cfg, err := p.Dock.LLMConfigGet(configID, workspaceID)
	if err != nil {
		return nil, "", err
	}
	if cfg == nil {
		return nil, "", nil
	}
	out := &LLMConfig{
		ID:        cfg.ID,
		Name:      cfg.Name,
		BaseURL:   cfg.BaseURL,
		Model:     cfg.Model,
		ProxyURL:  cfg.ProxyURL,
		HasAPIKey: strings.TrimSpace(cfg.APIKey) != "",
	}
	return out, cfg.APIKey, nil
}

// ---- IOS app lookup ----------------------------------------------

// getIOSAppByID — was dock's iosdist_store.go::getIOSAppByID. Stub:
// look up via dock SDK if a /internal/v1/iosdist-apps/:id endpoint
// existed; for now log + return nil so the workspace check is
// effectively bypassed (caller falls through). Follow-up will either
// add the SDK surface or move iosdist into its own plugin too.
func (p *Plugin) getIOSAppByID(id int64) (*IOSApp, error) {
	log.Printf("projects: TODO(extract) getIOSAppByID id=%d — SDK has no iosdist surface yet, returning nil", id)
	return nil, nil
}

// ---- Chat / LLM thread persistence -------------------------------

// ensureChatThread + createLLMThread + sendChatMessage all originally
// wrote into dock's chat_threads / llm_threads / chat_messages tables.
// The extracted svc doesn't own those tables, so we stub: return a
// synthetic ID so handleProjectTaskPickup proceeds + the agent
// dispatch fires. Real path: SDK surfaces that wrap dock's existing
// chat handlers.
func (p *Plugin) ensureChatThread(userID, botUserID string, now time.Time) (*chatThread, error) {
	log.Printf("projects: TODO(extract) ensureChatThread user=%s bot=%s — returning synthetic id=0", userID, botUserID)
	return &chatThread{ID: 0}, nil
}

func (p *Plugin) createLLMThread(chatThreadID int64, userID, botUserID, title string, now time.Time) (*llmThread, error) {
	log.Printf("projects: TODO(extract) createLLMThread chat=%d user=%s bot=%s title=%q — returning synthetic id=0", chatThreadID, userID, botUserID, title)
	return &llmThread{ID: 0}, nil
}

func (p *Plugin) sendChatMessage(chatThreadID int64, llmThreadID *int64, senderID, senderName, body string, now time.Time) (int64, error) {
	log.Printf("projects: TODO(extract) sendChatMessage chat=%d sender=%s len=%d — noop", chatThreadID, senderID, len(body))
	return 0, nil
}

// ---- Prompt templates ---------------------------------------------

// renderPrompt — dock's prompt_templates_store.go::renderPrompt loaded
// editable prompt rows from DB. Stub uses only the in-code fallback
// template that the caller passes. Follow-up will either copy
// prompt_templates rows into polar_projects or add an SDK surface.
const (
	promptSlugProjectDecompose  = "project.decompose"
	promptSlugProjectPickupBody = "project.pickup_body"
)

func (p *Plugin) renderPrompt(slug string, data any, fallback string) string {
	// Render the fallback template against data using text/template
	// to honor the {{.Field}} placeholders. Mirrors dock's behavior
	// on a fresh install (no row in prompt_templates).
	out, err := renderTextTemplate(fallback, data)
	if err != nil {
		log.Printf("projects: renderPrompt slug=%s template error: %v — returning raw fallback", slug, err)
		return fallback
	}
	return out
}

// renderTextTemplate isolates the template invocation so importing
// text/template stays scoped to one spot.
func renderTextTemplate(tpl string, data any) (string, error) {
	t, err := newTemplate(tpl)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	if err := t.Execute(&sb, data); err != nil {
		return "", err
	}
	return sb.String(), nil
}

// ---- Retrospect / system-agent hooks -----------------------------

// fireRetrospectAsync — dock's task_retrospect.go entrypoint. In dock
// this kicked off an async LLM call. Stub: no-op. The user-facing 📋
// regenerate button (also stubbed) lets ops do it on demand.
func (p *Plugin) fireRetrospectAsync(projectID, taskID, workspaceID, userID string) {
	log.Printf("projects: TODO(extract) fireRetrospectAsync project=%s task=%s — noop", projectID, taskID)
}

// ---- Sentinel error helpers --------------------------------------

// _ keeps imports honest in earlier dev cycles when stubs change.
var (
	_ = http.StatusOK
	_ = context.Background
	_ = sql.ErrNoRows
	_ = strconv.Itoa
)
