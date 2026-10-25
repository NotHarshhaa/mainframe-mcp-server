# Contributing

Thanks for helping improve `mainframe-mcp-server`. The detailed architecture
and "how to add a tool" walkthrough lives in
[docs/contributing.md](./docs/contributing.md) — start there, then follow the
rules below.

## Quick workflow

1. Fork the repository and create a feature branch:
   `git checkout -b feat/my-change`
2. Install and build: `npm install && npm run build`
3. Make your change **with tests**. Pure logic (normalizers, formatters,
   heuristics, parsers) gets unit tests in `tests/unit/`.
4. Verify locally:

   ```bash
   npm run lint        # ESLint
   npm run typecheck   # tsc --noEmit
   npm test            # unit tests (no mainframe required)
   ```

5. Open a pull request with a clear description of what changed and why.

CI runs lint, typecheck, build, and unit tests on Node 18/20/22 — a pull
request is only reviewable when all four pass. Integration tests
(`npm run test:integration`) require a z/OSMF sandbox and are never required
for a PR.

## Ground rules

- **No credentials in code, tests, or docs.** Ever.
- Keep tool behavior consistent: validate inputs, normalize SDK responses into
  the domain types in `src/types/zos.ts`, cap output with the configured
  limits, and format responses with the shared formatters.
- Every tool registers through `securedHandler` so security gating and audit
  logging apply.
- Update `docs/` and the README tool tables when you add or change a tool.
- The mainframe enforces final authorization — never try to "work around" a
  z/OSMF permission error client-side.
