# Friends Included / Wedding Guests for Hire

Blocks A–G are frozen at `0d28d6b` (Block G website manager decisions).
Block H adds the manager financial dashboard and final submission shell, with
automated official Test 1/Test 2 regression fixtures confined to test code.
Block H is deployed and live-validated. The final release audit and live evidence
are recorded in `docs/RELEASE_FINAL_AUDIT.md` and
`docs/RELEASE_VALIDATION_STATUS.md`.

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
- [Block H dashboard and readiness review](docs/BLOCK_H_DASHBOARD_CONTRACT.md)

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

The following is the original Block F setup guidance. The two named practice
references were later removed through the separately authorized, audited release
cleanup; do not recreate them.

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
git diff --check
```

Unit tests mock DB/RPC and external clients; no real network or credentials are used.
The last check scans built browser assets for private env names and locally configured
values without printing secrets. SQL QA is separate and must be run after review.

## Block G baseline and delivery

The supplied Block H baseline reports the Block G migration applied, SQL QA passed
with all five application tables restored after rollback, and deployment live.
The website sale → Supabase → manager split/approval → same Sheets row → Telegram
decision workflow was live-verified before this block. These checks were not rerun
here. Expense behavior has automated/SQL coverage but was not manually live-tested.

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

## Block H financial dashboard

The dynamic server page uses `readDashboardRecords`, wrapping the existing
`read_visible_transactions` RPC. The RPC resolves the active stored employee and
returns own/all current records; only a stored MANAGER receives dashboard aggregates.
No role string from the browser is trusted. The required demo selector still lets
any visitor deliberately select Svetlana; it is not real-user authentication.

The server maps exact SQL cent strings to checked safe integers and calls the frozen
Block C `aggregateDashboard`. The existing read omits the commission pool, so the
adapter sums stored individual commission cents, whose sum equals the pool by the
database constraint. Block C validates these against the current amount/final split
and its existing rounding rules. No new financial engine, migration, balance table,
client aggregation, cache, or dependency is added.

Project A/B result = approved income − approved commissions − finally allocated
project expenses. Company result = all approved income − commissions − every saved
expense. Pending sales contribute zero; overhead and awaiting expenses affect only
the company until final attribution. Retries change delivery metadata, not finance.
Record cards and dashboard use the same read snapshot. Refresh rereads Supabase;
existing website actions revalidate the page after saves. Changes made elsewhere
appear on refresh. Invalid/unsafe financial data shows an unavailable notice instead
of misleading totals while keeping the existing record view available.

The page shows Student **Kaspars Bickovs**, short usage instructions, and the supplied
[Telegram bot](https://t.me/friends_included_final_bot),
[Google Sheets](https://docs.google.com/spreadsheets/d/1Q8_NLiBBNTiDLmSAhnhs7ddAKkJU8xiHbRyN-CNdTMk/edit), and
[GitHub repository](https://github.com/kaspars9312-crypto/finalproject) links.
No new environment variables are required; production variable names are listed above.

## Final release state

The authorized cleanup, production deployment, Official Test 1, cumulative Official
Test 2, end-to-end Expense workflow, integration retry checks, and signed-out
instructor access verification are complete. The retained final production state is
Project A €2,050.00, Project B €2,180.00, company result €3,930.00, and cumulative
earned commissions of €140.00 / €175.00 / €215.00. S05 remains pending at €600.00
and E07 remains awaiting allocation at €140.00. The release audit records the full
evidence and all 40 acceptance criteria.
