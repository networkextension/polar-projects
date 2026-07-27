// Projects page — phase 1.2 of the AI-driven workflow.
//
// One page covers the full pre-coding pipeline:
//   create project → write description → AI decompose into features →
//   user picks which features → generate plan → tasks list shows up.
//
// Per-task chat thread (1:1) wiring + bot pickup come in phase 1.3.

import { fetchAvailableLLMConfigs, fetchBotUsers } from "./vendor/dashboard.js";
import {
  bulkUpdateProjectTaskStatus,
  createAgentToken,
  createProject,
  decomposeProject,
  deleteProject,
  fetchAgentBotStatus,
  deleteProjectFeature,
  fetchAgentTokens,
  fetchProject,
  fetchProjects,
  fetchResearchRuns,
  generateProjectPlan,
  pickupProjectTask,
  dispatchResearchTask,
  revokeAgentToken,
  updateProject,
  updateProjectFeature,
  updateProjectTask,
} from "./api/projects.js";
import type { ResearchRun } from "./api/projects.js";
import { fetchCurrentUser, logout } from "@networkextension/polar-ui-common/api/session";
import { fetchIOSApps } from "./vendor/iosdist.js";
import type { BotUser } from "./vendor/dashboard-types.js";
import type { ChatLLMConfig } from "./vendor/chat-types.js";
import type { IOSApp } from "./vendor/iosdist-types.js";
import { byId } from "@networkextension/polar-ui-common/lib/dom";
import { hydrateSiteBrand, renderSidebarFoot } from "@networkextension/polar-ui-common/lib/site";
import { mountPlatformNav } from "@networkextension/polar-ui-common/lib/sidebar";
import { bindThemeSync, initStoredTheme } from "@networkextension/polar-ui-common/lib/theme";
import type {
  AgentCoderEntry,
  AgentToken,
  CoderAuthMode,
  CoderName,
  FeatureComplexity,
  Project,
  ProjectFeature,
  ProjectStatus,
  ProjectTask,
  TaskStatus,
} from "./types/projects.js";

initStoredTheme();
bindThemeSync();

const listEl = byId<HTMLElement>("projectsList");
const emptyEl = byId<HTMLElement>("projectsEmpty");
const panelEl = byId<HTMLElement>("projectsPanel");
const filterSearchEl = byId<HTMLInputElement>("projectsFilterSearch");
const filterStatusEl = byId<HTMLSelectElement>("projectsFilterStatus");
const filterCodeProviderEl = byId<HTMLSelectElement>("projectsFilterCodeProvider");
const filterCountEl = byId<HTMLElement>("projectsFilterCount");

const nameEl = byId<HTMLElement>("projectsName");
const statusPillEl = byId<HTMLElement>("projectsStatusPill");
const createdAtEl = byId<HTMLElement>("projectsCreatedAt");
const deleteBtn = byId<HTMLButtonElement>("projectsDeleteBtn");

const descEl = byId<HTMLTextAreaElement>("projectsDescription");
const saveDescBtn = byId<HTMLButtonElement>("projectsSaveDescBtn");
const gitRemoteUrlEl = byId<HTMLInputElement>("projectsGitRemoteUrl");
const saveGitRemoteBtn = byId<HTMLButtonElement>("projectsSaveGitRemoteBtn");
const iosDistAppSelect = byId<HTMLSelectElement>("projectsIOSDistAppSelect");
const iosDistAppMetaEl = byId<HTMLElement>("projectsIOSDistAppMeta");
const saveIOSDistAppBtn = byId<HTMLButtonElement>("projectsSaveIOSDistAppBtn");
const decomposeBtn = byId<HTMLButtonElement>("projectsDecomposeBtn");
const decomposeStatusEl = byId<HTMLElement>("projectsDecomposeStatus");
const decomposeLLMSelect = byId<HTMLSelectElement>("projectsDecomposeLLMSelect");
const decomposeBotSelect = byId<HTMLSelectElement>("projectsDecomposeBotSelect");

const featuresSection = byId<HTMLElement>("projectsFeaturesSection");
const featuresListEl = byId<HTMLElement>("projectsFeaturesList");
const featuresCountEl = byId<HTMLElement>("projectsFeaturesCount");
const generatePlanBtn = byId<HTMLButtonElement>("projectsGeneratePlanBtn");
const planStatusEl = byId<HTMLElement>("projectsPlanStatus");

const tasksSection = byId<HTMLElement>("projectsTasksSection");
const tasksListEl = byId<HTMLElement>("projectsTasksList");
const tasksCountEl = byId<HTMLElement>("projectsTasksCount");
const featuresCollapseBtn = byId<HTMLButtonElement>("projectsFeaturesCollapseBtn");
const featuresBodyEl = byId<HTMLElement>("projectsFeaturesBody");
const tasksCollapseBtn = byId<HTMLButtonElement>("projectsTasksCollapseBtn");
const dispatchAllBotSelect = byId<HTMLSelectElement>("projectsDispatchAllBot");
const dispatchAllBtn = byId<HTMLButtonElement>("projectsDispatchAllBtn");
const finishAllBtn = byId<HTMLButtonElement>("projectsFinishAllBtn");
const cancelAllBtn = byId<HTMLButtonElement>("projectsCancelAllBtn");
const dispatchAllStatusEl = byId<HTMLElement>("projectsDispatchAllStatus");
const researchSectionEl = byId<HTMLElement>("projectsResearchSection");
const researchListEl = byId<HTMLElement>("projectsResearchList");
const researchCountEl = byId<HTMLElement>("projectsResearchCount");
const researchRefreshBtn = byId<HTMLButtonElement>("projectsResearchRefreshBtn");
const researchCollapseBtn = byId<HTMLButtonElement>("projectsResearchCollapseBtn");

const newBtn = byId<HTMLButtonElement>("projectsNewBtn");
const agentTokensBtn = byId<HTMLButtonElement>("projectsAgentTokensBtn");
const agentTokensModal = byId<HTMLElement>("agentTokensModal");
const agentTokensModalCloseBtn = byId<HTMLButtonElement>("agentTokensModalCloseBtn");
const agentTokenNameInput = byId<HTMLInputElement>("agentTokenName");
const agentTokenCreateBtn = byId<HTMLButtonElement>("agentTokenCreateBtn");
const agentTokenJustCreatedEl = byId<HTMLElement>("agentTokenJustCreated");
const agentTokenJustCreatedRawEl = byId<HTMLElement>("agentTokenJustCreatedRaw");
const agentTokenCopyBtn = byId<HTMLButtonElement>("agentTokenCopyBtn");
const agentTokensListEl = byId<HTMLElement>("agentTokensList");
const agentTokenCoderRowsEl = byId<HTMLElement>("agentTokenCoderRows");
const agentTokenInstallScriptEl = byId<HTMLTextAreaElement>("agentTokenInstallScript");
const agentTokenScriptCopyBtn = byId<HTMLButtonElement>("agentTokenScriptCopyBtn");
const agentTokenScriptDownloadBtn = byId<HTMLButtonElement>("agentTokenScriptDownloadBtn");
const createModal = byId<HTMLElement>("projectsCreateModal");
const createModalCloseBtn = byId<HTMLButtonElement>("projectsCreateModalCloseBtn");
const createForm = byId<HTMLFormElement>("projectsCreateForm");
const createName = byId<HTMLInputElement>("projectsCreateName");
const createDesc = byId<HTMLTextAreaElement>("projectsCreateDescription");
const createRuntimeEnv = byId<HTMLSelectElement>("projectsCreateRuntimeEnv");
const createBusinessScenario = byId<HTMLSelectElement>("projectsCreateBusinessScenario");
const createCodeProvider = byId<HTMLSelectElement>("projectsCreateCodeProvider");
const createGitRemoteUrl = byId<HTMLInputElement>("projectsCreateGitRemoteUrl");
const createStatusEl = byId<HTMLElement>("projectsCreateStatus");

const RUNTIME_ENV_LABELS: Record<string, string> = {
  ios_swiftui: "iOS · SwiftUI",
  ios_uikit: "iOS · UIKit",
  macos_native: "macOS",
  web_static: "Web 静态",
  web_react: "Web React",
  web_nextjs: "Web Next.js",
  cli_tool: "CLI 工具",
  chrome_ext: "Chrome 扩展",
  research: "🔍 研究",
};

const BUSINESS_SCENARIO_LABELS: Record<string, string> = {
  creative_game: "创意小游戏",
  content_app: "文学/历史/教育内容",
  productivity: "生产力工具",
  social: "社交互动",
  data_viz: "数据可视化",
  commerce: "商业/交易",
  media: "媒体内容",
};

let projects: Project[] = [];
let activeProjectID: string | null = null;
let activeProject: Project | null = null;
let activeFeatures: ProjectFeature[] = [];
let activeTasks: ProjectTask[] = [];
let activeResearchRuns: ResearchRun[] = [];
let availableBots: BotUser[] = [];
// availableLLMConfigs caches the workspace-available LLM configs so
// the dispatch confirm modal can preview "项目默认 LLM" without
// blocking on a fresh fetch. Populated by loadDecomposeLLMs.
let availableLLMConfigs: ChatLLMConfig[] = [];
let pickerOpenForTaskID: string | null = null;
// botToolMap caches each bot's currently-attached agent tool name
// (kimi/claude/codex/...) so the pickup picker can highlight bots
// matching the active project's code_provider. Empty string means
// "no agent attached" or "tool-loop mode".
let botToolMap: Record<string, string> = {};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "草稿",
  planning: "规划中",
  building: "开发中",
  beta: "外测中",
  shipped: "已发布",
  archived: "已归档",
};

const COMPLEXITY_LABEL: Record<FeatureComplexity, string> = {
  simple: "简单",
  medium: "中等",
  complex: "复杂",
};

const COMPLEXITY_COLOR: Record<FeatureComplexity, string> = {
  simple: "#3a7",
  medium: "#c80",
  complex: "#c33",
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  review: "待审",
  done: "完成",
  blocked: "阻塞",
};

const TASK_STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "review", "done", "blocked"];

