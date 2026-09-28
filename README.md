# Friends Included / Wedding Guests for Hire

Block A provides a minimal Next.js application using TypeScript and the App Router.
Block B adds the Supabase schema migration and five fictional employee seed rows.
Block C adds pure domain calculations, validation, permission decisions and unit tests.
Block D adds server-only website persistence and atomic manager-decision RPCs.
The website remains the foundation page, without transaction data or business UI.

## Requirements and scope

- `docs/ORIGINAL_ASSIGNMENT.md` is the authoritative assignment.
- `docs/PROJECT_SPEC.md` is the frozen implementation architecture; the original assignment wins in a conflict.
- `CODEX_BLOCK_A_FOUNDATION.md` defines the original foundation scope and acceptance criteria.
- Original Markdown and DOCX source documents are preserved unchanged in `docs/`.

The foundation, schema, pure domain layer and Block D operations are implemented. See the [Block B schema contract](docs/BLOCK_B_SCHEMA_CONTRACT.md), [Block C domain contract](docs/BLOCK_C_DOMAIN_CONTRACT.md), and [Block D operation contract](docs/BLOCK_D_OPERATIONS_CONTRACT.md). Block D stops at review: UI, API routes, Telegram flows, external delivery and Block E remain unimplemented.

## Local setup

Use Node.js 24 LTS and pnpm 11.25.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. The page shows the project name, "Foundation ready", and "No production/business data yet".

## Environment and server boundary

Copy `.env.example` to `.env.local` when preparing server-side Supabase access:

```powershell
Copy-Item .env.example .env.local
```

On macOS/Linux, use `cp .env.example .env.local`.

The example contains names with empty values only:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project API URL, read by server code. |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Supabase service-role key, read only by server code. |

The landing page and build work without credentials. The factory in `src/lib/supabase/server.ts` validates the environment only when an operation is called; the foundation page does not connect to a database. Block B was runtime-validated externally according to the supplied Block D prompt. Apply the new Block D migration separately before using `src/server/operations/transactions.ts`. This workspace has not applied or runtime-verified Block D against Supabase. The five original tables and their RLS remain unchanged; the new RPCs allow service-role execution only.

The module imports `server-only`, so Next.js rejects importing it into a Client Component. Future browser components must call server endpoints/actions rather than import the privileged client. The client does not persist or refresh user sessions. Never prefix private credentials with `NEXT_PUBLIC_`, return them to the browser, or commit them. Actual `.env*` files are ignored; `.env.example` remains trackable. No Telegram or Google credentials are needed in Block A.

## Developer checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm start
```

Typecheck generates Next.js route types before running TypeScript, including on a fresh checkout. Lint runs ESLint separately from the production build. `pnpm start` serves the production build on port 3000. Generated `.next/`, `next-env.d.ts`, and TypeScript build information are ignored.

`pnpm test` runs domain and mocked operation tests once with Vitest in Node; `pnpm test:watch` watches for changes. Tests need no network or credentials and never call Supabase, Telegram or Google Sheets. The separate rollback-safe `supabase/tests/block_d_atomic_operations.sql` validates database behavior when run on the authorized Supabase project after migration; unit mocks do not prove PostgreSQL concurrency.

Tooling note: ESLint 9.39.5 is deprecated upstream, but is compatible with all plugins in this Next.js ESLint configuration; ESLint 10 currently produces peer dependency conflicts. `pnpm-workspace.yaml` explicitly permits the native resolver's installation script. Next.js generates `AGENTS.md` and `CLAUDE.md` on the first development run; these guidance files are included in the repository.

## Vercel readiness

Use Vercel's Next.js framework preset, repository root as the project root, Node.js 24.x, install command `pnpm install --frozen-lockfile`, and build command `pnpm build`. Keep the default Next.js output directory. Configure future Supabase values as server-side environment variables in Vercel. Block A needs no secrets and does not perform a deployment.

Foundation setup follows the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation) and [Supabase JavaScript client documentation](https://supabase.com/docs/reference/javascript/initializing).
