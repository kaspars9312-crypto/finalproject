# Block F — vertical slice implementation and review report

## Scope and baseline

Authority: `D:/CODEX_BLOCK_F_VERTICAL_SLICE_SHEETS.md`, read completely before changes,
with the original assignment, frozen architecture, B/C/D/E contracts, current
migrations, SQL QA, domain/operation/Telegram tests, server operations, bot code and
foundation page. Installed Next.js page and Server Actions guides were also read.
The revised block sequence follows the already documented C/D/E scope; no material
business-rule conflict was found. Pending commissions use explicit €0.00, as required
by the original assignment and frozen architecture and allowed by the Block F prompt.

Baseline HEAD: `8058ecf` (`chore: freeze block E telegram ingestion`). Initial state
had a deleted `.env.example` and five untracked A–E review ZIPs. The example was
recreated from HEAD with three additional empty Google names. ZIPs and `.env.local`
remain untouched. No staging, commits, amendments, remote mutation or deployment.
All three frozen migrations and all frozen domain and operation code are unchanged.
The only Block E production change is the requested post-save orchestration hook.

## Files and dependency

Created:

- `src/app/actions.ts`
- `src/server/records/types.ts`, `read.ts`, `read.test.ts`
- `src/server/sheets/client.ts`, `rows.ts`, `sync.ts`
- `src/server/sheets/client.test.ts`, `rows.test.ts`, `sync.test.ts`, `security.test.ts`
- `src/server/sheets/fixtures.test-support.ts` (unit fixtures only; no application imports)
- `src/server/telegram/sheets-post-commit.test.ts`
- `scripts/check-client-secrets.mjs`
- `supabase/migrations/20260928020000_sheets_vertical_slice.sql`
- `supabase/tests/block_f_sheets_sync.sql`
- This report.

Modified: `.env.example`, README, package.json, pnpm-lock.yaml,
`src/app/page.tsx`, `globals.css`, `layout.tsx`,
`src/server/telegram/controller.ts`, and `telegram.test.ts` (one extra mock;
all 259 existing test cases remain intact).

New runtime dependency: `google-auth-library` 11.1.0, with its lockfile transitives.
No Google client framework, worker, queue, ORM or additional direct dependency.

## Database contract

The new migration adds two nullable columns to transactions:

- `sheet_synced_revision integer`, checked between 1 and current business revision.
- `sheet_sync_token uuid`, durable ownership independent of the existing timestamp
  that frozen Block D operations clear when changing business state.

Four new functions are SECURITY INVOKER, use `search_path=pg_catalog`, qualify
application objects and grant EXECUTE only to service_role (plus administrative
owner), revoking PUBLIC/anon/authenticated:

| Function | Purpose |
| --- | --- |
| `sheet_transaction_snapshot(public.transactions)` | Explicit safe projection; exact NUMERIC and BIGINT strings before JSON encoding. |
| `read_visible_transactions(uuid)` | Lock/check active stored actor, filter own/all transactions, return actual role/code/name. |
| `begin_sheet_sync(uuid, uuid DEFAULT NULL)` | Row-lock current transaction, acquire durable ownership, mark PENDING, return current snapshot and token. A supplied retry actor must be active MANAGER. NULL is trusted internal post-commit mode only. |
| `finish_sheet_sync(uuid, uuid, integer, text)` | Check ownership and written revision, finish delivery or return latest snapshot while retaining the token. |

No browser table grants, RLS policies, frozen RPC replacements, financial columns,
business revision increments, external calls inside DB transactions or persistent
fixtures are introduced. A successful sync changes delivery metadata only.

## Website and permissions

The dynamic App Router Server Component uses an ordinary GET form labelled exactly
**Demonstration role**, with five employees loaded from Supabase. Default is the
stored Richard row; an explicit unknown/inactive identity fails closed rather than
falling back to a manager. Repeated/malformed query parameters also fail closed.

The browser supplies an employee UUID, never an authoritative role. SQL reloads and
locks the employee through the read, deriving active status, code and role. Managers
see all rows; other stored roles see only `submitter_employee_id = actor.id`.
The server read layer independently checks the returned actor and filters rows again.
A spoofed `role=MANAGER` query is ignored. As specified, anyone can deliberately select
Svetlana in this fictional demo; this is not authentication between real people.