function setModalOpen(modal: HTMLElement, open: boolean): void {
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

function setStatus(el: HTMLElement, msg: string, isError: boolean): void {
  el.textContent = msg;
  el.style.color = isError ? "#c33" : "#3a7";
}

function clearStatus(el: HTMLElement): void {
  el.textContent = "";
  el.style.color = "";
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- list rendering -----------------------------------------------

// applyProjectFilter applies the search + status + code_provider
// filters to the loaded `projects` array. Pure client-side; the
// list endpoint returns everything in the workspace and the
// filter row narrows the visible subset.
function applyProjectFilter(): Project[] {
  const search = filterSearchEl.value.trim().toLowerCase();
  const status = filterStatusEl.value;
  const provider = filterCodeProviderEl.value;
  return projects.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search)) {
      return false;
    }
    if (status && p.status !== status) {
      return false;
    }
    if (provider) {
      // Special sentinel: "__none__" matches projects with no
      // code_provider set (empty string).
      if (provider === "__none__" && p.code_provider !== "") {
        return false;
      }
      if (provider !== "__none__" && p.code_provider !== provider) {
        return false;
      }
    }
    return true;
  });
}

function renderProjectList(): void {
  if (projects.length === 0) {
    filterCountEl.textContent = "";
    listEl.innerHTML = `<div class="chat-empty">还没有项目，点右上角「＋ 新建项目」开始</div>`;
    return;
  }
  const filtered = applyProjectFilter();
  filterCountEl.textContent = filtered.length === projects.length
    ? `${projects.length}`
    : `${filtered.length}/${projects.length}`;
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="chat-empty">没有符合筛选条件的项目</div>`;
    return;
  }
  listEl.innerHTML = filtered
    .map((p) => {
      const active = p.id === activeProjectID ? "active" : "";
      const providerTag = p.code_provider
        ? ` · <span style="color:#3a7;">${escapeHTML(p.code_provider)}</span>`
        : "";
      return `
        <div class="video-studio-project-item ${active}" data-project-id="${escapeHTML(p.id)}">
          <div style="width:32px; height:32px; border-radius:8px; background:linear-gradient(135deg,#e9e9ef,#cfd0d6); display:flex; align-items:center; justify-content:center; font-size:14px; color:#666; flex-shrink:0;">✦</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(p.name)}</div>
            <div style="font-size:11px; color:var(--text-muted,#888);">${STATUS_LABEL[p.status] ?? p.status}${providerTag}</div>
          </div>
        </div>`;
    })
    .join("");
  listEl.querySelectorAll<HTMLElement>("[data-project-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-project-id");
      if (id) void openProject(id);
    });
  });
}

function renderProjectPanel(): void {
  if (!activeProject) {
    emptyEl.hidden = false;
    panelEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  panelEl.hidden = false;
  nameEl.textContent = activeProject.name;
  // Project status pill plus the (optional) constraint badges so
  // the user always sees what stack + scenario is locking the AI
  // 拆解 — these are the things that make the difference between
  // "useful feature list" and "generic SaaS plan".
  const constraintChips: string[] = [];
  const env = activeProject.runtime_env;
  const scenario = activeProject.business_scenario;
  const codeProvider = activeProject.code_provider;
  if (env && RUNTIME_ENV_LABELS[env]) {
    constraintChips.push(`<span class="tag-chip" title="运行环境">${RUNTIME_ENV_LABELS[env]}</span>`);
  }
  if (scenario && BUSINESS_SCENARIO_LABELS[scenario]) {
    constraintChips.push(`<span class="tag-chip" title="业务场景">${BUSINESS_SCENARIO_LABELS[scenario]}</span>`);
  }
  if (codeProvider) {
    constraintChips.push(`<span class="tag-chip tag-chip-accent" title="首选编码工具">🤖 ${escapeHTML(codeProvider)}</span>`);
  }
  statusPillEl.innerHTML = `${STATUS_LABEL[activeProject.status] ?? activeProject.status} ${constraintChips.join(" ")}`;
  createdAtEl.textContent = `创建于 ${new Date(activeProject.created_at).toLocaleString()}`;
  descEl.value = activeProject.description;
  gitRemoteUrlEl.value = activeProject.git_remote_url || "";
  syncIOSDistAppSelect();
  clearStatus(decomposeStatusEl);
  clearStatus(planStatusEl);
  // Decompose button text reflects whether this is the first
  // decompose (sprint=0) or an iteration (current_sprint > 0).
  const sprint = activeProject.current_sprint || 0;
  decomposeBtn.textContent = sprint === 0
    ? "AI 拆解功能 →"
    : `AI 拆解 → Sprint ${sprint + 1} →`;

  renderFeatures();
  renderTasks();
  renderResearchRuns();
}

// groupBySprint splits a sorted-by-sprint slice into [sprint, items[]].
// Pre-condition: items already sorted by sprint_number ASC then ord
// (which is what listProjectFeatures / listProjectTasks return).
function groupBySprint<T extends { sprint_number: number }>(items: T[]): Array<[number, T[]]> {
  const groups: Array<[number, T[]]> = [];
  for (const item of items) {
    const sprint = item.sprint_number || 1;
    const last = groups[groups.length - 1];
    if (last && last[0] === sprint) {
      last[1].push(item);
    } else {
      groups.push([sprint, [item]]);
    }
  }
  return groups;
}

function renderFeatures(): void {
  if (activeFeatures.length === 0) {
    featuresSection.hidden = true;
    return;
  }
  featuresSection.hidden = false;
  const selectedCount = activeFeatures.filter((f) => f.selected).length;
  featuresCountEl.textContent = `${selectedCount} / ${activeFeatures.length} 已选`;
  generatePlanBtn.disabled = selectedCount === 0;

  // Group by sprint so each iteration is a labeled section. Single
  // sprint = no header (avoid noise on first decompose). Multi-sprint
  // = "Sprint N" header with item count.
  const groups = groupBySprint(activeFeatures);
  const showSprintHeaders = groups.length > 1;

  featuresListEl.innerHTML = groups
    .map(([sprint, items]) => {
      const sprintHeader = showSprintHeaders
        ? `<div style="font-size:12px; font-weight:600; color:var(--text-muted,#888); padding:6px 0 2px 0; border-top:1px dashed var(--border,#ececf0); margin-top:6px;">Sprint ${sprint} · ${items.length} 个功能</div>`
        : "";
      const rows = items
        .map((f) => {
          const c = COMPLEXITY_COLOR[f.complexity];
          const cl = COMPLEXITY_LABEL[f.complexity];
          return `
            <div style="display:flex; gap:10px; align-items:flex-start; padding:10px; background:${f.selected ? "#fff" : "#f7f7f9"}; border:1px solid var(--border,#ececf0); border-radius:6px;">
              <label style="display:flex; gap:10px; align-items:flex-start; flex:1; min-width:0; cursor:pointer; margin:0;">
                <input type="checkbox" ${f.selected ? "checked" : ""} data-feature-toggle="${escapeHTML(f.id)}" style="margin:3px 0 0 0; padding:0; width:auto; flex-shrink:0;" />
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <div style="font-weight:500; font-size:14px;">${escapeHTML(f.title)}</div>
                    <span style="padding:1px 6px; border-radius:3px; background:${c}; color:#fff; font-size:10px;">${escapeHTML(cl)}</span>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted,#888); margin-top:3px;">${escapeHTML(f.description)}</div>
                </div>
              </label>
              <button type="button" class="btn-inline btn-secondary" data-feature-delete="${escapeHTML(f.id)}" title="删除该功能（已生成的任务保留）" style="font-size:11px; padding:3px 8px; flex-shrink:0;">删除</button>
            </div>`;
        })
        .join("");
      return sprintHeader + rows;
    })
    .join("");

  featuresListEl.querySelectorAll<HTMLInputElement>("[data-feature-toggle]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-feature-toggle");
      if (id) void toggleFeature(id, cb.checked);
    });
  });
  featuresListEl.querySelectorAll<HTMLButtonElement>("[data-feature-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-feature-delete");
      if (id) void doDeleteFeature(id);
    });
  });
}

function renderTasks(): void {
  if (activeTasks.length === 0) {
    tasksSection.hidden = true;
    return;
  }
  tasksSection.hidden = false;
  const todoCount = activeTasks.filter((t) => t.status === "todo").length;
  tasksCountEl.textContent = `共 ${activeTasks.length} 个 · ${todoCount} 待办`;
  // Disable the dispatch-all button when there's nothing to dispatch
  // OR when no bot is selected. Re-evaluated on each render.
  dispatchAllBtn.disabled = todoCount === 0 || !dispatchAllBotSelect.value;
  // Sync the dropdown to the project's preferred provider whenever
  // the panel opens — saves a click in the common case (project
  // has code_provider=kimi, agent attached as kimi-bot).
  syncDispatchAllBotOptions();
  // Group by sprint so the user can see iteration history in
  // order. Same logic as features: single sprint = no header,
  // multi-sprint = labeled section per sprint.
  const taskGroups = groupBySprint(activeTasks);
  const showTaskSprintHeaders = taskGroups.length > 1;
  tasksListEl.innerHTML = taskGroups
    .map(([sprint, items]) => {
      const sprintHeader = showTaskSprintHeaders
        ? `<div style="font-size:12px; font-weight:600; color:var(--text-muted,#888); padding:6px 0 2px 0; border-top:1px dashed var(--border,#ececf0); margin-top:6px;">Sprint ${sprint} · ${items.length} 个任务</div>`
        : "";
      const rows = items
        .map((t) => {
          const opts = TASK_STATUS_OPTIONS.map(
            (s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${TASK_STATUS_LABEL[s]}</option>`,
          ).join("");
          const isPickerOpen = pickerOpenForTaskID === t.id;
          const finishBtn = t.status !== "done"
            ? `<button type="button" class="btn-inline btn-secondary" data-task-finish="${escapeHTML(t.id)}" title="标记为完成" style="font-size:11px; padding:3px 6px;">✓</button>`
            : "";
          const cancelBtn = t.status !== "blocked" && t.status !== "done"
            ? `<button type="button" class="btn-inline btn-secondary" data-task-cancel="${escapeHTML(t.id)}" title="标记为阻塞 / 取消" style="font-size:11px; padding:3px 6px;">✗</button>`
            : "";
          const sharpenBtn = `<button type="button" class="btn-inline btn-secondary" data-task-sharpen="${escapeHTML(t.id)}" title="用 AI 改写需求" style="font-size:11px; padding:3px 6px;">✨</button>`;
          const retrospectBtn = t.status === "done"
            ? `<button type="button" class="btn-inline btn-secondary" data-task-retrospect="${escapeHTML(t.id)}" title="AI 复盘" style="font-size:11px; padding:3px 6px;">📋</button>`
            : "";
          return `
            <div style="padding:10px; background:var(--card,#fff); border:1px solid var(--border,#ececf0); border-radius:6px; display:flex; gap:10px; align-items:flex-start;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight:500; font-size:14px;">${escapeHTML(t.title)}</div>
                <div style="font-size:12px; color:var(--text-muted,#888); margin-top:3px;">${escapeHTML(t.description)}</div>
                <div style="margin-top:6px; font-size:11px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  ${renderTaskBotSlot(t, isPickerOpen)}
                </div>
              </div>
              <div style="display:flex; gap:4px; align-items:center;">
                ${sharpenBtn}${retrospectBtn}${finishBtn}${cancelBtn}
                <select class="input" style="font-size:12px; padding:4px 6px; width:auto;" data-task-status="${escapeHTML(t.id)}">${opts}</select>
              </div>
            </div>`;
        })
        .join("");
      return sprintHeader + rows;
    })
    .join("");
  tasksListEl.querySelectorAll<HTMLSelectElement>("[data-task-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.getAttribute("data-task-status");
      if (id) void changeTaskStatus(id, sel.value as TaskStatus);
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-task-finish]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-finish");
      if (id) void changeTaskStatus(id, "done");
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-task-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-cancel");
      if (id) void changeTaskStatus(id, "blocked");
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-task-sharpen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-sharpen");
      if (id) void openTaskSharpenModal(id);
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-task-retrospect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-retrospect");
      if (id) void openTaskRetrospectModal(id);
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-task-pickup]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-task-pickup");
      if (!id) return;
      pickerOpenForTaskID = pickerOpenForTaskID === id ? null : id;
      renderTasks();
    });
  });
  tasksListEl.querySelectorAll<HTMLElement>("[data-pickup-bot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const taskID = btn.getAttribute("data-task-id");
      const botID = btn.getAttribute("data-pickup-bot");
      if (taskID && botID) void doPickup(taskID, botID);
    });
  });
}

