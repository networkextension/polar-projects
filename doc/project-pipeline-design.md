# Project End-to-End Pipeline Design

**Status**: roadmap / design recording
**Owner**: backlog (no IC committed)
**Created**: 2026-05-06

The vision: a single project goes from "idea written by a human"
to "deployed build artifact" without manual hand-offs between
stages. Each stage already exists as a separate concept; this
doc names the gaps and the order they should be filled.

```
[1] Review        →  [2] Split        →  [3] Agent start    →  [4] Coding
    idea + prompt    AI 拆解 features      auto-provision        task pickup loop
    审核 gate        sprint 迭代          host/container         polar-agent + tool
       │                  │                    │                     │
       └──────────────────┴────────────────────┴─────────────────────┘
                                   │
                          ↓ committed code in workdir
                                   │
[5] Push          →  [6] CI/CD        →  [7] Publish
    git automation    trigger build      artifact visible
    polar-agent       run tests          to project owner
    or coder tool     report pass/fail   download / deploy link
```

Today: stages 2 + 4 work end-to-end. Stages 1, 3, 5, 6, 7 are
either manual, partial, or missing.

---

## Stage 1 — Review (project / idea / LLM prompt)

**Goal.** Before AI 拆解 burns LLM tokens, an owner can sanity-check
that:
- the project's *idea* (description) is non-empty and specific
- the chosen *bot persona* (system prompt) matches the project type
- the chosen *LLM config* is the one this owner wants to bill
- nothing about the prompt is ambiguous or about to produce slop

**Current state**: 🟡 partial.
- Project has `description` (= idea), `bot_user_id` selector,
  `llm_config_id` selector — all editable from the project UI
- The prompt is constructed silently inside
  `buildDecomposePromptWithPersona` in
  `internal/app/dock/projects_handlers.go` — the user never sees
  the actual text shipped to the LLM
- No "preview prompt" / "save draft and review" gate

**Gap & design**:
- Add `GET /api/projects/:id/decompose-preview?bot_user_id=&llm_config_id=`
  that returns the *exact* prompt that would be sent — JSON, no
  side-effects. Front-end shows it in a collapsible code block on
  the decompose modal.
- Optional: store the preview as a draft (`project_decompose_drafts`
  table, project_id + prompt + created_by) so a reviewer different
  from the owner can approve it before the run.
- Cheap UX win: copy-to-clipboard + "edit prompt before send"
  textarea (same shape as the existing `system_prompt` override on
  bot users). Even without a separate review role, the owner gets
  one extra read of what they're about to spend tokens on.

**Estimate**: 0.5 wk (preview endpoint + textarea), 1.5 wk (with
draft table + reviewer role).

**Trigger**: first time a decompose run produces obvious garbage
that a 30-second human read would have caught.

---

### Stage 1 sub-concern — reference materials (PDF / 设计稿 / 需求文档)

**Goal.** Owner uploads PDFs, design mockups, requirement docs
alongside the project; coder tool sees them as plain
context when working on tasks.

**Recommendation: hybrid (platform attachment + just-in-time
fetch + vision pre-processing).** Concretely:

1. **Upload path**: drag-drop on project page → R2 / local
   `uploads/` (existing `StorageBackend`). New table
   `project_attachments(project_id, kind, path, mime, summary_md,
   created_at)`. Reuses the same plumbing as chat attachments.
2. **Vision pre-processing for non-text** (design mockups,
   screenshots, whiteboard photos): on upload, kick off a
   server-side job that asks a vision-capable LLM (Claude with
   vision; or 任一 vision 模型) to produce a structured Markdown
   description: layout, components, copy, behaviors. Store as
   `summary_md`. Original binary stays in storage; LLMs that
   can't see images get the `summary_md` instead.
