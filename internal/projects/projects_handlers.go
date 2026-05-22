package projects

// HTTP handlers for the projects/features/tasks pipeline. All routes
// are workspace-scoped (X-Workspace-Id from AuthMiddleware).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const aiDecomposeTimeout = 90 * time.Second

// ---- project CRUD --------------------------------------------------

type projectCreateRequest struct {
	Name             string `json:"name"`
	Description      string `json:"description"`
	Template         string `json:"template"`
	RuntimeEnv       string `json:"runtime_env"`
	BusinessScenario string `json:"business_scenario"`
	CodeProvider     string `json:"code_provider"`
	GitRemoteURL     string `json:"git_remote_url"`
	IOSDistAppID     *int64 `json:"iosdist_app_id"`
}

func (p *Plugin) handleProjectCreate(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	userID, ok := requireUserID(c)
	if !ok {
		return
	}
	var req projectCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "项目名称不能为空且不超过 120 字"})
		return
	}
	proj := &Project{
		WorkspaceID:      workspaceID,
		CreatorUserID:    userID,
		Name:             name,
		Description:      strings.TrimSpace(req.Description),
		Template:         strings.TrimSpace(req.Template),
		RuntimeEnv:       strings.TrimSpace(req.RuntimeEnv),
		BusinessScenario: strings.TrimSpace(req.BusinessScenario),
		CodeProvider:     strings.TrimSpace(req.CodeProvider),
		GitRemoteURL:     strings.TrimSpace(req.GitRemoteURL),
		IOSDistAppID:     req.IOSDistAppID,
		Status:           ProjectStatusDraft,
	}
	if proj.IOSDistAppID != nil && *proj.IOSDistAppID > 0 {
		// Defend against cross-workspace binding — the bound app
		// must live in the same workspace as the project.
		app, aerr := p.getIOSAppByID(*proj.IOSDistAppID)
		if aerr != nil || app == nil || app.WorkspaceID != workspaceID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "iosdist_app_id 不属于当前工作区"})
			return
		}
	}
	if err := p.createProject(proj); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": proj})
}