function renderTaskBotSlot(t: ProjectTask, pickerOpen: boolean): string {
  if (t.bot_user_id) {
    const bot = availableBots.find((b) => b.bot_user_id === t.bot_user_id);
    const botName = bot?.name || t.bot_user_id;
    // chat.html accepts ?user_id=<bot> to navigate to the existing
    // user↔bot thread; the most-recent llm_thread (the one we just
    // created) is auto-selected by chat's loader.
    const link = `/chat.html?user_id=${encodeURIComponent(t.bot_user_id)}`;
    return `<span style="color:var(--text-muted,#888);">🤖 ${escapeHTML(botName)}</span>
            <a href="${link}" style="color:var(--accent,#3a7);">→ 进入会话</a>`;
  }
  if (!pickerOpen) {
    return `<button type="button" class="btn-inline btn-secondary" data-task-pickup="${escapeHTML(t.id)}" style="font-size:11px; padding:3px 8px;">🤖 派给 Bot</button>`;
  }
  // Filter bots by project type:
  //   research project → only show research bots (classic kind,
  //                      auto-registered, no preferred_tool — backed
  //                      by workspace LLM + agent tools)
  //   code project    → only show coder bots (passthrough kind)
  // If the filtered list is empty (operator hasn't started the
  // right kind of agent yet), fall back to showing everything so
  // they aren't trapped — better to allow a manual pick than block.
  const isResearch = activeProject?.runtime_env === "research";
  const filtered = filterBotsForProject(availableBots, isResearch);
  const usableBots = filtered.length > 0 ? filtered : availableBots;
  if (usableBots.length === 0) {
    return `<span style="color:var(--text-muted,#888);">没有 bot 可用，请先在 Bots 页面创建一个</span>
            <button type="button" class="btn-inline btn-secondary" data-task-pickup="${escapeHTML(t.id)}" style="font-size:11px; padding:3px 8px;">取消</button>`;
  }
  // Sort bots so the project's preferred code_provider comes first.
  // botToolMap[bot_user_id] returns the attached agent's tool
  // ("kimi"/"claude"/"codex"/""). Matching = bot's tool ===
  // project.code_provider.
  const preferred = activeProject?.code_provider || "";
  const sorted = [...usableBots].sort((a, b) => {
    const at = botToolMap[a.bot_user_id] || "";
    const bt = botToolMap[b.bot_user_id] || "";
    const aMatch = preferred && at === preferred ? 1 : 0;
    const bMatch = preferred && bt === preferred ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    // Sub-sort: any attached tool > unattached
    return (bt ? 1 : 0) - (at ? 1 : 0);
  });
  const choices = sorted
    .map((b) => {
      const tool = botToolMap[b.bot_user_id] || "";
      const matchPreferred = preferred && tool === preferred;
      const cls = matchPreferred ? "btn-inline" : "btn-inline btn-secondary";
      const tag = tool
        ? ` <span style="font-size:10px; color:${matchPreferred ? "#fff" : "var(--text-muted,#888)"};">[${escapeHTML(tool)}]</span>`
        : "";
      const style = matchPreferred
        ? "font-size:11px; padding:3px 8px; background:#3a7; color:#fff;"
        : "font-size:11px; padding:3px 8px;";
      return `<button type="button" class="${cls}" data-pickup-bot="${escapeHTML(b.bot_user_id)}" data-task-id="${escapeHTML(t.id)}" style="${style}">${escapeHTML(b.name)}${tag}</button>`;
    })
    .join("");
  const hint = isResearch
    ? `<span style="color:var(--text-muted,#888);">研究项目 — 选一个 research bot：</span>`
    : preferred
      ? `<span style="color:var(--text-muted,#888);">选一个 bot（首选 <strong>${escapeHTML(preferred)}</strong>）：</span>`
      : `<span style="color:var(--text-muted,#888);">选一个 bot：</span>`;
  const fallbackNote = filtered.length === 0
    ? `<span style="font-size:11px; color:#c80;">⚠️ 没找到匹配 ${isResearch ? "研究" : "代码"} 项目的 bot，下面列出全部</span><br/>`
    : "";
  return `${fallbackNote}${hint}${choices}
          <button type="button" class="btn-inline btn-secondary" data-task-pickup="${escapeHTML(t.id)}" style="font-size:11px; padding:3px 8px;">取消</button>`;
}

// filterBotsForProject splits availableBots by project type.
// Research bot signature: bot_kind === "classic" AND
//   (is_auto_registered OR preferred_tool === ""). This catches
//   the agent auto-registered "research" bot AND any legacy
//   classic bots an operator might still have around.
// Coder bot signature: bot_kind === "passthrough" (preferred_tool
//   set to kimi/claude/codex/...).
function filterBotsForProject(bots: BotUser[], isResearch: boolean): BotUser[] {
  return bots.filter((b) => {
    if (isResearch) {
      return b.bot_kind === "classic";
    }
    return b.bot_kind === "passthrough";
  });
}

// ---- data ops -----------------------------------------------------

async function loadProjects(): Promise<void> {
  const { response, data } = await fetchProjects();
  if (!response.ok) {
    listEl.innerHTML = `<div class="chat-empty">加载失败</div>`;
    return;
  }
  projects = data.projects;
  renderProjectList();
}

async function openProject(id: string): Promise<void> {
  activeProjectID = id;
  renderProjectList();
  const { response, data } = await fetchProject(id);
  if (!response.ok) {
    activeProject = null;
    renderProjectPanel();
    return;
  }
  activeProject = data.project;
  activeFeatures = data.features;
  activeTasks = data.tasks;
  activeResearchRuns = [];
  renderProjectPanel();
  // Research history is research-only and a separate API call —
  // load it lazily after the main panel renders.
  if (activeProject?.runtime_env === "research") {
    void loadResearchRuns();
  }
}

async function loadResearchRuns(): Promise<void> {
  if (!activeProject) return;
  const projectID = activeProject.id;
  const { response, data } = await fetchResearchRuns(projectID);
  // Guard against the user having navigated away while we were
  // fetching — only commit results for the still-open project.
  if (activeProject?.id !== projectID) return;
  if (!response.ok) {
    activeResearchRuns = [];
  } else {
    activeResearchRuns = data.runs ?? [];
  }
  renderResearchRuns();
}

// iosdist app cache for the binding selector. Populated lazily on
// first project panel render; refreshes when the user clicks the
// save button (cheap; the list is short).
let iosAppsCache: IOSApp[] = [];

async function loadIOSAppsForBinding(): Promise<void> {
  const { response, data } = await fetchIOSApps();
  if (!response.ok) {
    iosAppsCache = [];
  } else {
    iosAppsCache = data.apps ?? [];
  }
  // Re-render selector if a project is open.
  if (activeProject) syncIOSDistAppSelect();
}

function syncIOSDistAppSelect(): void {
  if (!activeProject) return;
  const current = activeProject.iosdist_app_id ?? null;
  const opts: string[] = [`<option value="">不绑定（项目不是 iOS）</option>`];
  for (const a of iosAppsCache) {
    const sel = current === a.id ? "selected" : "";
    const ascTag = a.asc_app_id ? "（已绑 ASC）" : "（未绑 ASC）";
    opts.push(
      `<option value="${a.id}" ${sel}>${escapeHTML(a.name)} · ${escapeHTML(a.bundle_id)} ${ascTag}</option>`,
    );
  }
  iosDistAppSelect.innerHTML = opts.join("");
  if (current && current > 0) {
    const a = iosAppsCache.find((x) => x.id === current);
    if (a) {
      iosDistAppMetaEl.textContent = `bundle_id=${a.bundle_id}${a.asc_app_id ? `, asc_app_id=${a.asc_app_id}` : " (未绑 ASC)"}`;
    } else {
      iosDistAppMetaEl.textContent = `(id=${current}, 已被删除？刷新重选)`;
    }
  } else {
    iosDistAppMetaEl.textContent = "";
  }
}

