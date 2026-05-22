# polar-projects — Project management plugin

AI-driven product workflow plugin for the [Polar](https://github.com/networkextension/Polar) platform.

Tracks projects per workspace, decomposes product ideas into features and tasks via LLM, hands tasks off to bot users + their attached `polar-agent` for coding, and optionally binds each project to an iosdist app for build → TestFlight handoff.

## Status

W4 extraction at 2026-05-22; pre-cutover. Dock still serves `/api/projects/*` until ops flips `POLAR_PROJECTS_REMOTE=true`.

A handful of cross-domain calls are stubbed in this extraction (synchronous LLM dispatch, chat/llm-thread persistence, prompt-template DB rows, iosdist app lookup). Stubs log a `TODO(extract)` line + degrade gracefully (decompose returns "not yet wired", pickup proceeds without chat persistence). The follow-up PR will either vendor those helpers or add SDK surfaces in `polar-sdk`.

## Install

```bash
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o /tmp/projects-svc ./cmd/projects-svc
rsync -avz /tmp/projects-svc local@<deploy-box>:/Users/local/.local/bin/
```

Environment:
- `POLAR_DOCK_URL` (or `POLAR_DOCK_BASE`)
- `POLAR_PLUGIN_TOKEN`
- `POLAR_PROJECTS_DB_DSN` (Postgres for `polar_projects`)
- `POLAR_PROJECTS_LISTEN` (default `127.0.0.1:8096`)
- `POLAR_PROJECTS_BLOB_DIR` (research-mode artifacts + generated docs)

## Endpoints

All routes require an authenticated user; workspace scoping is enforced inside each handler.

- `GET / POST /api/projects`
- `GET / PUT / DELETE /api/projects/:id`
- `POST /api/projects/:id/decompose`
- `PUT / DELETE /api/projects/:id/features/:feature_id`
- `POST /api/projects/:id/plan`
- `PUT /api/projects/:id/tasks/:task_id`
- `POST /api/projects/:id/tasks/:task_id/pickup`
- `POST /api/projects/:id/tasks/bulk-status`

## Related

- [Polar dock](https://github.com/networkextension/Polar)
- [polar-sdk](https://github.com/networkextension/polar-sdk)
- [polar-packtunnel](https://github.com/networkextension/polar-packtunnel)
- [polar-wg](https://github.com/networkextension/polar-wg)

## License

MIT
