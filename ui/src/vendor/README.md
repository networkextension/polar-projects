# Vendored modules

These are snapshots from polar-dock's ui/src/ as of 2026-05-23. They cover
cross-plugin helpers projects.ts depends on (dashboard / iosdist / chat).

Resync manually when the underlying APIs change. v0.2 of
@networkextension/polar-ui-common may absorb api/dashboard if more
plugins start consuming it; for now projects is the only one.

Files:
- dashboard.ts        — api/dashboard.ts (fetchAvailableLLMConfigs, fetchBotUsers)
- iosdist.ts          — api/iosdist.ts (fetchIOSApps)
- dashboard-types.ts  — types/dashboard.ts (BotUser etc.)
- chat-types.ts       — types/chat.ts (ChatLLMConfig etc.)
- iosdist-types.ts    — types/iosdist.ts (IOSApp etc.)