async function saveIOSDistAppBinding(): Promise<void> {
  if (!activeProject) return;
  const v = iosDistAppSelect.value.trim();
  // Empty string in the dropdown = unbind. Send null so server
  // distinguishes "no change" (field absent) from "unbind" (null).
  const payload: { iosdist_app_id: number | null } = {
    iosdist_app_id: v === "" ? null : Number(v),
  };
  saveIOSDistAppBtn.disabled = true;
  setStatus(decomposeStatusEl, "保存中...", false);
  const { response, data } = await updateProject(activeProject.id, payload);
  saveIOSDistAppBtn.disabled = false;
  if (!response.ok) {
    setStatus(decomposeStatusEl, "保存失败", true);
    return;
  }
  activeProject = data.project;
  syncIOSDistAppSelect();
  setStatus(decomposeStatusEl, "已保存", false);
}

async function saveGitRemoteUrl(): Promise<void> {
  if (!activeProject) return;
  const url = gitRemoteUrlEl.value.trim();
  if (url === (activeProject.git_remote_url || "")) {
    setStatus(decomposeStatusEl, "未修改", false);
    return;
  }
  saveGitRemoteBtn.disabled = true;
  setStatus(decomposeStatusEl, "保存中...", false);
  const { response, data } = await updateProject(activeProject.id, { git_remote_url: url });
  saveGitRemoteBtn.disabled = false;
  if (!response.ok) {
    setStatus(decomposeStatusEl, "保存失败", true);
    return;
  }
  activeProject = data.project;
  setStatus(decomposeStatusEl, url ? "已保存（任务结束会 push）" : "已清空（不再 push）", false);
}

async function saveDescription(): Promise<void> {
  if (!activeProject) return;
  const desc = descEl.value.trim();
  if (desc === activeProject.description) {
    setStatus(decomposeStatusEl, "未修改", false);
    return;
  }
  saveDescBtn.disabled = true;
  setStatus(decomposeStatusEl, "保存中...", false);
  const { response, data } = await updateProject(activeProject.id, { description: desc });
  saveDescBtn.disabled = false;
  if (!response.ok) {
    setStatus(decomposeStatusEl, "保存失败", true);
    return;
  }
  activeProject = data.project;
  setStatus(decomposeStatusEl, "已保存", false);
  // Refresh the list so updated_at sorting reflects.
  void loadProjects();
}

async function decompose(): Promise<void> {
  if (!activeProject) return;
  if (!activeProject.description.trim() && !descEl.value.trim()) {
    setStatus(decomposeStatusEl, "请先填写产品描述", true);
    return;
  }
  // Auto-save the description before decomposing so the AI sees the
  // latest text.
  if (descEl.value.trim() !== activeProject.description) {
    await saveDescription();
  }
  decomposeBtn.disabled = true;
  setStatus(decomposeStatusEl, "AI 正在拆解功能（最多 90 秒）...", false);
  const llmIDRaw = decomposeLLMSelect.value;
  const llmID = llmIDRaw ? Number(llmIDRaw) : undefined;
  const botID = decomposeBotSelect.value || undefined;
  const { response, data } = await decomposeProject(activeProject.id, llmID, botID);
  decomposeBtn.disabled = false;
  if (!response.ok) {
    setStatus(decomposeStatusEl, data.error || "拆解失败", true);
    return;
  }
  // Reload from server so we get the merged features list (old
  // sprints + the just-appended new sprint), not just the new
  // batch from the response.
  await openProject(activeProject.id);
  // Surface which LLM produced this run + the new sprint number
  // so A/B comparison + iteration history are obvious.
  const llmTag = data.llm_used
    ? `（${escapeHTML(data.llm_used.name)} · ${escapeHTML(data.llm_used.model)}）`
    : "";
  const newCount = data.features.length;
  const sprintTag = data.new_sprint ? ` → Sprint ${data.new_sprint}` : "";
  setStatus(decomposeStatusEl, `拆出 ${newCount} 个新功能${sprintTag} ${llmTag}`, false);
}

async function toggleFeature(featureID: string, selected: boolean): Promise<void> {
  if (!activeProject) return;
  const f = activeFeatures.find((x) => x.id === featureID);
  if (!f) return;
  f.selected = selected;
  renderFeatures();
  await updateProjectFeature(activeProject.id, featureID, {
    title: f.title,
    description: f.description,
    complexity: f.complexity,
    selected,
  });
}

async function doDeleteFeature(featureID: string): Promise<void> {
  if (!activeProject) return;
  const f = activeFeatures.find((x) => x.id === featureID);
  if (!f) return;
  // Tasks already generated from this feature survive — feature_id
  // gets nulled (ON DELETE SET NULL on project_tasks.feature_id).
  // The confirm copy reflects this so users don't second-guess
  // hitting delete on a feature they've already started executing.
  if (!window.confirm(`删除功能「${f.title}」？\n（已生成的任务会保留，仅切断功能引用。）`)) return;
  const { response, data } = await deleteProjectFeature(activeProject.id, featureID);
  if (!response.ok) {
    window.alert(("error" in data && (data as { error?: string }).error) || "删除失败");
    return;
  }
  activeFeatures = activeFeatures.filter((x) => x.id !== featureID);
  // Tasks may still reference this feature in memory — refresh them
  // from the server so feature_id pointers settle to null and any
  // future re-decompose works against the current state.
  const proj = await fetchProject(activeProject.id);
  if (proj.response.ok) {
    activeTasks = proj.data.tasks;
  }
  renderFeatures();
  renderTasks();
}

async function generatePlan(): Promise<void> {
  if (!activeProject) return;
  generatePlanBtn.disabled = true;
  setStatus(planStatusEl, "生成中...", false);
  const { response, data } = await generateProjectPlan(activeProject.id);
  generatePlanBtn.disabled = false;
  if (!response.ok) {
    setStatus(planStatusEl, "生成失败", true);
    return;
  }
  setStatus(planStatusEl, `创建 ${data.created_count} 个新任务（已存在的功能不重复创建）`, false);
  void openProject(activeProject.id);
}

async function changeTaskStatus(taskID: string, status: TaskStatus): Promise<void> {
  if (!activeProject) return;
  const t = activeTasks.find((x) => x.id === taskID);
  if (!t) return;
  t.status = status;
  await updateProjectTask(activeProject.id, taskID, { status });
}

// ── system_agent capability B: task sharpen modal ─────────────────
//
// ✨ button on each task row → modal. Calls
// POST /api/projects/:id/tasks/:taskID/sharpen which returns 1-2
// candidate {title, description, rationale} drafts. Adopting writes
// the chosen draft back via PUT /tasks/:id with audit_source set,
// which makes the server snapshot the pre-update version into
// project_task_revisions for history.

let activeTaskSharpenID: string | null = null;
let lastTaskSharpenLLM: { name: string; model: string } | null = null;

