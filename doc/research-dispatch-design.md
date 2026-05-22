# 研究任务派发 · 设计稿

## 背景

研究项目（`projects.runtime_env = "research"`）的派单链路目前是：dock
做 LLM 调用 → 经 WebSocket 派发 `read_file` / `write_file` / `run_cmd`
工具到 polar-agent → agent 执行后回写结果。这套对代码项目仍然合用，
但研究项目暴露出两个问题：

1. **LLM 在 dock 调，工具在 agent 跑** — 一来一回经过 WS，对时延敏感
   的多轮 agent loop（OpenClaw / Aider 风格）来说不舒服。
2. **bot 选择不防呆** — 操作员可以把任意 classic bot 派给研究项目，
   bot 自带的人格 system_prompt（比如「你是美股分析师」）会污染研究
   任务，model 输出走偏（已经发生过一次）。

新方向：研究任务走一条**独立的派发管线**，polar-agent 拿到任务后在
本地完成「LLM 调用 → 写文件 → git commit/push → 回调 dock」的闭环。
dock 退化成「派 task + 发凭证 + 接收结果」的远控通道。

**显式约束**：dock 现有功能（dock-side tool-loop、passthrough、各类
assist、所有现有路由 / 表）一概不动。本设计只新增一条支路。

## 目标 / 非目标

**做**

- 研究任务走 agent-driven 本地 LLM loop（"瘦身 OpenClaw"）
- 工具集复用现有 4 件套：`read_file` / `write_file` / `list_dir` / `run_cmd`（白名单含 `git`）
- 任务源头双轨预留：dock push（本期）+ 手工 stdin（下期）
- 研究产物形态不预设：文本、开发方案、设计稿、投研观点都行；LLM
  自己决定写哪些文件
- LLM 透明度强制：派单前提示、agent 启动消息、结果记录、commit
  trailer 四处可见

**不做（本 PR）**

- 手工 stdin REPL（Phase 2）
- thread 历史从 dock 搬到 agent（Phase 3）
- `apply_patch` / 高级 diff 工具（先 4 件套）
- 多 task 并发 / token 计数 UI
- 修改任何已有路由 / 表 / dock-side tool-loop

## 架构

```
┌─────────────┐  POST /research/dispatch    ┌──────────────────────┐
│ dock (UI)   │────────────────────────────►│ dock                 │
│ 派单按钮     │   {task_id, llm_snapshot}   │ - 校验 attached       │
└─────────────┘                             │ - INSERT research_run │
                                            │ - 经 WS 推 task       │
                                            └──────┬───────────────┘
                                                   │  task_kind=research
                                                   │  llm_config snapshot
                                                   ▼
                                            ┌──────────────────────┐
                                            │ polar-agent          │
                                            │ research runner      │
                                            │ ─────────────────────│
                                            │ 1. 启动消息回 dock    │
                                            │ 2. local LLM loop    │
                                            │ 3. tools 本地执行     │
                                            │ 4. git add/commit/push│
                                            │ 5. POST result       │
                                            └──────┬───────────────┘
                                                   │
                                          POST /research/callback
                                                   │
                                                   ▼
                                            ┌──────────────────────┐
                                            │ dock                 │
                                            │ UPDATE research_run  │
                                            │ commit_sha, files,   │
                                            │ summary, status      │
                                            └──────────────────────┘
```

## Schema

新表 `project_research_runs`（不动 `projects` / `project_tasks` / 任何
现有表）：

```sql
CREATE TABLE IF NOT EXISTS project_research_runs (
    id              BIGSERIAL PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT REFERENCES project_tasks(id) ON DELETE SET NULL,
    bot_user_id     TEXT NOT NULL,                    -- 派给哪个 bot
    chat_thread_id  BIGINT REFERENCES chat_threads(id),
    llm_thread_id   BIGINT REFERENCES llm_threads(id),

    -- LLM 快照（透明度强制 #3）
    llm_config_id   BIGINT,
    llm_name        TEXT NOT NULL,                    -- 比如 "Doubao Seed Pro"
    llm_model       TEXT NOT NULL,                    -- 比如 "doubao-seed-2-0-pro-260215"
    llm_base_url    TEXT,                             -- 不存 api_key

    -- 进度 / 结果
    status          TEXT NOT NULL,                    -- queued | running | succeeded | failed
    iterations      INTEGER NOT NULL DEFAULT 0,       -- LLM 轮数（agent 回填）
    files_written   JSONB,                            -- ["docs/research/foo.md", ...]
    commit_sha      TEXT,
    summary         TEXT,                             -- 1~3 句话总结
    error_message   TEXT,
    log_text        TEXT,                             -- 摘要日志（cap 8KB）

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_research_runs_project ON project_research_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_research_runs_status  ON project_research_runs(status) WHERE status IN ('queued','running');
```

