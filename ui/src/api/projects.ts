import { requestJson } from "@networkextension/polar-ui-common/api/http";
import type {
  AgentTokenCreatePayload,
  AgentTokenCreateResponse,
  AgentTokenListResponse,
  ProjectCreatePayload,
  ProjectCreateResponse,
  ProjectDecomposeResponse,
  ProjectDetailResponse,
  ProjectFeatureUpdatePayload,
  ProjectGeneratePlanResponse,
  ProjectListResponse,
  ProjectTask,
  ProjectTaskUpdatePayload,
  ProjectUpdatePayload,
} from "../types/projects.js";

export async function fetchProjects() {
  return requestJson<ProjectListResponse>("/api/projects");
}

export async function fetchProject(id: string) {
  return requestJson<ProjectDetailResponse>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function createProject(payload: ProjectCreatePayload) {
  return requestJson<ProjectCreateResponse>("/api/projects", {
    method: "POST",
    body: payload,
  });
}

export async function updateProject(id: string, payload: ProjectUpdatePayload) {
  return requestJson<ProjectCreateResponse>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: payload,
  });
}

export async function deleteProject(id: string) {
  return requestJson<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function decomposeProject(
  id: string,
  llmConfigID?: number,
  botUserID?: string,
) {
  const body: Record<string, unknown> = {};
  if (llmConfigID && llmConfigID > 0) body.llm_config_id = llmConfigID;
  if (botUserID && botUserID.trim() !== "") body.bot_user_id = botUserID.trim();
  return requestJson<ProjectDecomposeResponse>(`/api/projects/${encodeURIComponent(id)}/decompose`, {
    method: "POST",
    body,
  });
}

export async function updateProjectFeature(id: string, featureID: string, payload: ProjectFeatureUpdatePayload) {
  return requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(id)}/features/${encodeURIComponent(featureID)}`,
    { method: "PUT", body: payload },
  );
}

export async function deleteProjectFeature(id: string, featureID: string) {
  return requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(id)}/features/${encodeURIComponent(featureID)}`,
    { method: "DELETE" },
  );
}

export async function generateProjectPlan(id: string) {
  return requestJson<ProjectGeneratePlanResponse>(`/api/projects/${encodeURIComponent(id)}/plan`, {
    method: "POST",
  });
}

export async function updateProjectTask(id: string, taskID: string, payload: ProjectTaskUpdatePayload) {
  return requestJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskID)}`,
    { method: "PUT", body: payload },
  );
}

// bulkUpdateProjectTaskStatus updates many tasks in one request.
// from_statuses (optional) filters which tasks to touch — leave
// empty to apply to every task in the project.
export async function bulkUpdateProjectTaskStatus(
  id: string,
  status: string,
  fromStatuses?: string[],
) {
  return requestJson<{ ok: boolean; updated: number }>(
    `/api/projects/${encodeURIComponent(id)}/tasks/bulk-status`,
    {
      method: "POST",
      body: { status, from_statuses: fromStatuses ?? [] },
    },
  );
}

export type ProjectTaskPickupResponse = {
  task: ProjectTask;
  chat_thread_id: number;
  llm_thread_id: number;
  bot_name: string;
};

// Assigns a task to a bot. Backend creates / reuses the user↔bot
// chat thread, opens a fresh llm_thread titled after the task,
// drops the task description as the user's first message, and
// enqueues the AI agent so the bot starts working immediately.
export async function pickupProjectTask(id: string, taskID: string, botUserID: string) {
  return requestJson<ProjectTaskPickupResponse>(
    `/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskID)}/pickup`,
    { method: "POST", body: { bot_user_id: botUserID } },
  );
}

// ---- research dispatch (research-runtime project only) -----------

export type ResearchRun = {
  id: number;
  workspace_id: string;
  project_id: string;
  task_id?: string;
  bot_user_id: string;
  chat_thread_id?: number;
  llm_thread_id?: number;
  llm_config_id?: number;
  llm_name: string;
  llm_model: string;
  llm_base_url: string;
  status: "queued" | "running" | "succeeded" | "failed";
  iterations: number;
  files_written?: string[];
  commit_sha: string;
  summary: string;
  error_message: string;
  log_text: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
};

export type ResearchDispatchResponse = {
  research_run: ResearchRun;
  bot: { id: number; user_id: string; name: string };
  llm: { config_id?: number; name: string; model: string; base_url?: string };
  workdir?: string;
};

export async function dispatchResearchTask(
  projectID: string,
  taskID: string,
  botUserID: string,
  llmConfigID?: number,
) {
  const body: Record<string, unknown> = { bot_user_id: botUserID };
  if (llmConfigID && llmConfigID > 0) body.llm_config_id = llmConfigID;
  return requestJson<ResearchDispatchResponse>(
    `/api/projects/${encodeURIComponent(projectID)}/tasks/${encodeURIComponent(taskID)}/research/dispatch`,
    { method: "POST", body },
  );
}

export async function fetchResearchRuns(projectID: string, limit = 20) {
  return requestJson<{ runs: ResearchRun[] }>(
    `/api/projects/${encodeURIComponent(projectID)}/research/runs?limit=${limit}`,
  );
}

// ---- agent tokens (polar-agent CLI credentials) ------------------

export async function fetchAgentTokens() {
  return requestJson<AgentTokenListResponse>("/api/agent/tokens");
}

export async function createAgentToken(payload: AgentTokenCreatePayload) {
  return requestJson<AgentTokenCreateResponse>("/api/agent/tokens", {
    method: "POST",
    body: payload,
  });
}

export async function revokeAgentToken(id: string) {
  return requestJson<{ ok: boolean }>(`/api/agent/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export type AgentBotStatus = {
  attached: boolean;
  workdir?: string;
  capabilities?: string[];
  // tool: passthrough tool name from the agent's hello frame
  // ("kimi" / "claude" / "codex" / custom). Empty when the agent
  // is in tool-call loop mode (capability list contains "tools"
  // but not "passthrough"/"kimi").
  tool?: string;
  // remote_ip + attached_at + uptime_sec are populated only when
  // attached=true. remote_ip is the address dock saw the WebSocket
  // come in on (after any reverse proxy strips its own hop). Empty
  // string when not attached.
  remote_ip?: string;
  attached_at?: string;   // RFC3339 UTC
  uptime_sec?: number;
};

// Agent attach status for a single bot. Used by bots.ts to show a
// "passthrough mode" badge so users know a bot's configured model
// field is being bypassed by a local runtime (kimi-cli today).
export async function fetchAgentBotStatus(botUserID: string) {
  return requestJson<AgentBotStatus>(`/api/agent/bots/${encodeURIComponent(botUserID)}/status`);
}