function setTaskSharpenOpen(open: boolean): void {
  const modal = document.getElementById("taskSharpenModal");
  if (!modal) return;
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

async function openTaskSharpenModal(taskID: string): Promise<void> {
  if (!activeProject) return;
  const t = activeTasks.find((x) => x.id === taskID);
  if (!t) return;
  activeTaskSharpenID = taskID;
  lastTaskSharpenLLM = null;
  const original = document.getElementById("taskSharpenOriginal");
  if (original) {
    original.textContent = `${t.title}\n\n${t.description || "（描述为空）"}`;
  }
  const instr = document.getElementById("taskSharpenInstruction") as HTMLTextAreaElement | null;
  if (instr) instr.value = "";
  const results = document.getElementById("taskSharpenResults");
  if (results) results.innerHTML = "";
  const notes = document.getElementById("taskSharpenNotes");
  if (notes) notes.textContent = "";
  const status = document.getElementById("taskSharpenStatus");
  if (status) status.textContent = "";
  setTaskSharpenOpen(true);
}

document.getElementById("taskSharpenCloseBtn")?.addEventListener("click", () => setTaskSharpenOpen(false));
document
  .querySelector("#taskSharpenModal .modal-backdrop")
  ?.addEventListener("click", () => setTaskSharpenOpen(false));

document.getElementById("taskSharpenRunBtn")?.addEventListener("click", async () => {
  if (!activeProject || !activeTaskSharpenID) return;
  const runBtn = document.getElementById("taskSharpenRunBtn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("taskSharpenStatus");
  const resultsEl = document.getElementById("taskSharpenResults");
  const notesEl = document.getElementById("taskSharpenNotes");
  if (runBtn) runBtn.disabled = true;
  if (statusEl) statusEl.textContent = "生成中...";
  if (resultsEl) resultsEl.innerHTML = "";
  if (notesEl) notesEl.textContent = "";
  try {
    const instrEl = document.getElementById("taskSharpenInstruction") as HTMLTextAreaElement | null;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(activeTaskSharpenID)}/sharpen`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instruction: instrEl?.value ?? "" }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      if (statusEl) statusEl.textContent = data?.error || "生成失败";
      return;
    }
    lastTaskSharpenLLM = data.llm || null;
    if (statusEl && data.llm) {
      statusEl.textContent = `由 ${data.llm.name}${data.llm.model ? ` · ${data.llm.model}` : ""} 生成`;
    } else if (statusEl) {
      statusEl.textContent = "";
    }
    type Draft = { title: string; description: string; rationale: string };
    const drafts: Draft[] = data.drafts || [];
    if (resultsEl) {
      resultsEl.innerHTML = drafts
        .map(
          (d, i) => `
            <div class="bio-refine-draft">
              <div class="bio-refine-draft-head">
                <span class="bio-refine-draft-label">候选 ${i + 1}</span>
                <button type="button" class="btn-inline btn-secondary" data-adopt-task="${i}">采用</button>
              </div>
              <div class="bio-refine-draft-text"><strong>${escapeHTML(d.title || "(no title)")}</strong>\n\n${escapeHTML(d.description)}</div>
              ${d.rationale ? `<div class="bio-refine-draft-rationale">调整：${escapeHTML(d.rationale)}</div>` : ""}
            </div>
          `,
        )
        .join("");
      resultsEl.querySelectorAll<HTMLButtonElement>("[data-adopt-task]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.adoptTask);
          if (Number.isNaN(idx) || !drafts[idx]) return;
          void adoptTaskDraft(drafts[idx]);
        });
      });
    }
    if (notesEl && data.notes) {
      notesEl.textContent = data.notes;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `生成失败：${(e as Error).message}`;
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
});

async function adoptTaskDraft(draft: { title: string; description: string }): Promise<void> {
  if (!activeProject || !activeTaskSharpenID) return;
  const { response, data } = await updateProjectTask(activeProject.id, activeTaskSharpenID, {
    title: draft.title,
    description: draft.description,
    audit_source: "system_agent_sharpen",
    audit_llm_name: lastTaskSharpenLLM?.name ?? "",
    audit_llm_model: lastTaskSharpenLLM?.model ?? "",
  });
  if (!response.ok) {
    window.alert(("error" in data && (data as { error?: string }).error) || "更新失败");
    return;
  }
  // Update in-memory task so the row re-renders without a refetch.
  const idx = activeTasks.findIndex((x) => x.id === activeTaskSharpenID);
  if (idx >= 0) {
    activeTasks[idx] = { ...activeTasks[idx], title: draft.title, description: draft.description };
    renderTasks();
  }
  setTaskSharpenOpen(false);
}

// syncDispatchAllBotOptions populates the "派全部" bot dropdown
// with ONLY currently-attached bots. botToolMap[id] is non-empty
// when fetchAgentBotStatus reported attached=true; everything
// else is filtered out. Picking a detached bot would 503 from
// the pickup handler's agent precheck, which is not the failure
// mode the user can act on through this UI.
function syncDispatchAllBotOptions(): void {
  const isResearch = activeProject?.runtime_env === "research";
  // Research project: classic bots are usable even without an
  // attached agent (dock makes the LLM call; agent only needed
  // when the LLM tool_calls). Coder project: must be attached
  // (passthrough mode requires the local CLI to take over).
  const filteredByKind = filterBotsForProject(availableBots, isResearch);
  const usable = filteredByKind.length > 0 ? filteredByKind : availableBots;
  const attached = isResearch
    ? usable
    : usable.filter((b) => (botToolMap[b.bot_user_id] || "") !== "");
  if (attached.length === 0) {
    const msg = isResearch
      ? `没有 research bot（先在 docker 启动 polar-agent --research）`
      : `没有 attached bot（请先 polar-agent attach）`;
    dispatchAllBotSelect.innerHTML = `<option value="">${msg}</option>`;
    return;
  }
  const preferred = activeProject?.code_provider || "";
  const sorted = [...attached].sort((a, b) => {
    const at = botToolMap[a.bot_user_id] || "";
    const bt = botToolMap[b.bot_user_id] || "";
    const aMatch = preferred && at === preferred ? 1 : 0;
    const bMatch = preferred && bt === preferred ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return a.name.localeCompare(b.name);
  });
  const previous = dispatchAllBotSelect.value;
  const opts = ['<option value="">选 bot…</option>'];
  for (const b of sorted) {
    const tool = botToolMap[b.bot_user_id] || "";
    opts.push(`<option value="${escapeHTML(b.bot_user_id)}">${escapeHTML(b.name)} [${escapeHTML(tool)}]</option>`);
  }
  dispatchAllBotSelect.innerHTML = opts.join("");
  if (previous && sorted.some((b) => b.bot_user_id === previous)) {
    dispatchAllBotSelect.value = previous;
  } else if (preferred) {
    const match = sorted.find((b) => (botToolMap[b.bot_user_id] || "") === preferred);
    if (match) {
      dispatchAllBotSelect.value = match.bot_user_id;
    }
  }
}

// dispatchAllTodos sequentially picks up every todo task to the
// selected bot. Sequential (not parallel) on purpose: tasks in
// one project share the workdir under $workdir/<project_id>, so
// a fan-out would have N kimi-cli processes fighting over the
// same --continue session. The bot replies async; we don't wait
// for chat to finish, just wait for the pickup HTTP call to
// return so each new chat thread is ordered.
async function dispatchAllTodos(): Promise<void> {
  if (!activeProject) return;
  const botID = dispatchAllBotSelect.value;
  if (!botID) {
    setStatus(dispatchAllStatusEl, "请先选 bot", true);
    return;
  }
  const todos = activeTasks.filter((t) => t.status === "todo");
  if (todos.length === 0) {
    setStatus(dispatchAllStatusEl, "没有 todo 任务", true);
    return;
  }
  if (!window.confirm(`将 ${todos.length} 个 todo 任务全部派给该 bot？\n（顺序派单，每条任务等上一条 pickup 返回再发下一条）`)) {
    return;
  }
  dispatchAllBtn.disabled = true;
  let done = 0;
  let failed = 0;
  let lastError = "";
  // Research projects use a separate dispatch endpoint that runs the
  // LLM loop on the agent. Mirror the loop shape; the per-call confirm
  // (LLM transparency) is already handled by the bulk-confirm above
  // since one bot = one resolved LLM for the whole batch.
  const isResearchBulk = activeProject.runtime_env === "research";
  for (const t of todos) {
    setStatus(dispatchAllStatusEl, `派单中 ${done + 1}/${todos.length} · ${escapeHTML(t.title)}`, false);
    try {
      let ok: boolean;
      let status: number;
      let errMsg: string | undefined;
      let updatedTask: ProjectTask | null = null;
      if (isResearchBulk) {
        const { response, data } = await dispatchResearchTask(activeProject.id, t.id, botID);
        ok = response.ok;
        status = response.status;
        if (!ok) errMsg = (data as { error?: string }).error;
      } else {
        const { response, data } = await pickupProjectTask(activeProject.id, t.id, botID);
        ok = response.ok;
        status = response.status;
        if (!ok) errMsg = (data as { error?: string }).error;
        if (ok) updatedTask = data.task;
      }
      if (ok) {
        if (updatedTask) {
          const idx = activeTasks.findIndex((x) => x.id === t.id);
          if (idx >= 0) {
            activeTasks[idx] = updatedTask;
          }
        }
        done++;
      } else {
        failed++;
        if (errMsg) lastError = errMsg;
        // Stop on first failure — when the precheck (e.g. agent
        // not attached, 503) fails for one task, every following
        // task will fail the same way. No point hammering.
        if (status === 503) {
          break;
        }
      }
    } catch (e) {
      failed++;
      lastError = String(e);
    }
    renderTasks();
  }
  if (isResearchBulk && done > 0) {
    // Refresh the activeTasks from server (research dispatch doesn't
    // return the updated task in body, unlike pickup) + reload the
    // research history panel so the new queued runs show up.
    void (async () => {
      const proj = await fetchProject(activeProject!.id);
      if (proj.response.ok) {
        activeTasks = proj.data.tasks;
        renderTasks();
      }
      void loadResearchRuns();
    })();
  }
  setStatus(
    dispatchAllStatusEl,
    failed === 0
      ? `✅ 全部 ${done} 条派单完成`
      : `${done} 条成功 / ${failed} 条失败${lastError ? "：" + lastError : ""}`,
    failed > 0,
  );
}

// finishAll / cancelAll wrap the bulk-status endpoint with a
// confirm prompt + status text. Sourced from one helper to keep
// behavior consistent — the only difference is the target status
// and the from_statuses filter.
async function bulkSetTaskStatus(
  target: "done" | "blocked",
  fromStatuses: string[],
  confirmMsg: string,
  successPrefix: string,
): Promise<void> {
  if (!activeProject) return;
  const matched = activeTasks.filter((t) => fromStatuses.includes(t.status));
  if (matched.length === 0) {
    setStatus(dispatchAllStatusEl, "没有符合条件的任务", true);
    return;
  }
  if (!window.confirm(confirmMsg.replace("{n}", String(matched.length)))) {
    return;
  }
  finishAllBtn.disabled = true;
  cancelAllBtn.disabled = true;
  try {
    const { response, data } = await bulkUpdateProjectTaskStatus(
      activeProject.id,
      target,
      fromStatuses,
    );
    if (!response.ok) {
      setStatus(dispatchAllStatusEl, ((data as { error?: string }).error || "失败"), true);
      return;
    }
    setStatus(dispatchAllStatusEl, `${successPrefix} ${data.updated} 个任务`, false);
    // Re-fetch to surface server-side timestamp updates (started_at
    // / completed_at) which we don't recompute client-side.
    await openProject(activeProject.id);
  } finally {
    finishAllBtn.disabled = false;
    cancelAllBtn.disabled = false;
  }
}

async function finishAllTasks(): Promise<void> {
  await bulkSetTaskStatus(
    "done",
    ["todo", "in_progress", "review", "blocked"],
    "把全部 {n} 个未完成任务标记为「完成」？",
    "✓ 已完成",
  );
}

async function cancelAllTasks(): Promise<void> {
  await bulkSetTaskStatus(
    "blocked",
    ["todo", "in_progress", "review"],
    "把全部 {n} 个未完成任务标记为「阻塞 / 取消」？",
    "✗ 已取消",
  );
}

async function loadBots(): Promise<void> {
  const { response, data } = await fetchBotUsers();
  if (response.ok) {
    availableBots = data.bots || [];
  }
  // Fan out per-bot status fetches in parallel so the picker can
  // render with tool annotations + preferred-provider sort. Errors
  // are silently dropped — picker degrades to the un-sorted list
  // which is fine.
  await Promise.all(
    availableBots.map(async (b) => {
      try {
        const { response: r, data: d } = await fetchAgentBotStatus(b.bot_user_id);
        if (r.ok && d.attached) {
          botToolMap[b.bot_user_id] = (d.tool || "").trim();
        }
      } catch {
        // ignore
      }
    }),
  );
}

// loadDecomposeLLMs populates the LLM picker next to AI 拆解.
// First option is "auto"; the rest are workspace-available configs
// that have an API key. Disabled configs (no key) are surfaced
// with a "(no key)" suffix but disabled — visible to the user
// without misleading them into picking an unusable one.
// truncateLabel caps <option> text length. A <select> can't be squeezed
// below its longest option by flex, so one verbose config name used to
// force the whole 行 past the viewport on laptop widths.
function truncateLabel(s: string, max = 28): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function loadDecomposeLLMs(): Promise<void> {
  const { response, data } = await fetchAvailableLLMConfigs();
  if (!response.ok) {
    return;
  }
  const configs = data.configs || [];
  availableLLMConfigs = configs;
  const opts = ['<option value="">拆解用 LLM（自动选）</option>'];
  for (const cfg of configs) {
    const label = `${escapeHTML(truncateLabel(`${cfg.name} · ${cfg.model}`))}${cfg.has_api_key ? "" : "（缺 API Key）"}`;
    const disabled = cfg.has_api_key ? "" : " disabled";
    opts.push(`<option value="${cfg.id}"${disabled} title="${escapeHTML(`${cfg.name} · ${cfg.model}`)}">${label}</option>`);
  }
  decomposeLLMSelect.innerHTML = opts.join("");
}

// loadDecomposeBots fills the bot dropdown next to "AI 拆解".
// Only **classic** bots — passthrough bots have no LLM config so
// they can't drive a chat completion call. Each option label is
// the bot name; the bot's bound LLM config is what actually runs.
function loadDecomposeBots(): void {
  const classicBots = availableBots.filter((b) => b.bot_kind === "classic");
  if (classicBots.length === 0) {
    decomposeBotSelect.innerHTML = `<option value="">Bot 角色（无可用 classic bot）</option>`;
    return;
  }
  const previous = decomposeBotSelect.value;
  const opts = ['<option value="">Bot 角色（不用 bot persona）</option>'];
  for (const b of classicBots) {
    opts.push(`<option value="${escapeHTML(b.bot_user_id)}" title="${escapeHTML(`${b.name}（${b.config_name}）`)}">${escapeHTML(truncateLabel(`${b.name}（${b.config_name}）`))}</option>`);
  }
  decomposeBotSelect.innerHTML = opts.join("");
  if (previous && classicBots.some((b) => b.bot_user_id === previous)) {
    decomposeBotSelect.value = previous;
  }
}

async function doPickup(taskID: string, botUserID: string): Promise<void> {
  if (!activeProject) return;
  pickerOpenForTaskID = null;

  // Research projects use a different dispatch endpoint that runs a
  // local LLM loop on the agent. The confirm dialog is also distinct
  // — operators see WHICH LLM is about to do the work (transparency
  // requirement).
  if (activeProject.runtime_env === "research") {
    await doResearchDispatch(taskID, botUserID);
    return;
  }

  const { response, data } = await pickupProjectTask(activeProject.id, taskID, botUserID);
  if (!response.ok) {
    window.alert(("error" in data && (data as { error?: string }).error) || "派单失败");
    renderTasks();
    return;
  }
  // Replace the task in-place rather than refetching the whole
  // project — the response carries the updated task and we already
  // know it's transitioned to in_progress.
  const idx = activeTasks.findIndex((x) => x.id === taskID);
  if (idx >= 0) {
    activeTasks[idx] = data.task;
  }
  renderTasks();
}

async function doResearchDispatch(taskID: string, botUserID: string): Promise<void> {
  if (!activeProject) return;
  const task = activeTasks.find((t) => t.id === taskID);
  if (!task) return;
  // Best-effort preview of which LLM the dispatch will use. Mirror
  // the server-side priority: project default > bot's bound LLM >
  // workspace default. Falls back to a generic note when none is
  // discoverable from the loaded project + bots state.
  const bot = availableBots.find((b) => b.bot_user_id === botUserID);
  let llmPreview: string;
  const projectLLMID = activeProject.default_llm_config_id ?? null;
  const projectLLM = projectLLMID
    ? availableLLMConfigs.find((c) => c.id === projectLLMID)
    : null;
  if (projectLLM) {
    llmPreview = `${projectLLM.name} · ${projectLLM.model}（项目默认）`;
  } else if (bot && bot.llm_config_id > 0 && bot.config_name) {
    llmPreview = bot.config_name;
  } else {
    llmPreview = "工作区默认 LLM（后端解析）";
  }
  const confirmMsg = [
    `派发研究任务到 ${bot?.name ?? botUserID}？`,
    "",
    `任务: ${task.title}`,
    `预计 LLM: ${llmPreview}`,
    "",
    "agent 会本地驱动 LLM 写文件并 git push。任务启动时聊天里会回写实际使用的 LLM 名 + 模型。",
  ].join("\n");
  if (!window.confirm(confirmMsg)) return;

  pickerOpenForTaskID = null;
  const { response, data } = await dispatchResearchTask(activeProject.id, taskID, botUserID);
  if (!response.ok) {
    window.alert(("error" in data && (data as { error?: string }).error) || "派研究任务失败");
    renderTasks();
    return;
  }
  const llm = data.llm;
  // Toast-style confirmation showing the actual LLM the server resolved.
  // Plain alert keeps it dependency-free; if/when we add a proper toast
  // util this should swap to that.
  window.alert(`已派发 · LLM: ${llm.name} (${llm.model})\n等待 agent 在聊天中回写「研究任务启动」。`);
  // Refresh research history so the queued/running row appears.
  void loadResearchRuns();
  // Refresh tasks so the picked-up status flips immediately.
  const proj = await fetchProject(activeProject.id);
  if (proj.response.ok) {
    activeTasks = proj.data.tasks;
    renderTasks();
  }
}

function renderResearchRuns(): void {
  if (!activeProject || activeProject.runtime_env !== "research") {
    researchSectionEl.hidden = true;
    return;
  }
  researchSectionEl.hidden = false;
  researchCountEl.textContent = `共 ${activeResearchRuns.length} 条`;
  if (activeResearchRuns.length === 0) {
    researchListEl.innerHTML = `<div style="color:var(--text-muted,#888); font-size:12px; padding:8px 0;">还没有研究记录。在任务列表里点「派单」给一个 classic bot 就会创建一条。</div>`;
    return;
  }
  researchListEl.innerHTML = activeResearchRuns.map((r) => researchRunRowHTML(r)).join("");
}

function researchRunRowHTML(r: ResearchRun): string {
  const statusBadge = researchStatusBadge(r.status);
  const llm = `${escapeHTML(r.llm_name || "?")}${r.llm_model ? ` (${escapeHTML(r.llm_model)})` : ""}`;
  const created = formatTime(r.created_at);
  const sha = r.commit_sha ? `<code style="font-size:11px;">${escapeHTML(r.commit_sha.slice(0, 8))}</code>` : "—";
  const filesCount = r.files_written?.length ?? 0;
  const summary = r.summary ? escapeHTML(r.summary).replace(/\n/g, "<br>") : "";
  const errBlock = r.error_message
    ? `<div style="color:#c1383a; font-size:12px; padding-top:4px;">⚠️ ${escapeHTML(r.error_message)}</div>`
    : "";
  return [
    `<div style="border:1px solid var(--border,#ececf0); border-radius:6px; padding:8px 10px; background:var(--surface,#fff); display:flex; flex-direction:column; gap:6px;">`,
    `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px;">`,
    statusBadge,
    `<span style="color:var(--text-muted,#888);">${created}</span>`,
    `<span title="LLM 快照">🤖 ${llm}</span>`,
    `<span title="commit sha">📌 ${sha}</span>`,
    `<span title="文件改动数">📁 ${filesCount}</span>`,
    `<span title="LLM 调用轮数">🔄 ${r.iterations}</span>`,
    `<span style="flex:1;"></span>`,
    `<span style="color:var(--text-muted,#888);">run #${r.id}</span>`,
    `</div>`,
    summary ? `<div style="font-size:13px; color:var(--text,#333); line-height:1.5;">${summary}</div>` : "",
    errBlock,
    `</div>`,
  ].join("");
}

function researchStatusBadge(status: ResearchRun["status"]): string {
  const palette: Record<ResearchRun["status"], { label: string; color: string; bg: string }> = {
    queued:    { label: "排队中",   color: "#7a5a00", bg: "#fff7d6" },
    running:   { label: "进行中",   color: "#0c4f9c", bg: "#dde9fb" },
    succeeded: { label: "✅ 成功", color: "#1f6f3a", bg: "#dff5e6" },
    failed:    { label: "❌ 失败", color: "#a32424", bg: "#fde0e0" },
  };
  const p = palette[status] ?? { label: status, color: "#555", bg: "#eee" };
  return `<span style="background:${p.bg}; color:${p.color}; padding:2px 6px; border-radius:4px; font-weight:600;">${p.label}</span>`;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function doDeleteProject(): Promise<void> {
  if (!activeProject) return;
  if (!window.confirm(`确认删除项目「${activeProject.name}」？该操作不可恢复，所有功能 / 任务一同清除。`)) return;
  const { response } = await deleteProject(activeProject.id);
  if (!response.ok) {
    window.alert("删除失败");
    return;
  }
  activeProjectID = null;
  activeProject = null;
  activeFeatures = [];
  activeTasks = [];
  await loadProjects();
  if (projects.length > 0) void openProject(projects[0].id);
  else renderProjectPanel();
}

function openCreateModal(): void {
  createName.value = "";
  createDesc.value = "";
  createRuntimeEnv.value = "";
  createBusinessScenario.value = "";
  createCodeProvider.value = "";
  createGitRemoteUrl.value = "";
  clearStatus(createStatusEl);
  setModalOpen(createModal, true);
  setTimeout(() => createName.focus(), 0);
}

function closeCreateModal(): void {
  setModalOpen(createModal, false);
}

async function submitCreate(e: Event): Promise<void> {
  e.preventDefault();
  const name = createName.value.trim();
  if (!name) {
    setStatus(createStatusEl, "请填写项目名称", true);
    return;
  }
  setStatus(createStatusEl, "创建中...", false);
  const { response, data } = await createProject({
    name,
    description: createDesc.value.trim(),
    runtime_env: createRuntimeEnv.value,
    business_scenario: createBusinessScenario.value,
    code_provider: createCodeProvider.value,
    git_remote_url: createGitRemoteUrl.value.trim(),
  });
  if (!response.ok) {
    setStatus(createStatusEl, "创建失败", true);
    return;
  }
  closeCreateModal();
  await loadProjects();
  void openProject(data.project.id);
}

// ---- wiring -------------------------------------------------------

newBtn.addEventListener("click", openCreateModal);
agentTokensBtn.addEventListener("click", () => void openAgentTokensModal());
agentTokensModalCloseBtn.addEventListener("click", () => setModalOpen(agentTokensModal, false));
agentTokensModal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains("modal-backdrop")) setModalOpen(agentTokensModal, false);
});
agentTokenCreateBtn.addEventListener("click", () => void doCreateAgentToken());
agentTokenCopyBtn.addEventListener("click", () => {
  const raw = agentTokenJustCreatedRawEl.textContent || "";
  if (raw) {
    void navigator.clipboard.writeText(raw).then(() => {
      const orig = agentTokenCopyBtn.textContent;
      agentTokenCopyBtn.textContent = "已复制";
      setTimeout(() => {
        agentTokenCopyBtn.textContent = orig;
      }, 1200);
    });
  }
});
agentTokenScriptCopyBtn.addEventListener("click", () => {
  const script = agentTokenInstallScriptEl.value;
  if (!script) return;
  void navigator.clipboard.writeText(script).then(() => {
    const orig = agentTokenScriptCopyBtn.textContent;
    agentTokenScriptCopyBtn.textContent = "已复制";
    setTimeout(() => {
      agentTokenScriptCopyBtn.textContent = orig;
    }, 1200);
  });
});
agentTokenScriptDownloadBtn.addEventListener("click", () => {
  const script = agentTokenInstallScriptEl.value;
  if (!script) return;
  const blob = new Blob([script], { type: "text/x-shellscript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "install-polar-agent.sh";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

async function openAgentTokensModal(): Promise<void> {
  agentTokenJustCreatedEl.hidden = true;
  agentTokenNameInput.value = "";
  agentTokenInstallScriptEl.value = "";
  renderCoderRows();
  setModalOpen(agentTokensModal, true);
  await loadAgentTokens();
}

async function loadAgentTokens(): Promise<void> {
  agentTokensListEl.innerHTML = `<div class="chat-empty">加载中...</div>`;
  const { response, data } = await fetchAgentTokens();
  if (!response.ok) {
    agentTokensListEl.innerHTML = `<div class="chat-empty">加载失败</div>`;
    return;
  }
  renderAgentTokens(data.tokens);
}

function renderAgentTokens(tokens: AgentToken[]): void {
  if (tokens.length === 0) {
    agentTokensListEl.innerHTML = `<div class="chat-empty">还没有 agent，上面输个名字 + 选 coder 然后「＋ 新建 agent」</div>`;
    return;
  }
  agentTokensListEl.innerHTML = tokens
    .map((t) => {
      const created = new Date(t.created_at).toLocaleString();
      const lastSeen = t.last_attached_at
        ? new Date(t.last_attached_at).toLocaleString()
        : t.last_used_at
        ? new Date(t.last_used_at).toLocaleString()
        : "—";
      const revoked = t.revoked_at ? `<span style="color:#c33; font-size:11px;">已撤销</span>` : "";
      // Host info pill: "darwin/arm64 · macbook · 192.168.1.5"
      const hostBits: string[] = [];
      if (t.host_os && t.host_arch) hostBits.push(`${t.host_os}/${t.host_arch}`);
      else if (t.host_os) hostBits.push(t.host_os);
      if (t.host_name) hostBits.push(t.host_name);
      if (t.host_ip) hostBits.push(t.host_ip);
      const hostPill = hostBits.length
        ? `<span class="tag-chip" style="font-size:10px;">${escapeHTML(hostBits.join(" · "))}</span>`
        : `<span style="font-size:10px; color:var(--text-muted,#888);">未上线过</span>`;
      // Coder summary: list enabled coders + auth mode
      const coderBits: string[] = [];
      const cc = t.coder_config || {};
      for (const k of ["kimi", "claude", "codex"] as CoderName[]) {
        const e = cc[k];
        if (e && e.enabled) coderBits.push(`${k}:${e.auth_mode}`);
      }
      const coderPill = coderBits.length
        ? `<span class="tag-chip tag-chip-accent" style="font-size:10px;">${escapeHTML(coderBits.join(" + "))}</span>`
        : "";
      return `
        <div style="padding:8px 10px; background:${t.revoked_at ? "var(--surface,#f7f7f9)" : "var(--card,#fff)"}; border:1px solid var(--border,#ececf0); border-radius:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <div style="flex:1; min-width:200px;">
            <div style="font-weight:500; font-size:13px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              ${escapeHTML(t.name || "(no name)")} ${revoked} ${hostPill} ${coderPill}
            </div>
            <div class="text-meta-mono" style="font-size:11px; color:var(--text-muted,#888);">创建 ${escapeHTML(created)} · 最后上线 ${escapeHTML(lastSeen)}</div>
          </div>
          ${
            t.revoked_at
              ? ""
              : `<button type="button" class="btn-inline" data-revoke-token="${escapeHTML(t.id)}" style="color:#c33; font-size:12px;">撤销</button>`
          }
        </div>`;
    })
    .join("");
  agentTokensListEl.querySelectorAll<HTMLButtonElement>("[data-revoke-token]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-revoke-token");
      if (id) void doRevokeAgentToken(id);
    });
  });
}

