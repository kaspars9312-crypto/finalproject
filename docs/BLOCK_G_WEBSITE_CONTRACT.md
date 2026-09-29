# Block G implementation and review report

## Scope, baseline and repository state

Only Block G from `D:/CODEX_BLOCK_G_WEBSITE_MANAGER_DECISIONS.md` is implemented.
The complete supplied document and prerequisite Block B–F contracts were read.
Current migrations, operations, read layer, Telegram/Sheets adapters, page/actions,
relevant tests, and installed Next.js forms/Server Actions guidance were inspected.
The document is scope authority because the user's request explicitly invokes it;
historical assignment setup/deployment instructions are not current authorization.

Baseline HEAD: `590b3a4acdca28c7ae4dd3f8d3f249440d42d026`, following `163aee0`.
Initial `git status --short`: five untracked Block A–E review ZIPs only. No local
secrets or ZIPs are tracked; `.env.local` is ignored and untouched. No commit,
staging, production mutation, migration application, deployment or cleanup occurred.
The practice transaction `QA_TELEGRAM_SALE_001` is untouched. No Block H work.

Frozen migrations, domain implementation/tests, Block D operations, Block E bot,
Block F read/Sheets implementation and diagnostics, and B–F contracts have no diff.
Existing tests are preserved unchanged. HEAD remains the baseline. Final changes
are the files below plus the five pre-existing untracked ZIPs; staged diff is empty.

## Files

Modified:

- `README.md`
- `src/app/page.tsx`
- `src/app/globals.css`

Created:

- `src/app/action-form.tsx`
- `src/app/workflow-action.ts`
- `src/app/workflow.tsx`
- `src/server/website/execute.ts`
- `src/server/website/execute.test.ts`
- `src/server/website/read.ts`
- `src/server/website/read.test.ts`
- `src/server/telegram/decisions.ts`
- `src/server/telegram/decisions.test.ts`
- `supabase/migrations/20260929000000_website_decisions.sql`
- `supabase/tests/block_g_website_decisions.sql`
- `docs/BLOCK_G_WEBSITE_CONTRACT.md`

No dependency, lockfile, secret configuration, frozen RPC or browser grant changes.

## Website and authorization

The existing Demonstration role selector and transaction cards remain. The added
workflow has sale entry only for stored active SALESPERSON, expense entry only for
stored active EXPENSE_REPORTER, and manager queues/setup only for stored MANAGER.
If the new workflow read is unavailable, existing Block F records remain readable
and the page explicitly reports that entry/manager controls are unavailable.

Sale fields: unique reference, customer, A/B project, description, positive euros
with at most two decimals, and three named proposed percentage shares. Expense
fields: reference, description, positive euros, Materials/Travel/Other category,
and A/B/Company overhead proposal. Labels are English and associated with controls;
forms disable while submitting and show accessible server validation/status text.

The browser sends only an employee ID as demonstration selection, never trusted
role or submitter identity. The server resolves it with the existing authorized
read, checks the stored active role, whitelists form fields, then calls the frozen
operation. Every mutating RPC independently rechecks and locks the stored role at
commit, protecting against preflight races. Repeated actor fields fail closed.
Direct requests by non-managers are denied, regardless of hidden controls or a
spoofed role string. The fictional selector intentionally permits choosing Svetlana;
this is not authentication between real users.

Money parsing reuses Block E's exact euro parser. Creation/split validation and
commission calculation reuse Blocks C/D. A successful receipt precedes integration
work. Sales start pending with zero earned commission. A/B expenses await allocation;
overhead is allocated automatically, with no later decision notification.

## Manager decisions

Pending-sale cards show the submitter, current full record, proposed shares,
Sheets/decision states, and an expandable immutable original proposal. A correction
form changes only customer, project, description and amount through
`correct_pending_sale`. It cannot modify reference, original proposal, submitter,
or proposed shares. Saving corrections leaves the sale pending and refreshes its
revision. No manager split draft is persisted, matching the frozen D contract.

Separate approval controls either approve the saved proposed split unchanged or
supply a validated final split to the existing `approveSale` adapter. The adapter
uses the current amount and frozen commission implementation; `approve_sale`
atomically checks status/revision and saves commissions/audit/delivery intent.
Approved rows have no edit operation. Leaving pending requires no action.

Awaiting-expense cards show reporter, description, category, amount, original
allocation and status. Final allocation defaults to the proposal and allows A, B,
or Company overhead through `allocate_expense`. It updates the same row without
changing amount or proposal. Automatic overhead has no allocation control.

Unique references and locked status/revision CAS remain the database authority.
Stale correction/approval/allocation requests return a reload error and trigger no
integration. A repeated approval/allocation cannot add another financial effect.

## Post-commit Sheets and decision delivery