## API

### `POST /api/projects/:project_id/tasks/:task_id/research/dispatch`

权限：workspace member。校验：

- `project.runtime_env == "research"`，否则 400
- bot 属于本 workspace + classic kind
- polar-agent attached（`agentHub.lookup(botUserID) != nil`），否则 503
  + 提示文案
- workspace 默认 LLM 存在（`getWorkspaceDefaultLLMConfigID()`）；若
  payload 显式带 `llm_config_id`，以显式优先（沿用 PR #106 picker
  优先于 bot 绑定的语义）

Body:

```json
{ "bot_user_id": "bot_xxx", "llm_config_id": 12 }
```

Response:

```json
{
  "research_run": {
    "id": 7,
    "status": "queued",
    "llm": { "config_id": 12, "name": "Doubao Seed Pro", "model": "doubao-seed-2-0-pro-260215" }
  }
}
```

副作用：

1. 复用现有 `ensureChatThread` + `createLLMThread`（不重发明）
2. INSERT `project_research_runs` 行 status=queued
3. 经 `agentHub.dispatchResearchTask()`（新方法，与现有
   `dispatchToolCall` 并列）经 WS 推送：

   ```json
   {
     "kind": "research_task",
     "research_run_id": 7,
     "task_id": "task_abc",
     "project_id": "proj_xyz",
     "chat_thread_id": 42,
     "llm_thread_id": 99,
     "task_content": "<pickup body 渲染后内容>",
     "llm": {
       "name": "Doubao Seed Pro",
       "model": "doubao-seed-2-0-pro-260215",
       "base_url": "https://ark.cn-beijing.volces.com/api/v3",
       "api_key": "<60s ttl token / 实际 key>",
       "provider": "volces"
     }
   }
   ```

   `api_key` 直接走（不另设 token 桥），但**不持久化在 agent
   workdir / agent 进程退出即丢**——agent 端 LLM client 拿到就直接调，
   不写盘、不进 ENV、不进 log。

### `POST /api/projects/research/runs/:run_id/start` (agent token)

agent 收到 task 后第一件事调这个 endpoint，把
`project_research_runs.status` 推到 `running`，`started_at = NOW()`。
顺带触发**透明度落地点 #2**：dock 在对应 chat_thread 里插一条系统
消息：

> 🔬 研究任务启动 · LLM: Doubao Seed Pro (doubao-seed-2-0-pro-260215) · workdir: /Users/.../proj-foo

UI 在 chat 里直接看到。

### `POST /api/projects/research/runs/:run_id/result` (agent token)

Body:

```json
{
  "ok": true,
  "iterations": 6,
  "files_written": ["docs/research/timeline.md", "docs/research/sources.md"],
  "commit_sha": "abc123def",
  "summary": "整理了 2024 Q1-Q2 访华时间线并标注来源 URL。",
  "log_text": "<最后 8KB 摘要日志>"
}
```

dock 落表，UI 状态翻牌。

### `GET /api/projects/:project_id/research/runs?limit=20`

列出该 project 的研究历史。UI 在项目页加一个「研究记录」tab，
列展示：created_at / status / **LLM 名 + model** / commit_sha / files
数 / summary 截断。**透明度落地点 #3**。

## polar-agent 端

新文件：

- `cmd/polar-agent/research.go` — research task 处理器，从 attach
  loop 接收 `kind=research_task` 消息后跑下面这个流程
- `cmd/polar-agent/llm_client.go` — 通用 OpenAI 兼容 client（仿 dock
  端的 `requestChatCompletion` 但极简化）
- `cmd/polar-agent/research_runner.go` — tool loop（参考 dock 端
  `generateReplyWithTools` 的结构，但工具本地执行，不再经 WS）

流程：