// Coder wizard rows. Each row = enable checkbox + auth_mode radio.
// Default state: kimi enabled with api_key auth (lowest-friction
// happy-path). Operator can toggle.
type CoderUIRow = { name: CoderName; label: string; install: string };
const CODER_ROWS: CoderUIRow[] = [
  { name: "kimi", label: "kimi-cli", install: "uv tool install kimi-cli" },
  { name: "claude", label: "claude-code", install: "npm i -g @anthropic-ai/claude-code" },
  { name: "codex", label: "codex", install: "npm i -g @openai/codex" },
];

// API key env var names per coder — what the install script will
// write into ~/.polar/tools.json's per-tool env block.
const CODER_API_ENV: { [k in CoderName]: string } = {
  kimi: "KIMI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
};

function renderCoderRows(): void {
  agentTokenCoderRowsEl.innerHTML = CODER_ROWS.map((r) => {
    const checked = r.name === "kimi" ? "checked" : "";
    return `
      <div data-coder-row="${r.name}" style="display:flex; flex-direction:column; gap:6px; padding:6px; background:var(--surface,#fafafa); border-radius:4px;">
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <label style="display:flex; gap:6px; align-items:center; cursor:pointer; min-width:130px;">
            <input type="checkbox" data-coder-toggle="${r.name}" ${checked} style="margin:0; padding:0; width:auto; flex-shrink:0;" />
            <span style="font-size:13px; font-weight:500;">${r.label}</span>
          </label>
          <code style="font-size:10px; color:var(--text-muted,#888); flex:1; min-width:140px; overflow:hidden; text-overflow:ellipsis;">${r.install}</code>
          <label style="display:flex; gap:4px; align-items:center; cursor:pointer; font-size:12px;">
            <input type="radio" name="coderAuth_${r.name}" value="api_key" checked style="margin:0; padding:0; width:auto; flex-shrink:0;" />
            <span>api_key</span>
          </label>
          <label style="display:flex; gap:4px; align-items:center; cursor:pointer; font-size:12px;">
            <input type="radio" name="coderAuth_${r.name}" value="login" style="margin:0; padding:0; width:auto; flex-shrink:0;" />
            <span>login</span>
          </label>
        </div>
        <div data-coder-key-row="${r.name}" style="display:flex; gap:6px; align-items:center; padding-left:24px;">
          <span style="font-size:11px; color:var(--text-muted,#888); white-space:nowrap;">${CODER_API_ENV[r.name]}：</span>
          <input type="password" data-coder-key="${r.name}" class="input" placeholder="留空 = 安装脚本里只写提示" autocomplete="new-password" spellcheck="false" style="flex:1; min-width:200px; font-size:12px; padding:4px 8px;" />
        </div>
      </div>
    `;
  }).join("");
  // Wire change handlers so the api-key row visibility tracks the
  // checkbox + radio state. login mode hides the key input; api_key
  // mode shows it.
  CODER_ROWS.forEach((r) => {
    syncCoderKeyRowVisibility(r.name);
    const cb = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[data-coder-toggle="${r.name}"]`);
    cb?.addEventListener("change", () => syncCoderKeyRowVisibility(r.name));
    agentTokenCoderRowsEl
      .querySelectorAll<HTMLInputElement>(`input[name="coderAuth_${r.name}"]`)
      .forEach((radio) => {
        radio.addEventListener("change", () => syncCoderKeyRowVisibility(r.name));
      });
  });
}

function syncCoderKeyRowVisibility(name: CoderName): void {
  const cb = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[data-coder-toggle="${name}"]`);
  const radio = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[name="coderAuth_${name}"]:checked`);
  const keyRow = agentTokenCoderRowsEl.querySelector<HTMLElement>(`[data-coder-key-row="${name}"]`);
  if (!cb || !keyRow) return;
  const showKey = cb.checked && radio?.value === "api_key";
  keyRow.style.display = showKey ? "flex" : "none";
}

function readCoderSelections(): {
  coders: { [k in CoderName]?: AgentCoderEntry };
  apiKeys: { [k in CoderName]?: string };
} {
  const coders: { [k in CoderName]?: AgentCoderEntry } = {};
  const apiKeys: { [k in CoderName]?: string } = {};
  for (const r of CODER_ROWS) {
    const cb = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[data-coder-toggle="${r.name}"]`);
    if (!cb || !cb.checked) continue;
    const radio = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[name="coderAuth_${r.name}"]:checked`);
    const auth: CoderAuthMode = (radio?.value === "login" ? "login" : "api_key") as CoderAuthMode;
    coders[r.name] = { enabled: true, auth_mode: auth };
    if (auth === "api_key") {
      const keyEl = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[data-coder-key="${r.name}"]`);
      const key = (keyEl?.value || "").trim();
      if (key) apiKeys[r.name] = key;
    }
  }
  return { coders, apiKeys };
}

