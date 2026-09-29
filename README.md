# Friends Included / Wedding Guests for Hire

Blocks B–F are frozen; the Block G baseline is `590b3a4` (safe Sheets diagnostics).
Block G adds website entry, manager correction/approval/allocation, Telegram link
setup, and decision delivery/retry. These changes are uncommitted for review.
No Block H financial dashboard is implemented.

## Requirements and contracts

`docs/ORIGINAL_ASSIGNMENT.md` is authoritative; `docs/PROJECT_SPEC.md` is the frozen
architecture. The supplied Block F scope follows the revised sequence established
by Blocks C–E. Original documents and earlier migrations remain unchanged.

- [Schema contract](docs/BLOCK_B_SCHEMA_CONTRACT.md)
- [Domain contract](docs/BLOCK_C_DOMAIN_CONTRACT.md)
- [Operation contract](docs/BLOCK_D_OPERATIONS_CONTRACT.md)
- [Telegram contract](docs/BLOCK_E_TELEGRAM_CONTRACT.md)
- [Block F implementation and review report](docs/BLOCK_F_SHEETS_CONTRACT.md)
- [Block G implementation, acceptance review and runtime limits](docs/BLOCK_G_WEBSITE_CONTRACT.md)

## Local development

Use Node.js 24 and pnpm 11.25.0, as pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Select an employee and press **View records**.
Richard is the default selection. Salespeople and Kevin see their own submissions;
Svetlana sees all submissions and can retry pending or failed Sheets syncs.
With the Block G migration applied, salespeople can submit sales and Kevin can
submit expenses. Svetlana can inspect original proposals, save supported pending
sale corrections, approve the proposed or a changed final split, allocate awaiting
expenses, set Telegram links, and retry pending/failed decision deliveries.
This is deliberately fictional demonstration access, not authentication: visitors
can select any of the five identities. A supplied role string never grants access.

The page fetches authoritative records on the server at request time. Missing
configuration, missing migration, and inactive/unknown employees produce a safe
error state. The build itself needs no configured services and does not fetch records.

## Configuration

`.env.example` contains empty names only. Set real values in ignored `.env.local`
or server-side Vercel environment variables. Do not overwrite an existing local
configuration when copying the example.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Server Supabase API URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged database access. |
| `TELEGRAM_BOT_TOKEN` | Bot prompts, submission confirmations and manager decisions. |
| `TELEGRAM_WEBHOOK_SECRET` | Incoming webhook verification. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google service-account identity. |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Private key; escaped newlines are accepted. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Existing spreadsheet shared with that account. |

No private variable has a `NEXT_PUBLIC_` prefix. Never commit credentials, service-account
JSON, local env files, review ZIPs, caches or build output. Server-only modules are
protected by the `server-only` import boundary.

## Historical Block F setup

The supplied Block G baseline reports this milestone live-verified. Retain the
existing practice sale `QA_TELEGRAM_SALE_001`; Block G does not clean it up.

1. Create/select a spreadsheet with exactly **Sales** and **Expenses** tabs. Keep the
   tabs empty or use the exact headers in `src/server/sheets/rows.ts`.
2. Enable the Google Sheets API, create a service account, and share the spreadsheet
   with its email as Editor. Give the instructor Viewer access.
3. Add the three Google environment variables to Vercel.
4. Apply `supabase/migrations/20260928020000_sheets_vertical_slice.sql` after A–E.
5. Run the entire `supabase/tests/block_f_sheets_sync.sql` in one dedicated database
   connection with unrelated writes paused. Its application changes roll back.
6. Redeploy using the existing Vercel connection (Node 24, `pnpm build`).
7. Select Richard and Svetlana to verify the existing practice sale is visible.
   As Svetlana, retry its sync and verify exactly one readable Sales row.
8. Verify a new bot submission automatically synchronizes after its financial save.

No live credentials, spreadsheet, migration application or deployment is created by
Block F automated tests. The live setup above is intentionally not executed here.

## Telegram and sync behavior

`POST /api/telegram/webhook` retains the Block E secret check and private-chat wizard.
Commands are `/start`, `/sale`, `/expense`, `/cancel`. The manager linking backend
remains `setManagerTelegramLink`; Block G exposes it only to the selected active
stored manager through the website. Users must first send `/start` privately.

After a SAVED receipt, Sheets sync and the initial confirmation run independently,
and both attempts are awaited. Sync reads the current DB snapshot, upserts by exact
reference, and rechecks revision after writing. Changed revisions are synchronized
again under the same ownership token, up to three writes per request. Financial
operations and confirmation tracking remain independent from sync metadata.

Ordinary failures show FAILED with a sanitized message; Svetlana can retry the existing
transaction. Duplicate references or incompatible headers in Sheets fail without an
ambiguous write. RAW string values preserve decimal precision and avoid formulas.
Do not rearrange sheet rows during a sync; Sheets edits never update Supabase.

A durable sync token does not expire automatically. A crashed invocation or failed
DB acknowledgement can leave a PENDING/BUSY attempt requiring operator recovery.
Do not clear ownership based only on elapsed time: first establish that the old writer
and any outstanding Google request have ended. See the Block F report for recovery
and external timeout limitations.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node scripts/check-client-secrets.mjs
```

Unit tests mock DB/RPC and external clients; no real network or credentials are used.
The last check scans built browser assets for private env names and locally configured
values without printing secrets. SQL QA is separate and must be run after review.

## Block G review-time setup and delivery

After review, apply `supabase/migrations/20260929000000_website_decisions.sql` and
run `supabase/tests/block_g_website_decisions.sql` in a dedicated connection. The
SQL QA rolls back every application mutation and checks restoration afterward.
Neither step has been run remotely by this implementation.

Every website financial mutation uses the frozen Block D operation, then attempts
the existing Sheets sync after commit. Approval/allocation independently attempts
a Telegram decision to the submitter. Telegram-origin decisions keep the immutable
submission chat; website decisions use the submitter's link at decision time.
Block D freezes that target at commit. Retries never re-resolve it or repeat finance.
No decision-time link displays exactly **No Telegram recipient linked**. A later
link does not silently retarget that decision.

Notification status is separate from finance: PENDING, SENT, FAILED, NO_RECIPIENT,
or NOT_REQUIRED. Pending/failed unclaimed decisions have a manager retry button.
An interrupted claim remains PENDING and requires operator recovery after the old
sender has stopped; see the Block G report. External Telegram delivery cannot be
guaranteed exactly once after an ambiguous network timeout.

Still deferred: migration application, SQL QA execution, deployment and manual
website/Sheets/Telegram checks; Block H dashboard; official Test 1/Test 2 records;
test-data cleanup; full authentication; queues/workers; bidirectional Sheets editing.