Responsive transaction cards show all requested sale/expense fields, English statuses,
empty/error states and Sheets state. Money uses BigInt formatting into euros with two
decimals; percentages remain the exact SQL strings. Approved split and individual
commissions come from stored final fields. No financial totals/dashboard are present.

Only a manager sees the Retry Sheets sync form. Its Server Action whitelists employee
and transaction fields, rejects missing/malformed actor UUIDs, and calls begin_sheet_sync
with that actor. The DB checks the stored active MANAGER before even checking the
transaction's sync status. Retries invoke no creation, approval or allocation operation.

## Exact row mappings

Sales (A:Q): Reference; Submission time; Salesperson; Customer; Project; Description;
Amount; Proposed Richard %; Proposed Anastasia %; Proposed Jean-Claude %;
Approved Richard %; Approved Anastasia %; Approved Jean-Claude %;
Richard earned commission; Anastasia earned commission; Jean-Claude earned commission;
Status. Pending final shares are empty, individual earned commissions are €0.00.

Expenses (A:I): Reference; Submission time; Reporter; Description; Category; Amount;
Proposed allocation; Final allocation; Status. Awaiting final allocation is empty.
Category and company-overhead labels are human readable. Both maps are also used by
the read UI, ensuring the same saved values appear on the website and copy.

## Google client and reference upsert