async function doCreateAgentToken(): Promise<void> {
  const name = agentTokenNameInput.value.trim() || "polar-agent";
  const { coders, apiKeys } = readCoderSelections();
  const osRadio = document.querySelector<HTMLInputElement>('input[name="agentTargetOS"]:checked');
  const targetOS = (osRadio?.value === "linux" ? "linux" : "darwin") as "linux" | "darwin";
  agentTokenCreateBtn.disabled = true;
  const { response, data } = await createAgentToken({ name, coders, api_keys: apiKeys, target_os: targetOS });
  agentTokenCreateBtn.disabled = false;
  if (!response.ok) {
    window.alert("创建失败");
    return;
  }
  agentTokenJustCreatedRawEl.textContent = data.raw;
  agentTokenInstallScriptEl.value = data.install_script || "";
  agentTokenJustCreatedEl.hidden = false;
  agentTokenNameInput.value = "";
  // Clear all key inputs so they don't linger if the modal stays open.
  CODER_ROWS.forEach((r) => {
    const keyEl = agentTokenCoderRowsEl.querySelector<HTMLInputElement>(`input[data-coder-key="${r.name}"]`);
    if (keyEl) keyEl.value = "";
  });
  await loadAgentTokens();
}

async function doRevokeAgentToken(id: string): Promise<void> {
  if (!window.confirm("撤销该 token？已运行的 polar-agent 下次重连时会被拒。")) return;
  const { response } = await revokeAgentToken(id);
  if (!response.ok) {
    window.alert("撤销失败");
    return;
  }
  await loadAgentTokens();
}
createModalCloseBtn.addEventListener("click", closeCreateModal);
createModal.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.classList.contains("modal-backdrop")) closeCreateModal();
});
createForm.addEventListener("submit", (e) => void submitCreate(e));
saveDescBtn.addEventListener("click", () => void saveDescription());
saveGitRemoteBtn.addEventListener("click", () => void saveGitRemoteUrl());
saveIOSDistAppBtn.addEventListener("click", () => void saveIOSDistAppBinding());
decomposeBtn.addEventListener("click", () => void decompose());