func (p *Plugin) handleProjectList(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	projects, err := p.listProjects(workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func (p *Plugin) handleProjectDetail(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	project, err := p.getProject(id, workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	features, err := p.listProjectFeatures(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	tasks, err := p.listProjectTasks(project.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"project": project, "features": features, "tasks": tasks})
}

type projectUpdateRequest struct {
	Name             *string `json:"name"`
	Description      *string `json:"description"`
	Status           *string `json:"status"`
	Template         *string `json:"template"`
	RuntimeEnv       *string `json:"runtime_env"`
	BusinessScenario *string `json:"business_scenario"`
	CodeProvider     *string `json:"code_provider"`
	GitRemoteURL     *string `json:"git_remote_url"`
	// IOSDistAppID semantics:
	//   field absent in JSON → no change (nil pointer)
	//   field = null in JSON → unbind (sets DB column to NULL)
	//   field = number in JSON → bind to that iosdist_apps row
	// We detect "field present but null" via a separate flag set
	// during JSON parsing — see handleProjectUpdate below.
	IOSDistAppID *int64 `json:"iosdist_app_id"`
}

func (p *Plugin) handleProjectUpdate(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	existing, err := p.getProject(id, workspaceID)
	if err != nil || existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	var req projectUpdateRequest
	// ShouldBindBodyWith caches the body so we can re-parse it
	// further down to detect explicit-null fields (e.g.
	// `{"iosdist_app_id": null}` for an unbind). ShouldBindJSON
	// drains the body and the second parse below would see EOF.
	if err := c.ShouldBindBodyWith(&req, binding.JSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	u := ProjectMetaUpdate{}
	if req.Name != nil {
		v := strings.TrimSpace(*req.Name)
		if v != "" {
			u.Name = &v
		}
	}
	if req.Description != nil {
		v := strings.TrimSpace(*req.Description)
		u.Description = &v
	}
	if req.Status != nil {
		v := strings.TrimSpace(*req.Status)
		if v != "" {
			u.Status = &v
		}
	}
	if req.Template != nil {
		v := strings.TrimSpace(*req.Template)
		u.Template = &v
	}
	if req.RuntimeEnv != nil {
		v := strings.TrimSpace(*req.RuntimeEnv)
		u.RuntimeEnv = &v
	}
	if req.BusinessScenario != nil {
		v := strings.TrimSpace(*req.BusinessScenario)
		u.BusinessScenario = &v
	}
	if req.CodeProvider != nil {
		v := strings.TrimSpace(*req.CodeProvider)
		u.CodeProvider = &v
	}
	if req.GitRemoteURL != nil {
		v := strings.TrimSpace(*req.GitRemoteURL)
		u.GitRemoteURL = &v
	}
	// iosdist_app_id binding. Re-parse the cached body into a raw
	// map so we can distinguish "field absent" from "field = null".
	var raw map[string]json.RawMessage
	_ = c.ShouldBindBodyWith(&raw, binding.JSON)
	if rawVal, present := raw["iosdist_app_id"]; present {
		// Present in payload — could be a number or null.
		if string(rawVal) == "null" {
			// Explicit unbind.
			var zero *int64
			u.IOSDistAppID = &zero
		} else if req.IOSDistAppID != nil && *req.IOSDistAppID > 0 {
			// Validate workspace match before persisting.
			app, aerr := p.getIOSAppByID(*req.IOSDistAppID)
			if aerr != nil || app == nil || app.WorkspaceID != workspaceID {
				c.JSON(http.StatusBadRequest, gin.H{"error": "iosdist_app_id 不属于当前工作区"})
				return
			}
			val := req.IOSDistAppID
			u.IOSDistAppID = &val
		}
	}
	if err := p.updateProjectMetadata(id, workspaceID, u); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	updated, _ := p.getProject(id, workspaceID)
	c.JSON(http.StatusOK, gin.H{"project": updated})
}

func (p *Plugin) handleProjectDelete(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	if err := p.deleteProject(id, workspaceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- decompose -----------------------------------------------------

// decomposeData drives the project.decompose template. Persona is
// the bot's system_prompt (empty when no bot is selected for the
// run); EnvLabel and ScenarioLabel come from the project's
// runtime_env / business_scenario codes after label-mapping.
type decomposeData struct {
	Persona       string
	EnvLabel      string
	ScenarioLabel string
}

// defaultDecomposeTemplate is the in-code fallback. Mirrors the
// canonical default in promptTemplateDefaults() so behavior is
// identical to a fresh install.
const defaultDecomposeTemplate = `{{- if .Persona -}}
{{.Persona}}

---

{{ end -}}
你是一个产品经理助手。用户会提供一个产品想法（自然语言），你的任务是把它拆解成 5-12 个独立的功能（feature）。每个功能要可以单独实现、单独测试。

返回严格的 JSON 数组（不要 markdown 代码块、不要解释），每项包含：
- "title": 简短标题（中文，不超过 20 字）
- "description": 1-2 句话描述这个功能要做什么、用户会怎么用
- "complexity": "simple" | "medium" | "complex"，参考标准：simple = 单视图 + 静态数据；medium = 多视图 + 状态管理；complex = 涉及自定义动画、网络、持久化、设备能力

按用户预期的开发顺序排列功能（先做基础结构，再加内容，最后做动画 / 收尾）。
{{- if .EnvLabel }}

运行环境约束：
  {{.EnvLabel}}
所有 feature 必须在这个环境下可实现；不假设其他平台能力。
{{- end -}}
{{- if .ScenarioLabel }}

业务场景约束：
  {{.ScenarioLabel}}
拆解时聚焦此场景的核心交互。
{{- end -}}
{{- if and (not .EnvLabel) (not .ScenarioLabel) }}

对于「创意小游戏 / 文学+地理+历史 + 图 + 动画」类应用，重点关注表现层：UI 屏幕、内容展示方式、交互手势、动画效果。不要假设有后端 API（默认资源是 bundled 静态文件）。
{{- end }}

只返回 JSON 数组，不要任何其他文字。`

// runtimeEnvLabel returns a human-readable description of the
// runtime_env code stored on the project. Empty input → empty
// output (no constraint added to the prompt).
func runtimeEnvLabel(code string) string {
	switch strings.TrimSpace(code) {
	case "ios_swiftui":
		return "iOS native (SwiftUI) — 所有功能必须是单 app bundle 内可实现的，不假设有 backend API；资源用 bundle 静态文件"
	case "ios_uikit":
		return "iOS native (UIKit) — 同上但 UI 用 UIKit"
	case "macos_native":
		return "macOS native (SwiftUI / AppKit) — 桌面应用，可用本地文件系统"
	case "web_static":
		return "Web 静态页 (HTML + CSS + 原生 JS) — 没有后端，状态用 localStorage / IndexedDB"
	case "web_react":
		return "Web React 单页应用 — 用 Vite + React + TypeScript；没有后端假设"
	case "web_nextjs":
		return "Web Next.js 应用 — 可用 API routes 做轻量后端"
	case "cli_tool":
		return "命令行工具 (Python / Go / Bash 脚本) — 单文件可执行优先"
	case "chrome_ext":
		return "Chrome 扩展 (manifest v3) — 内容脚本 + 弹窗"
	case "research":
		return "研究 / 技术预研 — 不写代码，agent 用本地工具 (read_file / write_file / list_dir / run_cmd) + 平台 LLM 做调研、阅读、汇总，产出 markdown 报告"
	}
	return ""
}

// IsResearchProject returns true when the project's runtime_env
// signals a research / non-code workflow. Pickup uses this to
// pick the auto-registered research bot (classic + workspace LLM
// + agent tools) over the coder bots.
func IsResearchProject(p *Project) bool {
	if p == nil {
		return false
	}
	return strings.TrimSpace(p.RuntimeEnv) == "research"
}

// businessScenarioLabel maps the curated dropdown code to a
// natural-language hint for the decompose prompt.
func businessScenarioLabel(code string) string {
	switch strings.TrimSpace(code) {
	case "creative_game":
		return "创意小游戏 — 关注核心交互手势、关卡 / 关进阶、动画反馈"
	case "content_app":
		return "文学 / 历史 / 地理 / 教育内容应用 — 关注内容展示、检索、收藏、阅读体验"
	case "productivity":
		return "生产力 / 工具 — 关注核心任务流、键盘快捷键、稳定性"
	case "social":
		return "社交 / 互动 — 关注好友 / 互动 / 通知 / 分享"
	case "data_viz":
		return "数据可视化 — 关注图表类型、交互筛选、性能"
	case "commerce":
		return "商业 / 交易 — 关注商品展示、下单、支付链路（注意：本平台 MVP 不接真实支付，用 mock）"
	case "media":
		return "媒体 / 内容消费 — 关注播放、订阅、推荐"
	}
	return ""
}

// pickupBodyData carries every variable the project.pickup_body
// template can reference. Keep field names + tags in sync with
// the default template — adding a field here is a contract change
// that admins editing the template need to know about.
type pickupBodyData struct {
	EnvLabel      string
	ScenarioLabel string
	CodeProvider  string
	GitRemoteURL  string
	BundleID      string // From bound iosdist app; empty when project isn't iOS-flavored.
	Title         string
	Description   string
}

// buildPickupBody composes the first chat message we send the bot
// when a task is picked up. The template lives in DB
// (prompt_templates.project.pickup_body); admins can edit without
// a redeploy. The fallback in code defends against bad edits.
func (p *Plugin) buildPickupBody(project *Project, title, description string) string {
	bundleID := ""
	if project.IOSDistAppID != nil && *project.IOSDistAppID > 0 {
		// Best-effort lookup — if the iosdist app row was deleted
		// out from under us the lookup returns nil + we just skip
		// the bundle id chunk. Don't fail the pickup over it.
		if app, err := p.getIOSAppByID(*project.IOSDistAppID); err == nil && app != nil {
			bundleID = strings.TrimSpace(app.BundleID)
		}
	}
	data := pickupBodyData{
		EnvLabel:      runtimeEnvLabel(project.RuntimeEnv),
		ScenarioLabel: businessScenarioLabel(project.BusinessScenario),
		CodeProvider:  strings.TrimSpace(project.CodeProvider),
		GitRemoteURL:  strings.TrimSpace(project.GitRemoteURL),
		BundleID:      bundleID,
		Title:         strings.TrimSpace(title),
		Description:   strings.TrimSpace(description),
	}
	return p.renderPrompt(promptSlugProjectPickupBody, data, defaultPickupBodyTemplate)
}

// defaultPickupBodyTemplate is the in-code fallback used when the
// DB row is missing AND we want to keep serving requests. Mirrors
// promptTemplateDefaults() so behavior is identical to a fresh
// install.
const defaultPickupBodyTemplate = `{{- $hasHeader := or .EnvLabel .ScenarioLabel -}}
{{- $hasHeader = or $hasHeader .CodeProvider -}}
{{- $hasHeader = or $hasHeader .GitRemoteURL -}}
{{- $hasHeader = or $hasHeader .BundleID -}}
{{- if $hasHeader -}}
【任务约束】
{{- if .EnvLabel }}
运行环境：{{.EnvLabel}}
{{- end -}}
{{- if .ScenarioLabel }}
业务场景：{{.ScenarioLabel}}
{{- end -}}
{{- if .CodeProvider }}
首选编码工具：{{.CodeProvider}}
{{- end -}}
{{- if .GitRemoteURL }}
Git 远端：{{.GitRemoteURL}}（polar-agent 已 chdir 到 cwd 并配好 origin；只在 cwd 操作，不要 cd 到兄弟目录）
{{- end -}}
{{- if .BundleID }}
iOS Bundle ID：{{.BundleID}}
构建工具：用 xcodegen 生成 .xcodeproj，不要手编。Project.swift / project.yml 放在 cwd 根。
最终输出：unsigned IPA。xcodebuild archive 时用 CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO，再 xcodebuild -exportArchive 用一份 method=development 的 ExportOptions.plist。
任务结束前调用：polar-agent submit-build <path-to-ipa>，由 agent 完成签名 + 上传 TestFlight。
{{- end }}

【任务】
{{ end -}}
{{ .Title }}
{{- if .Description }}

{{ .Description }}
{{- end }}`

// buildDecomposePromptWithPersona renders the project.decompose
// template against the project + optional bot persona. Persona
// is prepended inside the template (not concatenated outside) so
// admins can rearrange or remove it via the editable template
// without code changes.
func (p *Plugin) buildDecomposePromptWithPersona(proj *Project, persona string) string {
	return p.renderPrompt(promptSlugProjectDecompose, decomposeData{
		Persona:       strings.TrimSpace(persona),
		EnvLabel:      runtimeEnvLabel(proj.RuntimeEnv),
		ScenarioLabel: businessScenarioLabel(proj.BusinessScenario),
	}, defaultDecomposeTemplate)
}

// buildDecomposePrompt is the no-persona convenience wrapper.
func (p *Plugin) buildDecomposePrompt(proj *Project) string {
	return p.buildDecomposePromptWithPersona(proj, "")
}

type decomposedFeature struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Complexity  string `json:"complexity"`
}

func (p *Plugin) handleProjectDecompose(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	id := strings.TrimSpace(c.Param("id"))
	project, err := p.getProject(id, workspaceID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	if strings.TrimSpace(project.Description) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先填写项目描述（产品想法）"})
		return
	}
	if p.aiAgent == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI Agent 未初始化"})
		return
	}

	// Optional explicit picks (for A/B comparison: same project,
	// different bot/LLM each click). Body is JSON:
	//   - bot_user_id:   contributes the bot's system_prompt as a
	//                    custom decompose persona prefix
	//   - llm_config_id: which LLM config to actually call
	//   - both empty:    auto-pick first available with API key
	//
	// Resolution order (explicit user pick wins):
	//   1. If llm_config_id is set, use that LLM (whether or not a
	//      bot was also picked).
	//   2. Else if bot_user_id is set + bot has an LLM, use bot's LLM.
	//   3. Else auto-pick first available.
	// bot_user_id always contributes the persona prefix when present.
	var req struct {
		LLMConfigID int64  `json:"llm_config_id"`
		BotUserID   string `json:"bot_user_id"`
	}
	_ = c.ShouldBindJSON(&req)

	var (
		chosen     *LLMConfig
		botPersona string
	)
	if bid := strings.TrimSpace(req.BotUserID); bid != "" {
		bot, err := p.getBotUserByUserID(bid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
			return
		}
		if bot == nil || bot.WorkspaceID != workspaceID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "选定的 bot 不在当前工作区"})
			return
		}
		botPersona = strings.TrimSpace(bot.SystemPrompt)
		// Only fall back to the bot's LLM when the user didn't pick
		// one explicitly. Explicit llm_config_id always wins —
		// otherwise the dropdown is a lie.
		if req.LLMConfigID <= 0 {
			if bot.BotKind == BotKindPassthrough || bot.LLMConfigID <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "未选 LLM 且该 bot 没绑定 LLM config（passthrough bot 不能裸用）"})
				return
			}
			req.LLMConfigID = bot.LLMConfigID
		}
	}

	configs, err := p.listAvailableLLMConfigs(workspaceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if req.LLMConfigID > 0 {
		for i := range configs {
			if configs[i].ID == req.LLMConfigID {
				chosen = &configs[i]
				break
			}
		}
		if chosen == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "选定的 LLM 配置在此工作区不可用"})
			return
		}
		if !chosen.HasAPIKey {
			c.JSON(http.StatusBadRequest, gin.H{"error": "选定的 LLM 配置没有 API Key"})
			return
		}
	} else {
		// Auto-pick: platform default (is_platform=TRUE) sorts first
		// in listAvailableLLMConfigs, so configs[0] when present.
		for i := range configs {
			if configs[i].HasAPIKey {
				chosen = &configs[i]
				break
			}
		}
		if chosen == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "没有可用的 LLM 配置；请联系管理员开通平台默认 LLM 或自行添加配置"})
			return
		}
	}
	cfg, apiKey, err := p.getAvailableLLMConfigWithAPIKey(workspaceID, chosen.ID)
	if err != nil || cfg == nil || strings.TrimSpace(apiKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "选定的 LLM 配置无 API Key"})
		return
	}

	runtimeConfig := aiRuntimeConfig{
		APIKey:       apiKey,
		BaseURL:      cfg.BaseURL,
		Model:        cfg.Model,
		SystemPrompt: p.buildDecomposePromptWithPersona(project, botPersona),
		ProxyURL:     cfg.ProxyURL,
		Endpoint:     "project_decompose",
	}
	payload := aiChatCompletionRequest{
		Model: runtimeConfig.Model,
		Messages: []aiChatCompletionMessage{
			{Role: "system", Content: runtimeConfig.SystemPrompt},
			{Role: "user", Content: "项目名称：" + project.Name + "\n\n产品描述：\n" + project.Description},
		},
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), aiDecomposeTimeout)
	defer cancel()
	_ = ctx // requestChatCompletion uses its own deadline; ctx kept for future streaming
	result, err := p.aiAgent.requestChatCompletion(runtimeConfig, payload)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "调用 LLM 失败：" + err.Error()})
		return
	}
	if len(result.Choices) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "LLM 返回为空"})
		return
	}
	raw := strings.TrimSpace(result.Choices[0].Message.Content)
	// Some models still wrap JSON in code fences despite the system
	// prompt. Strip those to be tolerant.
	raw = stripCodeFences(raw)

	var decomposed []decomposedFeature
	if err := json.Unmarshal([]byte(raw), &decomposed); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "LLM 返回不是合法 JSON 数组：" + err.Error(),
			"raw":     raw,
			"hint":    "可能是模型对 prompt 理解不到位；可改写描述后重试",
		})
		return
	}
	if len(decomposed) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "LLM 没有拆出任何功能"})
		return
	}

	features := make([]ProjectFeature, 0, len(decomposed))
	for _, d := range decomposed {
		title := strings.TrimSpace(d.Title)
		if title == "" {
			continue
		}
		complexity := strings.TrimSpace(d.Complexity)
		switch complexity {
		case ProjectFeatureComplexitySimple, ProjectFeatureComplexityMedium, ProjectFeatureComplexityComplex:
		default:
			complexity = ProjectFeatureComplexityMedium
		}
		features = append(features, ProjectFeature{
			Title:       title,
			Description: strings.TrimSpace(d.Description),
			Complexity:  complexity,
			Selected:    true, // default pre-checked; user un-checks unwanted ones
		})
	}
	// Sprint mode: append (don't replace) — old sprints stay
	// visible. appendProjectFeatures atomically increments the
	// project's current_sprint and tags the new features with it.
	newSprint, err := p.appendProjectFeatures(project.ID, features)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	// Bump status to planning on the very first sprint.
	if project.Status == ProjectStatusDraft {
		st := ProjectStatusPlanning
		_ = p.updateProjectMetadata(project.ID, workspaceID, ProjectMetaUpdate{Status: &st})
	}
	// Pin the LLM the user just decomposed with onto the project.
	// Sub-task chats inherit this so they don't silently fall back
	// to the workspace default. Always overwrite — the most recent
	// decompose's pick is the project's "current model". Best-effort:
	// don't fail the response if the UPDATE hiccups, the features
	// already landed.
	{
		pickID := chosen.ID
		_ = p.updateProjectMetadata(project.ID, workspaceID, ProjectMetaUpdate{DefaultLLMConfigID: &pickID})
	}
	// Re-read the just-inserted features so SprintNumber is set
	// on each (appendProjectFeatures mutates the slice but the
	// initial loop only set Title/Description/Complexity/Selected).
	resp := gin.H{
		"features":   features,
		"new_sprint": newSprint,
		"llm_used": gin.H{
			"id":    chosen.ID,
			"name":  chosen.Name,
			"model": chosen.Model,
		},
	}
	if botPersona != "" {
		resp["bot_used"] = gin.H{
			"bot_user_id":   strings.TrimSpace(req.BotUserID),
			"persona_chars": len(botPersona),
		}
	}
	c.JSON(http.StatusOK, resp)
}