After each successful website create, correction, approval or allocation, the
existing `syncTransactionToSheets(existingId)` runs. Its revision-aware ownership,
exact reference upsert, RAW values and safe diagnostics are unchanged. Corrections
and decisions update the same reference row. Failed sync leaves finance saved and
the existing manager Sheets retry available. Sheets retry never repeats finance.

After approval/allocation, Sheets and Telegram attempts run independently with
`Promise.allSettled`. Neither failure rolls back finance or suppresses the other
integration. Website entry requires no initial Telegram confirmation.

Sale decision text contains reference, sale amount, stored total commission pool,
all three final percentages and stored euro commissions. Changed splits use an
explicit uppercase change notice and individual proposed → final percentages.
Numerically equivalent decimal spellings do not falsely report a change. Exactly
one recipient is used: the submitting salesperson, not all commission recipients.

Expense decision text contains reference, amount, description and final allocation.
A changed allocation explicitly shows proposed → final; an unchanged proposal is
confirmed. The reporter alone receives it. Auto-overhead is NOT_REQUIRED.

Recipient selection remains in frozen D's decision transaction:

- TELEGRAM uses immutable `origin_telegram_chat_id` despite later remaps.
- WEBSITE uses the submitter's linked private chat available at decision time.
- No decision-time link records NO_RECIPIENT and displays exactly
  `No Telegram recipient linked`.

D freezes the target at the decision commit, before even the first delivery claim.
This stronger existing freeze is preserved. Claims/retries never consult current
links and never rerun approval/allocation. A link added after NO_RECIPIENT does not
silently redirect that decision; no late-recipient recovery policy is invented.

## Additive migration and retry safety

One new migration adds `decision_delivery_token uuid` and
`decision_delivery_started_at timestamptz`, both nullable. Existing notification
status, target, error and sent-time columns are reused. Three new RPCs:

| RPC | Behavior |
| --- | --- |
| `read_website_workflow(uuid)` | Resolves active actor; own/all record visibility; original business proposals and safe delivery state; exact Telegram user IDs and link status for manager only. No target, token or raw delivery error is exposed to the UI. |
| `begin_decision_delivery(uuid,uuid)` | Requires active stored manager, locks transaction, returns no-op for SENT/NOT_REQUIRED/NO_RECIPIENT, BUSY for owned attempts, otherwise claims PENDING/FAILED and returns exact persisted decision/target. |
| `finish_decision_delivery(uuid,uuid,text)` | Checks ownership under row lock, records SENT/FAILED/PENDING, clears token/start timestamp; writes a fixed error on FAILED. Never changes finance, target, business revision, proposal or Sheets. |

All are SECURITY INVOKER, `search_path=pg_catalog`, schema-qualified, execution
revoked from PUBLIC/anon/authenticated and granted only to service_role (plus owner).
No RLS policy or browser privilege is added. The new read RPC is necessary to inspect
original proposals and exact manager links without replacing the frozen F projection.

The sender uses the existing five-second Telegram client. SENT is tracked only
after `sendMessage` returns success. Failure stores a fixed safe error and enables
manager retry. A successful send followed by failed tracking stays PENDING rather
than falsely reporting SENT or downgrading to FAILED. The claim prevents concurrent
senders; a stale/wrong token cannot finish or downgrade a later attempt.

Claims do not expire automatically. An interrupted invocation or failed finish
can strand PENDING/BUSY. Operator recovery: establish that the owner invocation and
its outstanding Telegram request have stopped; inspect the delivery outcome; use
`finish_decision_delivery` with the exact saved token and justified outcome. If the
outcome is unknown, releasing to PENDING permits a manual retry but can duplicate a
message. Never release merely because the timestamp is old. There is no lock-breaking
browser action, worker, external queue or Redis.

## Telegram-link setup

Svetlana sees current user IDs, fictional employee names and whether a private chat
is known. A form accepts a positive exact Telegram user ID and one of five employees.
It invokes the frozen `telegram_set_link` through the existing manager adapter.
One-to-one remapping/session cleanup and preservation of known `/start` private chat
remain Block E's behavior. Historical submitters, proposals and origin/decision
targets never change. Bot users still have no self-assignment command.

## Verification, deferred work and risks

- `pnpm test`: PASS, **454 tests in 15 files**. All previous tests preserved; three
  added suites cover website orchestration, workflow rendering/visibility and decision
  messages/delivery. DB/RPC, Google and Telegram network boundaries are mocked.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, zero warnings.
- `pnpm build`: PASS; dynamic `/` and webhook retained.
- `node scripts/check-client-secrets.mjs`: PASS, 11 browser assets, no private
  environment names or locally configured values. No secret values were printed.
- `git diff --check`: PASS. Staged and frozen-path diffs empty.
- Windows sandbox spawn EPERM required authorized execution outside the sandbox
  for tests/build. No application workaround was introduced.