3. **Format extraction (PDF / Office / image / HTML)**: handled
   *agent-side* by [`markitdown`](https://github.com/microsoft/markitdown)
   (Microsoft's open-source format converter). One Python package
   covers PDF / .docx / .pptx / .xlsx / images / HTML / CSV /
   YouTube URLs → markdown. Add to the standard polar-agent image
   (see [`agent-container-design.md`](agent-container-design.md))
   so every agent host can convert without server-side processing
   pipeline.
   - **Text-extractable formats** (PDF with text layer, Office
     docs, HTML, CSV) — markitdown handles in one shot, no LLM
     needed.
   - **Image / vision-heavy formats** (PNG/JPG mockups, scanned
     PDFs, screenshots) — markitdown only produces useful md *if*
     it has a vision-capable LLM configured. This is the routing
     question handled in step 4 below.
4. **Capability-aware routing for vision** — the part that actually
   matters. An agent attaches 1-N bots; not every bot has a vision
   path. We must not dispatch a "拆设计稿" task to a bot whose
   tool/model can't read images, or it'll silently produce garbage.

   Concrete rule: **design / image-heavy attachments are routed to
   the project's `vision_llm_config_id` (see "Per-stage LLM
   selection" cross-cut)** — a workspace-level Claude (or whichever
   vision model wins the bake-off) does the design → markdown
   conversion *once*, server-side or in a dedicated agent slot.
   Output `summary_md` is then reused by every downstream bot
   regardless of its own vision capability.

   Per-tool capability matrix (**TODO: verify before relying on
   this — need a small bake-off**):

   | Tool / CLI | Vision in CLI? | Notes |
   |---|---|---|
   | `claude` (claude-code) | yes | Native image input; `claude` accepts image paths in prompts. Recommended default for design 拆稿. |
   | `codex` (OpenAI codex CLI) | unverified | Underlying model (gpt-5 / o3) supports vision but CLI piping needs confirmation. Don't assume — test. |
   | `kimi-cli` | unverified | Moonshot has multimodal models; kimi-cli's image flag/argv is unclear. Don't assume — test. |
   | `markitdown` image mode | yes (via configured LLM) | Drives any OpenAI-compatible vision endpoint. Cleanest path for "convert PNG/JPG to md without involving the coder tool". |

   Until the bake-off is done, default to: design files → Claude via
   markitdown's image-mode (markitdown configured with the
   workspace's vision LLM endpoint), output `summary_md` cached and
   handed to *every* bot. Don't mix design 拆稿 into a kimi/codex
   task even if those bots are otherwise the project's preferred
   coder.

5. **Just-in-time fetch**: when polar-agent dispatches a task on
   this project, server hands over the original attachment URLs
   (signed, short-TTL) *plus* the cached `summary_md` if vision
   pre-processing has run. polar-agent runs
   `markitdown <file> > _refs/<file>.md` for any text-extractable
   file that doesn't yet have a cached md, drops both the source
   and the rendered `.md` into `<workdir>/_refs/` — `.gitignore`'d,
   never committed. Coder tool's prompt mentions the path:
   "参考资料在 `_refs/`，需要时读 `.md` 即可"。

**Why hybrid** (not "stick it in git" and not "platform-only"):
- Git: design files are 30-50 MB binaries; git-lfs is workable
  but adds friction, and version diffs of a PNG are useless
- Platform-only: coder tools natively read files in workdir, not
  arbitrary URLs; pulling refs onto the disk is what actually
  works
- Hybrid: ergonomic upload UX + clean git history + works with
  every coder tool regardless of vision capability

**Estimate**: 1 wk for upload + storage + just-in-time fetch
plumbing; +0.5 wk for vision pre-processing job and `summary_md`
generation. (`markitdown` itself is a `uv tool install` line in
the agent image — see [`agent-container-design.md`](agent-container-design.md);
no extra estimate.)

**Trigger**: first project where the idea field alone isn't
enough — typically the first non-trivial project.

---

## Stage 2 — Split feature

**Goal.** Project idea → list of features → list of tasks per
feature, grouped into sprints, status tracked on each row.

**Current state**: ✅ done.
- `appendProjectFeatures` (PR #80) atomically increments
  `current_sprint` and tags new features with `sprint_number`
- `generatePlanFromSelectedFeatures` propagates `sprint_number` to
  generated tasks
- UI groups features and tasks by sprint (`groupBySprint` in
  `ui/src/projects.ts`); decompose button text reflects iteration
  state ("AI 拆解功能 →" first time, "AI 拆解 → Sprint N+1 →" after)
- Bulk status updates (`handleProjectTaskBulkStatus`, PR #73)

**Open issues** (small):
- No way to *delete* a sprint that was decomposed by mistake — only
  cancel each task individually
- Re-running decompose on the same set of features creates a *new*
  sprint instead of updating the existing one (intentional, but
  worth surfacing in UI as "this will create Sprint N+1")

**Estimate**: 0.5 wk if/when the small gaps come up in real use.

---

## Stage 3 — Agent auto start

**Goal.** "Click button → polar-agent on appropriate host starts
running this project's bot." Without manual `polar-agent attach`
incantation per task.

**Current state**: 🟡 partial.
- Manual: operator runs `polar-agent attach --bot=... --tool=...`
  on their own machine, or uses `scripts/start_agents.sh` for tmux
  farm
- Server has dispatch endpoint that queues the task; if no agent
  is attached, returns 503
- Designs already on file:
  - [`doc/agent-container-design.md`](agent-container-design.md) — Linux Docker image variants
  - same doc §"macOS runtime variants" — Apple Silicon (bare-metal + tart)
  - FUTURE_WORK §"polar-agent Auto-Provision + Cross-Machine Deploy"
    — install script, enrollment token, multi-machine attach manifest

**Gap & design** (specific to project pipeline):
- Per-project preferred host: project row gets a
  `preferred_agent_pool` (e.g. `linux-x86`, `mac-mini-1`). Dispatch
  picks the matching pool first.
- "Wake on dispatch": if no agent in the pool is attached but a
  host is registered (e.g. a Mac mini in the closet with our
  launchd plist), send a wake event (SSH / push-notification /
  HTTPS GET) to provision the agent on demand.
- "Project workspace pre-warm": when project is created, the
  workdir for each tool (kimi/claude/codex) is git-init'd on the
  preferred host so the first task doesn't pay the
  clone-from-template cost.

**Dependency**: requires the FUTURE_WORK entries above to be at
least at #1 (install script + enrollment token).

**Estimate**: 1–2 wk on top of the existing auto-provision work.

**Trigger**: first time someone says "the project page should just
work without me thinking about which laptop has polar-agent running."

---

## Stage 4 — Coding (task pickup loop)

**Goal.** A queued task's content is given to the local coder
tool; output flows back as the bot reply; status updates from
queued → in-progress → finished.

**Current state**: ✅ done.
- Task pickup → `WorkdirSubpath: project.ID`, dispatch to attached
  passthrough agent
- `generateReplyWithPassthrough` in
  `internal/app/dock/ai_agent_passthrough.go` handles success,
  partial-output-on-timeout, stderr surface, disconnect
- `cmd/polar-agent/tools.go` knows kimi / claude / codex (PR #72
  fixed the `--cd VALUE` argv split)

**Open issues** (small):
- 2-hour platform timeout is platform-side; the local tool may
  still be running. Today we surface stderr + partial stdout, but
  there's no "resume from where it stopped" affordance.
- No per-task structured log (token count, runtime, exit code,
  partial vs clean) — covered loosely by chat history but not
  queryable.

---

## Stage 5 — Push code

**Goal.** Whatever the coder tool wrote in the workdir gets to a
git remote that humans (and the next CI step) can see.

**Current state**: ❌ not started. Coder output sits in the local
workdir; nothing pushes it anywhere.

**Three options previously discussed** (no decision):

- **A. polar-agent manages git.** Before each task: `git pull` in
  workdir. After each task: detect changed files,
  `git add -A && git commit -m "[task <id>] <task title>"`,
  `git push`. The bot reply embeds the commit SHA.
  - Pro: works regardless of which coder tool is in use
  - Con: noisy commits if the tool itself does mid-task commits;
    polar-agent has to know remote URL + creds per project
- **B. coder tool manages git.** Pass the project remote to the
  tool's prompt and let it decide when to commit. claude/codex are
  already capable of this with the right system prompt.
  - Pro: tool can write meaningful messages, batch logically
    related changes
  - Con: silent failure if the tool forgets, hard to enforce a
    consistent commit/push contract
- **C. Hybrid + safety net.** Coder tool commits as it sees fit
  (option B), but polar-agent runs a post-task `git status` check;
  if there are unstaged changes, it bundles them into a single
  "task tail" commit so nothing is lost.
  - Pro: best of both
  - Con: more moving parts; need clear convention on which commits
    are "tool-generated" vs "tail"

**Recommendation**: ship C. Reuses A's safety net but doesn't
fight against a tool that already tries to commit. Bot reply
shows the *list* of commits made during the task with their SHAs.

**Auth**: per-project deploy key or fine-grained PAT stored in
`projects.git_credential_ref`, *never* in chat content. Server
holds the credential; polar-agent retrieves it on dispatch and
keeps it in process memory.

**Estimate**: 1.5 wk (option C + auth + UI hooks for commit list).

**Trigger**: first time someone wants to look at *what* a task
actually changed, not just the chat reply. Likely soon.

---

## Stage 6 — CI/CD

**Goal.** Pushed code gets built and tested; the project page
shows the latest CI status per task / per sprint.

**Current state**: ❌ not started. Polar's own repo has GitHub
Actions for releases, but the *projects* the platform manages have
no CI plumbing.

**Design — minimum viable**:
- Project row gets `ci_provider` (none / github_actions / gitlab_ci
  / custom_webhook) and `ci_repo_url`.
- After Stage 5 push, server starts polling the CI status for the
  pushed branch (or subscribes via webhook if the provider supports
  it). Result attaches to the task: `task.ci_status`,
  `task.ci_run_url`, `task.ci_logs_url`.
- Project UI per-task row gets a status pill: 🟡 building /
  ✅ pass / ❌ fail (with link).

**Design — bigger ambitions** (not part of v1):
- Polar-managed CI runner: the same polar-agent host that did the
  coding can also run the build, since it already has the toolchain
  installed. This collapses "agent" + "CI" into one box. Cheap for
  small teams, doesn't scale to public CI.
- Self-host build cache (sccache / Bazel remote cache) shared by
  all projects on the same host.

**Estimate** (minimum viable): 1 wk for GitHub Actions + status
poll, 2 wk if including GitLab and a generic webhook variant.

**Trigger**: first project where "did the change actually compile"
matters more than "did the LLM produce plausible code." For iOS
builds (Stage 5 push triggering Xcode build on the Mac runtime)
this is roughly day-one of real use.

---

## Stage 7 — Publish build result

**Goal.** The artifact produced by CI lands somewhere a human can
download / install / link to.

**Current state**: ❌ not started for projects. Polar itself has
release artifacts; managed projects have none.

**Design**:
- Per project type, define what "the artifact" is:
  - **iOS app**: signed `.ipa`, plus an OTA install URL (reuse the
    existing `iosdist` module — it already does ASC upload + OTA
    plist serving)
  - **Web app**: built `dist/` directory, deployed to a sub-path
    (`https://polar.example.com/projects/<id>/preview/`)
  - **CLI tool**: tarball with all platform binaries, attached to a
    GitHub Release
  - **Library**: published to npm / pypi / cargo (later — needs
    secret management)
- After Stage 6 success, the build job uploads the artifact to a
  fixed conventional path (or invokes `iosdist` upload for iOS),
  and the platform records `task.artifact_url`,
  `task.artifact_kind`, `task.artifact_size`.
- Project page gets a new "Builds" tab: list of recent successful
  builds with download / install button + which sprint / task
  produced them.

**Reuse**: iosdist module is already production for iOS path —
this is "just" routing the CI output into it. Sprints + tasks
already track sprint_number, so per-sprint build history is free.

**Estimate**: 1 wk for the iOS path (it leans on existing iosdist),
2 wk if including web + tarball paths.

**Trigger**: first time someone needs the build artifact off the
Mac mini they ran the task on. For iOS, that's first day of real
use because the build has to leave the Mac to be installed on a
phone.

---

## Cross-cutting concerns

These touch every stage:

### Per-stage LLM selection

Each stage has different capability requirements; mixing the
wrong LLM at the wrong stage is the single most common way to
burn tokens for nothing. Today the project page lets the owner
pick a bot + LLM config for the *decompose* step (Stage 2). The
pipeline as a whole needs the same per-stage control:

| Stage | Capability needed | Reasonable choice |
|---|---|---|
| 1 — review (text idea) | language, cheap | small/cheap LLM (haiku, gpt-4o-mini) |
| 1 — review (design 拆稿) | **vision** | Claude with vision; gpt-4-vision |
| 1 — review (PDF heavy) | document understanding | Claude / GPT-4 with the PDF as input |
| 2 — split features | reasoning, structured output | flagship coding LLM |
| 4 — coding | tool-using, codebase understanding | local kimi/claude/codex CLI (already chosen per bot) |
| 6 — CI failure analysis | reasoning over logs | flagship; cheap on retries |
| 7 — release notes / changelog | summarization | small/cheap LLM |

Implementation note: design 稿 → markdown 用 Claude vision 一次
后，下游 stages 的 LLM 不需要 vision 了，可以选更便宜的。这是
*per-stage* control 真正省钱的地方——不是「整个项目用一个 LLM」，
而是「每个阶段挑性价比最高的那一个」，并且把跨阶段的视觉/文档
理解结果固化成 `summary_md` / `decompose_prompt` 等中间产物，
后续步骤复用而不重算。

**Capability is per-bot, not per-agent.** An agent host attaches
1-N bots, and the bots can be on completely different tools
(claude / codex / kimi) with different vision support. The
pipeline must *not* dispatch a vision task to a bot whose tool
can't see images — that produces silent garbage, not a useful
fallback. Instead:

- The vision LLM (Claude vision is the working default) is a
  *separate slot* on the project, not a bot. It runs once,
  produces `summary_md`, caches it.
- `bot_users` table gets a `capabilities` JSON column tracking
  what each bot's tool supports (`{vision: true|false|"unknown"}`).
  Server checks this before routing — if a task is image-heavy
  and the assigned bot has no vision, server runs the vision
  pre-processor first and hands the bot the `summary_md`.
- Initial `capabilities` values come from a one-time bake-off
  (see capability matrix in Stage 1 sub-concern §4 above).
  Marked `"unknown"` until then; default routing assumes no
  vision so we never blindly pass design files to a tool that
  can't read them.

UI implication: project settings should expose more than one LLM
choice — at minimum a "vision LLM" slot for attachment
pre-processing, plus the existing per-decompose LLM config.
Sensible defaults: vision = the workspace's vision-capable
config if any; everything else = the workspace default.

Schema implication: project row gets `vision_llm_config_id` (and
later, `summarization_llm_config_id`). All nullable, all
falling back to workspace defaults.

**Estimate**: 0.5 wk to add the slots + UI + plumbing; +0.5 wk
for `bot_users.capabilities` column + capability-aware routing
+ the small bake-off to fill in initial values; the actual
benefit is realized as Stages 1, 6, 7 land and start needing
their own LLM choice.

### Auth & credential lifecycle
- Project-scoped: git deploy key, CI provider token, signing
  identity (for iOS), npm/pypi token (for libraries).
- Stored on server side (encrypted at rest), never in chat content.
- Rotated independently — UI for rotation per credential.
- polar-agent fetches on dispatch; never persists to disk on host.

### Audit & observability
- Per-task structured log: `{stage, started_at, ended_at,
  exit_code, llm_tokens, ci_run_id, artifact_url}`.
- Project page shows total cost per sprint (LLM tokens × price +
  CI minutes × price), so the owner sees ROI.
- Stage 5–7 events get their own status pill on the task row, not
  just the chat reply.

### Failure & retry semantics
- Per-stage retry button on the task UI. Re-running Stage 5 (push)
  shouldn't re-run Stage 4 (coding). Stage 6 should be re-runnable
  without re-coding.
- Idempotency keys on each cross-stage handoff so a retry of the
  whole task doesn't double-commit / double-build.

---

## Suggested ship order

```
done  →  Stage 2 (split) + Stage 4 (coding)
next  →  Stage 5 (push) — option C, ~1.5 wk
+1    →  Stage 1 (review) — preview endpoint, 0.5 wk
+2    →  Stage 6 (CI/CD) — GitHub Actions only, 1 wk
+3    →  Stage 7 (publish) — iOS path via iosdist, 1 wk
+4    →  Stage 3 (agent auto start enhancements) — 1-2 wk
later →  Stage 1 reviewer role + Stage 6 multi-provider +
         Stage 7 web/tarball paths
```

Total to "end-to-end usable for one iOS project": ~5 engineer-weeks
spread over 5 stages. None of it should land before the trigger
condition for that stage actually shows up — premature stages
become dead code.

## Trigger conditions (when to start each stage)

| Stage | Start when | Why wait |
|---|---|---|
| 5 — push | Now-ish; first task whose output someone wants to inspect | Output already lands in workdir — manually push works for week-1 |
| 1 — review | First decompose produces obvious slop | Reviewer role over-engineered if owners are also dev |
| 6 — CI | First iOS project (build correctness > LLM plausibility) | Github actions integration is real maintenance burden |
| 7 — publish | Same as CI — iOS needs phone-side install | Web preview is nice-to-have but not blocking |
| 3 — auto-start | First time "which laptop has agent" friction blocks owner | Existing tmux farm + manual attach handles 1-3 person team |

## Out of scope (consciously)

- **Multi-tenant project isolation.** Today projects are
  workspace-scoped; that's enough. Cross-workspace project sharing
  is a bigger story that doesn't fit in this pipeline.
- **Auto-merge / PR automation.** Stage 5 lands code on a branch.
  Whether that branch becomes a PR, gets auto-merged, etc. is a
  policy on top of this pipeline, not part of it.
- **Cost guardrails / billing.** LLM tokens + CI minutes need
  budget caps eventually but they don't change the pipeline shape.
