-- ============================================================
-- polar_projects schema — end-state.
--
-- Apply:
--   CREATE DATABASE polar_projects OWNER ideamesh;
--   psql -d polar_projects -f scripts/migrate/projects-schema.sql
--
-- The projects plugin owns the AI-driven product workflow:
--   - projects: top-level container
--   - project_features: AI-decomposed feature list
--   - project_tasks: execution rows (1:1 to chat_thread)
--   - project_task_revisions: append-only audit of major task edits
--   - project_task_retrospects: post-completion summary per task
--   - project_research_runs: research-mode dispatch lifecycle
--
-- Cross-DB references (TEXT/BIGINT, resolved via dock SDK):
--   - workspace_id, creator_user_id, created_by, bot_user_id →
--     /internal/v1/{users,teams}/:id
--   - default_llm_config_id, llm_config_id → /internal/v1/llm-configs/:id
--   - chat_thread_id, llm_thread_id → dock-owned (chat + llm threads);
--     polar_projects keeps them as BIGINT pointers, future
--     /internal/v1/chat-threads/:id endpoint resolves on demand
--   - iosdist_app_id → was FK to iosdist_apps; now polar_iosdist owns
--     that table. Stays BIGINT pointer; lookups via polar_iosdist's
--     future /internal/v1/iosdist-apps/:id (if needed for join queries
--     dock UI does it client-side via separate SDK calls).
--   - feature_id within projects-svc IS a real FK to project_features.
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    creator_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    template TEXT NOT NULL DEFAULT '',
    runtime_env TEXT NOT NULL DEFAULT '',
    business_scenario TEXT NOT NULL DEFAULT '',
    code_provider TEXT NOT NULL DEFAULT '',
    current_sprint INT NOT NULL DEFAULT 0,
    git_remote_url TEXT NOT NULL DEFAULT '',
    iosdist_app_id BIGINT,                    -- cross-DB pointer to polar_iosdist
    default_llm_config_id BIGINT,             -- cross-DB pointer (dock SDK lookup)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_iosdist_app
    ON projects(iosdist_app_id) WHERE iosdist_app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_features (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ord INT NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    complexity TEXT NOT NULL DEFAULT 'medium',
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    sprint_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_features_project ON project_features(project_id, ord);
CREATE INDEX IF NOT EXISTS idx_project_features_project_sprint
    ON project_features(project_id, sprint_number, ord);

CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    feature_id TEXT REFERENCES project_features(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    bot_user_id TEXT,             -- cross-DB pointer (dock SDK lookup)
    chat_thread_id BIGINT,        -- cross-DB pointer to dock's chat_threads
    llm_thread_id BIGINT,         -- cross-DB pointer to dock's llm_threads
    sprint_number INT NOT NULL DEFAULT 1,
    ord INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, ord);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_sprint
    ON project_tasks(project_id, sprint_number, ord);

CREATE TABLE IF NOT EXISTS project_task_revisions (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    llm_name TEXT NOT NULL DEFAULT '',
    llm_model TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_task_revisions_task
    ON project_task_revisions(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_task_retrospects (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES project_tasks(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    tools_used TEXT NOT NULL DEFAULT '',
    open_issues TEXT NOT NULL DEFAULT '',
    next_time TEXT NOT NULL DEFAULT '',
    llm_name TEXT NOT NULL DEFAULT '',
    llm_model TEXT NOT NULL DEFAULT '',
    generated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_task_retrospects_task
    ON project_task_retrospects(task_id);

-- research-mode dispatch lifecycle. LLM snapshot columns intentional
-- so history survives later re-binding of the bot to a different LLM.
CREATE TABLE IF NOT EXISTS project_research_runs (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES project_tasks(id) ON DELETE SET NULL,
    bot_user_id TEXT NOT NULL,    -- cross-DB pointer to dock's bot_users
    chat_thread_id BIGINT,        -- cross-DB pointer
    llm_thread_id BIGINT,         -- cross-DB pointer
    llm_config_id BIGINT,         -- cross-DB pointer
    llm_name TEXT NOT NULL DEFAULT '',
    llm_model TEXT NOT NULL DEFAULT '',
    llm_base_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    iterations INTEGER NOT NULL DEFAULT 0,
    files_written JSONB,
    commit_sha TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    log_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_runs_project
    ON project_research_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_workspace
    ON project_research_runs(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_open
    ON project_research_runs(status) WHERE status IN ('queued','running');