SQL QA is supplied, statically reviewed, **not executed**. It covers all new RPC
ACLs/search paths, exact IDs/amounts, original/proposal preservation, real frozen
Telegram wizard creation, pre/post-decision remaps, frozen retry targets, website
decision-time linking and NO_RECIPIENT, ownership/BUSY/stale tokens, metadata-only
finish, non-manager/inactive/null actor denials, original/other/overhead allocations,
double-decision denial, own/all reads and hidden private metadata. Every application
mutation is inside BEGIN/ROLLBACK. Only temporary prestate is committed; afterward,
the script verifies restoration of all five application tables. Run the whole file
in one dedicated connection with unrelated writes paused after review.

No local psql/Supabase CLI was available. Actual PostgreSQL execution, simultaneous
connections, PostgREST wire behavior, deployment, browser interaction against the
deployed app, real Google/Telegram delivery and the full live workflow remain
unverified here. The user's supplied Block F live status was not independently
rerun. Unit contract doubles do not constitute database concurrency verification.

Other known limits: intentionally unauthenticated demonstration identities;
non-expiring ownership recovery; uncertain external timeout outcomes (Telegram has
no sendMessage idempotency key); inherited Sheets read/write race with manual row
editing; small-dataset full reads; long user text may exceed Telegram's message
limit and correctly leave a failed delivery. Financial idempotency is enforced
independently of possible duplicate external notifications after ambiguous failures.

Deferred: migration application/SQL QA execution, Vercel deployment and manual Block G
live checks; test cleanup; official assignment fixtures; Block H dashboard; full
authentication; workers/queues; bidirectional Sheets writes. No production record,
link, Google Sheet, Telegram message or practice transaction was changed.

## Acceptance review

PASS below means implemented and review-ready with local checks/static SQL review;
it is not a claim of live migration/integration verification.

| # | Criterion | Review |
| --- | --- | --- |
| 1 | Frozen migrations/domain operations unchanged | PASS — empty frozen diff. |
| 2 | Block F functionality preserved | PASS — unchanged sync/read/bot pipeline and existing tests. |
| 3 | Authorized salesperson sale form | PASS — role-gated form and server authorization. |
| 4 | Authorized expense form | PASS — Kevin/stored expense role only. |
| 5 | Server permissions on creates/manager actions | PASS — stored preflight plus atomic RPC role checks. |
| 6 | Existing authoritative create operations | PASS — frozen D adapters only. |
| 7 | Post-commit creation Sheets sync | PASS — receipt precedes sync. |
| 8 | Manager pending-sale controls | PASS — distinct queue. |
| 9 | Preserve/change split before approval | PASS — unchanged or validated override. |
| 10 | Frozen pending correction semantics | PASS — four supported current fields only. |
| 11 | Atomic/idempotent approval | PASS — existing locked revision/status CAS. |
| 12 | Awaiting-expense controls | PASS — proposal/default/final choice. |
| 13 | Allocation cannot double-deduct | PASS — same frozen row update, amount unchanged. |
| 14 | Original proposals preserved | PASS — immutable inputs never overwritten. |
| 15 | Approval updates same Sheets row | PASS — existing reference upsert, tested. |
| 16 | Allocation updates same Sheets row | PASS — existing reference upsert, tested. |
| 17 | Sheets failure leaves decision saved | PASS — independent post-commit attempt. |
| 18 | Approval attempts decision notification | PASS — post-commit delivery. |
| 19 | Allocation attempts decision notification | PASS — post-commit delivery. |
| 20 | Telegram uses immutable original chat | PASS — frozen D target, claim consistency check, SQL QA. |
| 21 | Website uses decision-time link | PASS — unchanged frozen D lookup, SQL QA. |
| 22 | Exact no-recipient text | PASS — shared constant and UI tests. |
| 23 | Frozen retry target | PASS — claim never re-resolves links. |
| 24 | Telegram failure leaves decision saved | PASS — delivery metadata only. |
| 25 | Manager retry without finance replay | PASS — isolated begin/send/finish path. |
| 26 | Complete sale decision message | PASS — all persisted percentages/euros, pool, change notice. |
| 27 | Complete expense decision message | PASS — description/amount/allocation/change notice. |
| 28 | Authorized manager link setup | PASS — frozen manager RPC. |
| 29 | Remaps preserve history/destination | PASS — unchanged E/D logic, rollback-safe SQL QA. |
| 30 | No full dashboard | PASS — forms, queues, records and delivery only. |
| 31 | No hardcoded official fixtures | PASS — no new application fixture/reference special cases. |
| 32 | No exposed secrets | PASS — server-only imports, safe errors, built-asset scan. |
| 33 | Four quality gates | PASS — 454 tests, typecheck, lint, build. |

BLOCK G READY FOR REVIEW
