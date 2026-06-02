# Contributing

Thanks for helping improve `mainframe-mcp-server`.

## Workflow

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/add-cics-tools`.
3. Make your changes **with tests**.
4. Run `npm run lint && npm run test` — both must pass.
5. Open a Merge Request with a clear description.

## Project Layout

| Path | Purpose |
|---|---|
| `src/config/` | Env loading + Zod validation. |
| `src/zowe/` | z/OSMF session factory and profile resolution. |
| `src/tools/<group>/` | One folder per tool group; `index.ts` registers them, `shared.ts` holds reusable helpers. |
| `src/utils/` | Logging, error mapping, formatters, abend reference data. |
| `src/types/` | Shared domain and wiring types. |

## Adding a New Tool

1. Create `src/tools/<group>/<tool-name>.ts` exporting a
   `register<Name>Tool: ToolRegistrar`.
2. Define inputs as a Zod raw shape and wrap the handler in `safeHandler` so
   errors map cleanly.
3. Normalize SDK responses into domain types (`src/types/zos.ts`) and format
   output with helpers from `src/utils/formatters.ts`.
4. Register the tool in the group's `index.ts`.
5. Add unit tests under `tests/unit/`.
6. Document it in `docs/tools-reference.md` and the README tool tables.

## Coding Standards

- TypeScript strict mode is on; no `any` without justification.
- Keep the Zowe SDK as the only z/OS connectivity layer — do not hand-roll
  z/OSMF REST calls.
- Tools must be **read-mostly and bounded**: respect the configured limits and
  never return unbounded spool/dataset content.
- Run `npm run format` (Prettier) before committing.

## Testing

- **Unit tests** (`tests/unit/`) must not require a live mainframe; test pure
  helpers and normalizers.
- **Integration tests** (`tests/integration/`) require a live z/OSMF endpoint
  and only run when `RUN_INTEGRATION=1` with valid `ZOSMF_*` env vars.

## Commit Messages

Use conventional, imperative summaries (`feat:`, `fix:`, `docs:`, `refactor:`,
`test:`). Keep changes focused and reviewable.

## Security

Never commit credentials, hostnames, or internal system names. See the
[Security](../README.md#security) section of the README.