```
1. 收到 research_task 消息
2. 立刻 POST /research/runs/<id>/start
3. 拼 system prompt：
   - workspace 默认 system addendum（"你是研究助手，根据 task 调
     用工具收集 / 整理 / 撰写产物，最后 git commit + push"）
   - 工具说明（read_file / write_file / list_dir / run_cmd 含 git）
   - 透明度提示："本任务使用 LLM: <name> (<model>)，操作员可见"
4. messages = [system, user=task_content]
5. for iter in 0..maxIter:
     - 调本地 LLM client（用下发的 api_key）
     - 没 tool_calls → break
     - 有 tool_calls → 本地执行（fs / exec）→ append role:tool 消息
6. 自动 git add -A && git commit -m "<llm summary> ..." && git push
   - commit footer 加：
     Polar-Research-LLM: Doubao Seed Pro/doubao-seed-2-0-pro-260215
     Polar-Research-Run: 7
     （透明度落地点 #4）
7. POST /research/runs/<id>/result
```

**凭证生命周期**：`api_key` 从 dock 推下来后只在 agent 进程内存里活
着，task 结束清零；不写 disk、不打 log、不传 stderr。子进程（git
push 拉远端 https）需要 git credential，那是另一套（已有 PR #97 的
git credential helper），不复用 LLM 凭证。

## UI

`ui/public/projects.html` + `ui/src/projects.ts` 改动：

1. 项目页「派单」按钮逻辑分支：研究项目走新 confirm 弹窗（**透明度
   落地点 #1**）：

   ```
   ┌─────────────────────────────────────────────┐
   │ 派发研究任务                                  │
   ├─────────────────────────────────────────────┤
   │ 任务: <task title>                           │
   │ 工作 bot: <bot name>                         │
   │ 使用 LLM: Doubao Seed Pro                   │
   │           doubao-seed-2-0-pro-260215         │
   │ 工作目录: ~/projects/<repo>                  │
   │                                              │
   │ Agent 会本地驱动 LLM，写文件后自动 git push。│
   │                                              │
   │              [取消]  [确认派发]               │
   └─────────────────────────────────────────────┘
   ```

2. 项目页加「研究记录」tab，调 `GET /research/runs`，表格列：
   started_at / LLM / commit / files / summary / status / 点击展开 log。

## 失败模型

- agent 没 attach → dispatch 直接 503，UI 提示 attach
- LLM 调用失败（401 / 429 / 网络） → agent 重试 3 次后 POST result
  ok=false，error_message 落库
- 工具调用失败（write 不到 / git push 拒绝） → agent 把 stderr 拼到
  下一轮 message 让 LLM 自己处理；LLM 选择放弃则正常 finish
- 超 N 轮（默认 16） → agent POST result ok=false +
  error="iteration limit"，已写文件不回滚（让操作员自己看）

## Phase 切片

| Phase | 内容 | 估算 |
|-------|------|------|
| **1（本 PR）** | schema + dispatch endpoint + agent research runner + UI confirm + 历史 tab + 4 处透明度落地 | ~3 天 |
| 2 | `polar-agent research --stdin` 手工输入 REPL | ~1 天 |
| 3 | thread 历史从 dock 搬到 agent（可选，远期） | ~1 周 |

## 与现有 PR 的关系

- **PR #108（研究项目派单不要求 attach）必须关掉** — 跟新方向冲突，
  研究照样要 attach（要 write + git）。先关，再开本 PR。
- PR #103 / #104 / #105 / #106（auto-register coder + research bot、
  workspace 默认 LLM、runtime_env 过滤、LLM picker 优先级）全部沿
  用，不动。
- 现有 dock-side `generateReplyWithTools`（代码项目走的那条）原样保留。

## 验证

- `go build ./...` / `go test ./...` 通过
- `cd ui && npm run build` 通过
- 手动：研究项目里建一个 task「整理 2024 X 公司大事时间线」→ 派单
  确认弹窗显示 LLM → agent 跑 → workdir 多出 markdown → git log 看
  到 trailer 写着对应 LLM → 项目页「研究记录」列出该 run + LLM 列
- 手动：bot 没 attach 时派单 → 503，文案清晰
- 手动：故意把 LLM key 改错 → agent 报错回写，UI 看到 failed +
  error_message
