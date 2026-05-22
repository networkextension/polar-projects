export type ProjectStatus =
  | "draft"
  | "planning"
  | "building"
  | "beta"
  | "shipped"
  | "archived";

export type FeatureComplexity = "simple" | "medium" | "complex";

export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";

export type Project = {
  id: string;
  workspace_id: string;
  creator_user_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  template: string;
  runtime_env: string;
  business_scenario: string;
  code_provider: string;
  current_sprint: number;
  // git_remote_url: optional remote where polar-agent pushes
  // coder output after each task completes. Empty disables push.
  git_remote_url: string;
  // iosdist_app_id: optional FK to iosdist_apps. When set, the
  // pickup body includes the bundle id + xcodegen guidance and
  // the iOS submit-build flow is enabled.
  iosdist_app_id?: number | null;
  // default_llm_config_id: persisted at AI 拆解 time. Sub-task chats
  // and research dispatches inherit this. null = project hasn't been
  // decomposed yet (or the referenced config was deleted).
  default_llm_config_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type ProjectFeature = {
  id: string;
  project_id: string;
  ord: number;
  title: string;
  description: string;
  complexity: FeatureComplexity;
  selected: boolean;
  sprint_number: number;
  created_at: string;
};

export type ProjectTask = {
  id: string;
  project_id: string;
  feature_id?: string;
  title: string;
  description: string;
  status: TaskStatus;
  bot_user_id?: string;
  chat_thread_id?: number;
  llm_thread_id?: number;
  sprint_number: number;
  ord: number;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
};

export type ProjectListResponse = {
  projects: Project[];
};

export type ProjectDetailResponse = {
  project: Project;
  features: ProjectFeature[];
  tasks: ProjectTask[];
};

export type ProjectCreateResponse = {
  project: Project;
};

export type ProjectDecomposeResponse = {
  features: ProjectFeature[];
  new_sprint?: number;
  llm_used?: { id: number; name: string; model: string };
  bot_used?: { bot_user_id: string; persona_chars: number };
  error?: string;
  raw?: string;
  hint?: string;
};

export type ProjectGeneratePlanResponse = {
  tasks: ProjectTask[];
  created_count: number;
};

export type ProjectCreatePayload = {
  name: string;
  description?: string;
  template?: string;
  runtime_env?: string;
  business_scenario?: string;
  code_provider?: string;
  git_remote_url?: string;
  iosdist_app_id?: number | null;
};

export type ProjectUpdatePayload = {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  template?: string;
  runtime_env?: string;
  business_scenario?: string;
  code_provider?: string;
  git_remote_url?: string;
  iosdist_app_id?: number | null;
};

export type ProjectFeatureUpdatePayload = {
  title: string;
  description: string;
  complexity: FeatureComplexity;
  selected: boolean;
};

export type ProjectTaskUpdatePayload = {
  title?: string;
  description?: string;
  status?: TaskStatus;
  // Audit hints (system_agent capability B): when set, the server
  // snapshots the pre-update task to project_task_revisions before
  // applying the change. Used by the ✨ task sharpen flow to track
  // "what was the description before AI rewrote it" + which LLM did
  // the rewrite (4-touchpoint transparency).
  audit_source?: string;
  audit_llm_name?: string;
  audit_llm_model?: string;
};

export type CoderName = "kimi" | "claude" | "codex";
export type CoderAuthMode = "api_key" | "login";

export type AgentCoderEntry = {
  enabled: boolean;
  auth_mode: CoderAuthMode;
};

export type AgentCoderConfig = {
  kimi?: AgentCoderEntry;
  claude?: AgentCoderEntry;
  codex?: AgentCoderEntry;
};

export type AgentToken = {
  id: string;
  user_id: string;
  name: string;
  coder_config?: AgentCoderConfig;
  host_os?: string;
  host_arch?: string;
  host_name?: string;
  host_ip?: string;
  last_attached_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  created_at: string;
};

export type AgentTokenCreatePayload = {
  name: string;
  coders?: { [k in CoderName]?: AgentCoderEntry };
  // api_keys: only sent for coders the user picked api_key auth
  // mode for. Server filters and renders into install script's
  // ~/.polar/tools.json env block; never persisted to DB.
  api_keys?: { [k in CoderName]?: string };
  // target_os: "darwin" → install.sh, "linux" → docker run snippet
  target_os?: "darwin" | "linux";
};

export type AgentTokenCreateResponse = {
  token: AgentToken;
  raw: string;
  install_script: string;
  hint: string;
};

export type AgentTokenListResponse = {
  tokens: AgentToken[];
};