The server-only adapter uses the official service-account JWT client with the Sheets
scope, then direct Sheets REST fetch. Only email, private key and spreadsheet ID are
required. Escaped `\n` becomes a newline. Token exchange and HTTP calls have 5-second
timeouts. Automatic request retries are disabled; no token/key/API error is logged or
returned. Official references: [Google Auth Library](https://github.com/googleapis/google-cloud-node-core/tree/main/packages/google-auth-library),
[Sheets update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update),
[Sheets append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append).

Every attempt reads the current target tab, checks/writes an empty header, searches
column A for the exact case-sensitive reference, updates exactly one matching row,
or appends if absent. Duplicate matches and incompatible nonempty headers fail before
writing. Row numbers are never stored as identity. RAW strings preserve percentage
precision, money formatting and literal references/descriptions beginning with `=`.
The user creates exactly Sales/Expenses tabs during deferred setup; code creates no
spreadsheet or extra tab. Spreadsheet edits never flow back to Supabase.

## Revision serialization, failures and retries

A PostgreSQL row lock serializes token acquisition; the persisted UUID owns the whole
external attempt across stateless RPC calls. A second attempt gets BUSY and does no
Google work. Frozen business operations may advance revision while a write runs,
but cannot clear this ownership token.

After external success, finish_sheet_sync compares the written revision to current
revision. Only equality marks SYNCED and records sheet_synced_revision. A mismatch
returns STALE plus the newest exact snapshot and keeps PENDING with the same token.
The owner writes the newest state again. After three changing revisions it releases
the token with PENDING so a later manual/future post-commit attempt can finish.
Old/wrong tokens cannot complete another attempt. No sync call changes financial state.

Ordinary configuration/Google failures record FAILED with a fixed safe error and
release ownership for manager retry. Failed DB tracking leaves durable PENDING intent;
the application does not claim success it cannot confirm. A retry after a completed
append whose response was lost looks up the reference and updates that same row.

The token deliberately has no automatic expiry. Otherwise an old paused invocation
could resume after a replacement and overwrite a newer row. A killed invocation or
unavailable finish RPC can strand ownership; this is an explicit availability tradeoff
for this small no-worker architecture. The UI reports BUSY, never falsely SYNCED.
Recovery: stop/drain the old invocation and establish that outstanding Google requests
have ended; then, as operator, call finish_sheet_sync for the exact transaction and
stored token with its current revision and outcome PENDING. This only releases delivery
ownership. Svetlana can then retry normally. Never clear a token merely because it is
old or while the old writer may still run. No automatic lock-breaking UI is provided.

Google does not provide atomic compare-and-set reference upserts or idempotency keys
for values.append. A timeout can have an uncertain remote outcome, and human row moves
can race read-then-write. Standard retries converge after the old request completes;
arbitrarily delayed Google operations/manual concurrent edits are not an exactly-once
delivery guarantee. Avoid editing/reordering these copy tabs during sync. Duplicate
references fail visibly for operator cleanup rather than being silently selected.

## Telegram integration

Only the SAVED branch changed. It awaits both independent operations with
Promise.allSettled after the atomic database financial save returns: the reusable
`syncTransactionToSheets(transactionId)` hook, and the existing initial confirmation
plus its tracking RPC. Google failure never undoes the save or blocks confirmation;
confirmation failure never downgrades Sheets. Confirmation tracking errors preserve
Block E's retryable HTTP response after both attempts finish. Duplicate/invalid/denied
or failed saves trigger no Sheets write. No manager decision delivery is implemented.
Future website/manager operations can call this hook after their own commits; their
UI hooks are intentionally not implemented here.

## Verification

All existing tests are preserved. New tests cover every requested Block F topic:
five selector options; all employee visibility cases; spoofed/inactive/unknown actors;
server retry denial; exact sale/expense column order and pending blanks/zeros; exact
money and long percentage strings; header handling; reference update/append/duplicate;
RAW formula safety; lost response retry; safe auth/HTTP/configuration failures;
revision-aware finish, stale resync and bounded churn; BUSY/no-op behavior; no financial
replay; post-commit ordering and independent Telegram/Sheets outcomes; server-only config.

SQL QA commits only temporary prestate, then wraps all application setup in BEGIN /
ROLLBACK and raises named failures. It checks new metadata, grants/search_path,
begin timestamps/revision and exact snapshot, concurrent-attempt rejection, ownership,
same-revision success, stale success after real correction/approval RPCs, latest snapshot,
failure isolation, safe error, retry, old token rejection, pending release, non-manager /
inactive / unknown denial, own/all visibility and private-field omission. After rollback
it compares all five application tables to committed temporary prestate. It performs
no external network calls. This script is provided for manual execution after review;
it has not been executed on PostgreSQL here. No local psql is available.

Build client assets are scanned for private env names and real locally configured
values without printing values. Nine browser assets passed. Build performs no live
read, since the transaction page is dynamic. Windows sandbox process-spawn EPERM
required approved outside-sandbox execution for Vitest and Next build; no application
workaround was added.

Final gates: `pnpm test` PASS — 328 tests in 12 files (259 existing + 69 new);
`pnpm typecheck` PASS; `pnpm lint` PASS with zero warnings; `pnpm build` PASS.
`node scripts/check-client-secrets.mjs` PASS — nine browser assets scanned.
`git diff --check` PASS; staged diff empty; frozen migration diff empty.

## Deferred live validation and risks

No production database, Google Sheet, Telegram account, Vercel environment or deployment
was changed. Not live-verified: new migration/RPC serialization and ACLs, SQL QA,
simultaneous DB connections, real Google auth/writes, the existing practice sale in the
new UI, or the complete deployed Telegram → Supabase → Vercel → Sheets path.
These are the explicitly deferred post-review setup steps, not claimed runtime successes.
The user's supplied Block E live-pass status is retained without re-running those checks.

Other limits: orphaned-token operator recovery, uncertain remote timeouts, concurrent
manual sheet editing, and the intentionally unauthenticated fictional identity selector.
Read and Sheets lookups load the small demonstration dataset in full; no large-scale
pagination/worker infrastructure is added. A request can require three sequential
writes plus token exchange, so deployment duration must accommodate bounded calls.

Intentionally deferred: website entry/correction forms; approval/allocation/setup UI;
full dashboard; manager-decision delivery/retry; Test 1/Test 2 persistent data; full
login; background workers/queues/cron; bidirectional editing; live setup/deployment.
No Block G work is included.

## Acceptance verdict

All 23 Block F implementation acceptance criteria are covered by the code, automated
checks and static review, subject to the explicitly required deferred live validation.
The existing Richard sale is selected by its persisted submitter identity without a
reference/date/source fixture filter, and Svetlana's query includes all transactions.
No claim is made that Google already contains a row or that the live site runs this
uncommitted code. Review readiness is distinct from live milestone sign-off.