// ── Section collapse ────────────────────────────────────────────
//
// Each section's hidden state lives in localStorage so the user's
// preference survives reloads. The chevron is a tiny stateless
// "▼" / "▶" toggle: ▼ = expanded, ▶ = collapsed.

const COLLAPSE_FEATURES_KEY = "polar_projects_features_collapsed";
const COLLAPSE_TASKS_KEY = "polar_projects_tasks_collapsed";
const COLLAPSE_RESEARCH_KEY = "polar_projects_research_collapsed";

function applyCollapse(btn: HTMLButtonElement, body: HTMLElement, collapsed: boolean): void {
  body.style.display = collapsed ? "none" : "";
  btn.textContent = collapsed ? "▶" : "▼";
}

function readCollapse(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeCollapse(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    // Storage might be unavailable in private mode; collapsing
    // still works for the current session, just doesn't persist.
  }
}

// Restore on page load.
applyCollapse(featuresCollapseBtn, featuresBodyEl, readCollapse(COLLAPSE_FEATURES_KEY));
// tasksListEl is the collapsable body of the tasks section
// (the dispatch row above it is the header and stays visible).
applyCollapse(tasksCollapseBtn, tasksListEl, readCollapse(COLLAPSE_TASKS_KEY));

featuresCollapseBtn.addEventListener("click", () => {
  const next = !readCollapse(COLLAPSE_FEATURES_KEY);
  writeCollapse(COLLAPSE_FEATURES_KEY, next);
  applyCollapse(featuresCollapseBtn, featuresBodyEl, next);
});
tasksCollapseBtn.addEventListener("click", () => {
  const next = !readCollapse(COLLAPSE_TASKS_KEY);
  writeCollapse(COLLAPSE_TASKS_KEY, next);
  applyCollapse(tasksCollapseBtn, tasksListEl, next);
});
applyCollapse(researchCollapseBtn, researchListEl, readCollapse(COLLAPSE_RESEARCH_KEY));
researchCollapseBtn.addEventListener("click", () => {
  const next = !readCollapse(COLLAPSE_RESEARCH_KEY);
  writeCollapse(COLLAPSE_RESEARCH_KEY, next);
  applyCollapse(researchCollapseBtn, researchListEl, next);
});
researchRefreshBtn.addEventListener("click", () => void loadResearchRuns());
generatePlanBtn.addEventListener("click", () => void generatePlan());
deleteBtn.addEventListener("click", () => void doDeleteProject());
dispatchAllBtn.addEventListener("click", () => void dispatchAllTodos());
finishAllBtn.addEventListener("click", () => void finishAllTasks());
cancelAllBtn.addEventListener("click", () => void cancelAllTasks());
filterSearchEl.addEventListener("input", renderProjectList);
filterStatusEl.addEventListener("change", renderProjectList);
filterCodeProviderEl.addEventListener("change", renderProjectList);
dispatchAllBotSelect.addEventListener("change", () => {
  // Re-evaluate disabled state when the bot selection changes
  // without redrawing the whole list.
  const todoCount = activeTasks.filter((t) => t.status === "todo").length;
  dispatchAllBtn.disabled = todoCount === 0 || !dispatchAllBotSelect.value;
});

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await logout();
  } finally {
    window.location.replace("/login.html");
  }
});

// ---- bootstrap ----------------------------------------------------

async function init(): Promise<void> {
  await hydrateSiteBrand();
  void mountPlatformNav();
  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
  renderSidebarFoot(data);
  await Promise.all([loadProjects(), loadBots(), loadDecomposeLLMs(), loadIOSAppsForBinding()]);
  // loadDecomposeBots reads availableBots which loadBots populated;
  // sequential so it sees the data.
  loadDecomposeBots();
  if (projects.length > 0) {
    void openProject(projects[0].id);
  }
}

void init();

// ── system_agent capability C: task retrospect modal ───────────
//
// 📋 button on done tasks → modal. GET first; if no row, prompt
// "尚无复盘 · 点击生成". Generate button hits the synchronous POST.
// Same audit/transparency surface as sharpen — LLM tag rendered.

let activeRetrospectTaskID: string | null = null;

function setRetrospectModalOpen(open: boolean): void {
  const modal = document.getElementById("taskRetrospectModal");
  if (!modal) return;
  modal.classList.toggle("open", open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

async function openTaskRetrospectModal(taskID: string): Promise<void> {
  if (!activeProject) return;
  activeRetrospectTaskID = taskID;
  const meta = document.getElementById("taskRetrospectMeta");
  const body = document.getElementById("taskRetrospectBody");
  const status = document.getElementById("taskRetrospectStatus");
  if (meta) meta.textContent = "加载中...";
  if (body) body.innerHTML = "";
  if (status) status.textContent = "";
  setRetrospectModalOpen(true);
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(taskID)}/retrospect`,
      { credentials: "include" },
    );
    const data = await res.json();
    if (!res.ok) {
      if (meta) meta.textContent = data?.error || "加载失败";
      return;
    }
    renderRetrospect(data.retrospect);
  } catch (e) {
    if (meta) meta.textContent = `加载失败：${(e as Error).message}`;
  }
}

type RetrospectShape = {
  summary?: string;
  tools_used?: string;
  open_issues?: string;
  next_time?: string;
  llm_name?: string;
  llm_model?: string;
  generated_at?: string;
} | null;

function renderRetrospect(r: RetrospectShape): void {
  const meta = document.getElementById("taskRetrospectMeta");
  const body = document.getElementById("taskRetrospectBody");
  if (!body || !meta) return;
  if (!r || !r.summary) {
    meta.textContent = "尚无复盘 — 点 \"重新生成\" 即可创建。";
    body.innerHTML = "";
    return;
  }
  const llmTag = r.llm_name ? `由 ${r.llm_name}${r.llm_model ? ` · ${r.llm_model}` : ""} 生成` : "";
  meta.textContent = llmTag;
  const sections: Array<[string, string | undefined]> = [
    ["总结", r.summary],
    ["用到的工具 / 模块", r.tools_used],
    ["遗留问题", r.open_issues],
    ["下次注意事项", r.next_time],
  ];
  body.innerHTML = sections
    .map(
      ([label, text]) => `
      <div class="bio-refine-draft">
        <div class="bio-refine-draft-head">
          <span class="bio-refine-draft-label">${escapeHTML(label)}</span>
        </div>
        <div class="bio-refine-draft-text">${escapeHTML(text || "（空）")}</div>
      </div>
    `,
    )
    .join("");
}

document.getElementById("taskRetrospectCloseBtn")?.addEventListener("click", () => setRetrospectModalOpen(false));
document
  .querySelector("#taskRetrospectModal .modal-backdrop")
  ?.addEventListener("click", () => setRetrospectModalOpen(false));

document.getElementById("taskRetrospectRegenerateBtn")?.addEventListener("click", async () => {
  if (!activeProject || !activeRetrospectTaskID) return;
  const btn = document.getElementById("taskRetrospectRegenerateBtn") as HTMLButtonElement | null;
  const status = document.getElementById("taskRetrospectStatus");
  if (btn) btn.disabled = true;
  if (status) status.textContent = "生成中...";
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(activeProject.id)}/tasks/${encodeURIComponent(activeRetrospectTaskID)}/retrospect`,
      { method: "POST", credentials: "include" },
    );
    const data = await res.json();
    if (!res.ok) {
      if (status) status.textContent = data?.error || "生成失败";
      return;
    }
    renderRetrospect(data.retrospect);
    if (status) status.textContent = "";
  } catch (e) {
    if (status) status.textContent = `生成失败：${(e as Error).message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
});