// stripCodeFences removes wrapping ```json ... ``` fences that some
// models add. Tolerant: if the input doesn't have fences it's
// returned as-is.
func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		// Drop everything up to the first newline (the ``` or ```json line)
		if nl := strings.IndexByte(s, '\n'); nl >= 0 {
			s = s[nl+1:]
		}
	}
	if strings.HasSuffix(s, "```") {
		s = strings.TrimSuffix(s, "```")
	}
	return strings.TrimSpace(s)
}

// ---- features ------------------------------------------------------

type projectFeatureUpdateRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Complexity  string `json:"complexity"`
	Selected    bool   `json:"selected"`
}

func (p *Plugin) handleProjectFeatureUpdate(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if _, err := p.getProject(projectID, workspaceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	featureID := strings.TrimSpace(c.Param("feature_id"))
	var req projectFeatureUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	complexity := strings.TrimSpace(req.Complexity)
	switch complexity {
	case ProjectFeatureComplexitySimple, ProjectFeatureComplexityMedium, ProjectFeatureComplexityComplex:
	default:
		complexity = ProjectFeatureComplexityMedium
	}
	if err := p.updateProjectFeature(projectID, featureID, strings.TrimSpace(req.Title), strings.TrimSpace(req.Description), complexity, req.Selected); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "功能不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (p *Plugin) handleProjectFeatureDelete(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if _, err := p.getProject(projectID, workspaceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	featureID := strings.TrimSpace(c.Param("feature_id"))
	if err := p.deleteProjectFeature(projectID, featureID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "功能不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- plan generation -----------------------------------------------

func (p *Plugin) handleProjectGeneratePlan(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	project, err := p.getProject(projectID, workspaceID)
	if err != nil || project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	tasks, err := p.generatePlanFromSelectedFeatures(projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tasks": tasks, "created_count": len(tasks)})
}

// ---- task pickup (assign to bot) ----------------------------------

type projectTaskPickupRequest struct {
	BotUserID string `json:"bot_user_id" binding:"required"`
}

type projectTaskPickupResponse struct {
	Task         ProjectTask `json:"task"`
	ChatThreadID int64       `json:"chat_thread_id"`
	LLMThreadID  int64       `json:"llm_thread_id"`
	BotName      string      `json:"bot_name"`
}

// handleProjectTaskPickup wires a project task to a bot user. It
// creates (or reuses) the user↔bot chat thread, opens a fresh
// llm_thread titled after the task, writes the task description as
// the user's first message, and enqueues an aiAgentTask so the bot
// (or its attached polar-agent) starts responding immediately.
//
// Per 用户 ("1:1 task↔chat thread mapping"): each task gets its own
// llm_thread inside the shared (user, bot) chat thread. kimi-cli
// passthrough mode rides its own --continue session keyed on
// workdir, so cross-task continuity falls out for free.
func (p *Plugin) handleProjectTaskPickup(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	userID, _ := c.Get("user_id")
	userIDStr, _ := userID.(string)
	if userIDStr == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	project, err := p.getProject(projectID, workspaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if project == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "项目不存在"})
		return
	}
	taskID := strings.TrimSpace(c.Param("task_id"))
	task, err := p.loadProjectTask(projectID, taskID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	var req projectTaskPickupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	botUserID := strings.TrimSpace(req.BotUserID)
	if !strings.HasPrefix(botUserID, "bot_") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bot_user_id 必须是一个 bot 用户"})
		return
	}
	bot, err := p.getBotUserByUserID(botUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if bot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "bot 不存在"})
		return
	}
	if bot.WorkspaceID != workspaceID {
		c.JSON(http.StatusForbidden, gin.H{"error": "该 bot 不属于当前工作区"})
		return
	}

	// Guard against the most common foot-gun: pickup before
	// polar-agent has reconnected. If no agent is attached, the
	// platform falls through to the bot's configured LLM, which
	// usually isn't what users want here (the LLM may be unset,
	// have a wrong base URL, or be a reachable-but-paid model).
	// Cheaper to refuse with a clear message than to bill a
	// confusing 400/500 from the LLM API.
	if p.agentHub == nil || p.agentHub.lookup(botUserID) == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "该 bot 的本地 polar-agent 还没连上。请先在终端 `polar-agent attach --bot=" + botUserID + " --kimi` 再点派单。",
			"code":  "agent_not_attached",
		})
		return
	}

	now := time.Now()
	chatThread, err := p.ensureChatThread(userIDStr, botUserID, now)
	if err != nil {
		log.Printf("pickup: ensureChatThread project=%s task=%s bot=%s: %v", projectID, taskID, botUserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	llmThread, err := p.createLLMThread(chatThread.ID, userIDStr, botUserID, "[Task] "+task.Title, now)
	if err != nil {
		log.Printf("pickup: createLLMThread project=%s task=%s bot=%s: %v", projectID, taskID, botUserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	if llmThread == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "初始化任务话题失败"})
		return
	}

	// Persist the wiring on the task before sending the message —
	// avoids a stale task state if the message send fails.
	if _, err := p.DB.Exec(
		`UPDATE project_tasks
		 SET bot_user_id = $1,
		     chat_thread_id = $2,
		     llm_thread_id = $3,
		     status = CASE WHEN status IN ($4, $5) THEN $6 ELSE status END,
		     started_at = COALESCE(started_at, $7),
		     updated_at = $7
		 WHERE id = $8 AND project_id = $9`,
		botUserID, chatThread.ID, llmThread.ID,
		ProjectTaskStatusTodo, ProjectTaskStatusBlocked,
		ProjectTaskStatusInProgress,
		now, taskID, projectID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	// First message body: title + project constraints (runtime env
	// + business scenario) + description. The constraint header is
	// what stops the local coding tool from picking the wrong stack
	// — without it, kimi/claude/codex tend to default to whatever
	// they're freshest on (often Web React when the project is
	// supposed to be SwiftUI).
	body := p.buildPickupBody(project, task.Title, task.Description)
	username, _ := c.Get("username")
	senderName, _ := username.(string)
	llmThreadIDPtr := &llmThread.ID
	if _, err := p.sendChatMessage(chatThread.ID, llmThreadIDPtr, userIDStr, senderName, body, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "消息发送失败"})
		return
	}
	if p.aiAgent != nil {
		p.aiAgent.enqueue(aiAgentTask{
			ThreadID:        chatThread.ID,
			LLMThreadID:     llmThreadIDPtr,
			UserID:          userIDStr,
			ResponderUserID: botUserID,
			ResponderName:   bot.Name,
			Content:         body,
			// Per-project subdir under the agent's pinned workdir
			// (e.g. ~/work/myrepo/<project_id>/) so two concurrent
			// projects on one agent don't fight over the same files.
			WorkdirSubpath: project.ID,
			// Phase 1 of Stage 5 push: agent commits+pushes whatever
			// the coder wrote when this is set. Empty = no git work.
			GitRemoteURL: project.GitRemoteURL,
		})
	}

	updated, err := p.loadProjectTask(projectID, taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, projectTaskPickupResponse{
		Task:         *updated,
		ChatThreadID: chatThread.ID,
		LLMThreadID:  llmThread.ID,
		BotName:      bot.Name,
	})
}

// ---- task update ---------------------------------------------------

type projectTaskUpdateRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	// AuditSource (optional): when set to "system_agent_sharpen",
	// the handler snapshots the pre-update task into
	// project_task_revisions before applying the change. AuditLLMName
	// + AuditLLMModel are the LLM that produced the rewrite (4-touchpoint
	// transparency rule). Empty source = no audit row.
	AuditSource   string `json:"audit_source"`
	AuditLLMName  string `json:"audit_llm_name"`
	AuditLLMModel string `json:"audit_llm_model"`
}

func (p *Plugin) handleProjectTaskUpdate(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	userIDAny, _ := c.Get("user_id")
	userIDStr, _ := userIDAny.(string)
	projectID := strings.TrimSpace(c.Param("id"))
	if _, err := p.getProject(projectID, workspaceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	taskID := strings.TrimSpace(c.Param("task_id"))
	var req projectTaskUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	u := ProjectTaskUpdate{}
	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		u.Title = &t
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		u.Description = &d
	}
	if req.Status != nil {
		st := strings.TrimSpace(*req.Status)
		switch st {
		case ProjectTaskStatusTodo, ProjectTaskStatusInProgress, ProjectTaskStatusReview, ProjectTaskStatusDone, ProjectTaskStatusBlocked:
			u.Status = &st
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "状态值无效"})
			return
		}
	}

	// Audit hook: snapshot the pre-update task into
	// project_task_revisions in the SAME transaction as the UPDATE.
	// Goes through updateProjectTaskWithAudit so a crash mid-flight
	// can't leave an orphan revision row (the audit-loss race fixed
	// in the system-agent hardening pass).
	var auditPtr *taskRevisionAudit
	if strings.TrimSpace(req.AuditSource) != "" {
		auditPtr = &taskRevisionAudit{
			Source:    req.AuditSource,
			LLMName:   req.AuditLLMName,
			LLMModel:  req.AuditLLMModel,
			CreatedBy: userIDStr,
		}
	}
	if err := p.updateProjectTaskWithAudit(projectID, taskID, u, auditPtr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}

	// Auto-trigger task retrospect when status flips to done.
	// Fire-and-forget — losing the auto retrospect is fine (user
	// can hit 📋 to regenerate). Doesn't block the response.
	if u.Status != nil && *u.Status == ProjectTaskStatusDone {
		p.fireRetrospectAsync(projectID, taskID, workspaceID, userIDStr)
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- task bulk status -------------------------------------------

type projectTaskBulkStatusRequest struct {
	// Status to apply to matched tasks. Required, must be one of
	// the canonical task statuses.
	Status string `json:"status" binding:"required"`
	// FromStatuses (optional): only update tasks whose current
	// status is in this list. Empty = update every task in the
	// project. Common patterns:
	//   ["todo", "in_progress"] → "✗ 取消所有未完成"
	//   ["in_progress", "review"] → "✓ 完成所有进行中"
	FromStatuses []string `json:"from_statuses"`
}

// handleProjectTaskBulkStatus updates the status of many tasks in
// one query. Mirrors the per-task handleProjectTaskUpdate
// validation but does the work in a single SQL pass instead of N
// round-trips from the FE.
func (p *Plugin) handleProjectTaskBulkStatus(c *gin.Context) {
	workspaceID, ok := requireWorkspaceID(c)
	if !ok {
		return
	}
	projectID := strings.TrimSpace(c.Param("id"))
	if _, err := p.getProject(projectID, workspaceID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	var req projectTaskBulkStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的输入数据"})
		return
	}
	target := strings.TrimSpace(req.Status)
	switch target {
	case ProjectTaskStatusTodo, ProjectTaskStatusInProgress, ProjectTaskStatusReview, ProjectTaskStatusDone, ProjectTaskStatusBlocked:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "状态值无效"})
		return
	}
	// Validate the optional filter list — same enum check, prevents
	// clients from passing arbitrary strings into the SQL ANY().
	for _, st := range req.FromStatuses {
		switch strings.TrimSpace(st) {
		case ProjectTaskStatusTodo, ProjectTaskStatusInProgress, ProjectTaskStatusReview, ProjectTaskStatusDone, ProjectTaskStatusBlocked:
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "from_statuses 包含无效值: " + st})
			return
		}
	}
	count, err := p.bulkUpdateProjectTaskStatus(projectID, target, req.FromStatuses)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "服务器错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "updated": count})
}
