# Block E Telegram ingestion contract

Scope: `D:/CODEX_BLOCK_E_TELEGRAM_INGESTION.md`, read completely along with the original assignment, frozen architecture, B/C/D contracts, existing code, migrations and tests. The supplied scope continues the revised block sequence documented in C/D; no business rule was redesigned. Only Block E is implemented. No Block F work is included.

## Baseline and files

The working tree began at `abec4aa`. Every file present in `Friends_Included_Block_D_Review.zip` matched byte-for-byte except `supabase/tests/block_d_atomic_operations.sql`. That difference was solely the permitted QA-harness repair: committed temporary prestate and named assertion exceptions. Production files matched the review. The seven Block D files were committed as `bccf32a`, `chore: freeze block D atomic operations`, without amending older commits. Review ZIPs remain untouched/untracked. Block E is left uncommitted for review.

New files:

- `src/app/api/telegram/webhook/route.ts`
- `src/server/telegram/types.ts`
- `src/server/telegram/client.ts`
- `src/server/telegram/wizard.ts`
- `src/server/telegram/persistence.ts`
- `src/server/telegram/controller.ts`
- `src/server/telegram/telegram.test.ts`
- `supabase/migrations/20260928010000_telegram_ingestion.sql`
- `supabase/tests/block_e_telegram_ingestion.sql`
- This contract.

Modified: `.env.example` (two empty server-only variables), README (current scope and usage). No dependency changes. A–D production files, original documents, existing migrations, all 197 existing tests and corrected Block D QA remain unchanged from the baseline. Installed Next.js route-handler guides were read before implementing the route.

## RPCs and trust boundary

| RPC | Purpose |
| --- | --- |
| `telegram_read_session(bigint)` | Read a persistent wizard snapshot, encoding IDs as strings. |
| `telegram_apply_update(bigint,bigint,bigint,text,jsonb,text)` | Claim update and perform one command, wizard step or final insert atomically. |
| `telegram_set_link(uuid,bigint,uuid)` | Verify stored manager role and atomically assign a one-to-one link. |
| `telegram_mark_confirmation(uuid,boolean)` | Record initial confirmation outcome after delivery, without changing financial state/revision. |

All four are SECURITY INVOKER with `search_path = pg_catalog`, schema-qualified application relations, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role. No new table, column, policy, trigger, queue or processing-status lifecycle is added. The migration owner retains administrative rights. Server service-role access remains the trusted boundary established in B/D.

`p_command` and normalized `p_value` are server-generated. The bot never supplies an employee identity, authoritative role, complete financial payload or original proposal. The database reads those from the persistent link/session and constructs the original proposal itself. Role checks also require active employees and hold FOR SHARE locks through commit.

## API and webhook

The small `server-only` Telegram client uses standard fetch with JSON POST to `sendMessage`, a five-second timeout, string chat IDs, and no parse mode. Non-2xx, `{ok:false}`, malformed responses, transport failure and timeout raise a small typed error. Raw Telegram/fetch messages and token-bearing URLs are neither logged nor propagated. The environment example has no real credentials and no NEXT_PUBLIC variables. Telegram behavior follows the [official Bot API](https://core.telegram.org/bots/api#sendmessage).

`POST /api/telegram/webhook` runs in the Node runtime. It fails closed with 503 if the secret is absent, uses a constant-time equality check after comparing byte lengths, returns 401 for an invalid header and 400 for malformed JSON. Unsupported updates, edited messages, media, bots and nonprivate chats return 200 without mutation. Supported private text messages use only `from.id` for identity and `chat.id` for routing; names and usernames are ignored. Integer JSON IDs must be JS-safe; exact decimal-string IDs can span PostgreSQL BIGINT. Unsafe numbers are rejected before string conversion. Outgoing RPC/Telegram IDs and returned money remain strings.

Deterministic outcomes and duplicate updates return 200. Database/receipt failure returns a generic 503 without stack traces. Ordinary prompt-send failures retain session state and return success; users can restart with a command. No background processing or delivery retry is added.

## Commands and wizards

`/start` claims its update and upserts the Telegram identity/private chat atomically, preserving any employee assignment. The English response identifies an active linked employee/name/role and lists commands, or explains that a manager must link the account on the website. `/start Richard` cannot self-assign. `/cancel` atomically claims and deletes the sender's session, including for unlinked users.

`/sale` requires an active stored SALESPERSON; `/expense` requires EXPENSE_REPORTER. A successful start replaces the prior wizard and snapshots employee, chat, flow, first step and empty draft. Unauthorized starts do not create a wizard. Manager and Kevin cannot submit sales; salespeople and manager cannot submit expenses.

Sale steps: reference, customer, A/B project, description, euro amount, Richard %, Anastasia %, Jean-Claude %. Expense steps: reference, description, euro amount, Materials/Travel/Other, A/B/Company overhead. Timestamp and submitter are automatic. Canonical expense values are uppercase DB constants.

Block C's required-text/reference, cents and exact final split validation are reused. New euro parsing uses exact decimal arithmetic, permits at most two fractional euro digits, rejects nonpositive/unsafe amounts and passes integer cents as strings. Percentages remain decimal strings; malformed/out-of-range shares and totals other than exactly 100 are rejected. Reference case is preserved. No extra confirmation step is introduced.

Invalid input submits a null value to the atomic RPC, claiming the update while preserving the exact wizard step/draft. Messages identify missing values, bad project/category/allocation, nonpositive or overprecise amounts, malformed/out-of-range percentages or invalid total. Users may correct the current answer; `/sale` or `/expense` restarts to change prior values. Duplicate references retain the wizard and instruct the user to restart with a new reference.

## Atomicity, concurrency and final submission

Every mutating Telegram update claims its primary key inside `telegram_apply_update`, in the same transaction as its session/link/financial mutation. A duplicate exits before any second mutation or new Telegram reply, including after final session deletion. Deterministic rejections retain the claim; unexpected SQL failure rolls the claim and mutation back together.

For this five-person demonstration, Telegram mutations and manager remaps share one transaction-scoped PostgreSQL advisory lock `(20260928,5)`. This also serializes absent-link creation and concurrent employee reassignment. No network call is inside that lock. Relevant link/session rows are additionally locked. Existing D operations are unchanged. This small global lock is a deliberate simplicity choice, not a high-throughput design.

The application reads the session before validating an answer, then passes the complete original snapshot as a compare-and-set token. The RPC compares it to the locked current snapshot, including its exact timestamp, identity, chat and draft. If another answer/restart changed the session, this update is claimed but not reinterpreted as an answer to a different step. A corrective restart message is returned. Answers cannot move the origin to another chat.

At final submission, the same operation claims the update, reloads/locks the current link and active employee, verifies mapping equals employee_id_at_start and the stored role permits the flow, loads the current draft, and inserts the financial row. The existing schema checks defend required fields, state, exact split ranges/total and positive money; the RPC also enforces the safe-cent ceiling. A changed mapping/role rejects and clears the stale session. Manager remaps normally clear it earlier; even administrative changes bypassing cleanup are rechecked at finalization.

Successful insert atomically deletes the session and persists TELEGRAM source, immutable submitter and original wizard chat, original business proposal snapshot, revision 1, Sheets PENDING, initial confirmation PENDING to that original chat, and decision notification NOT_REQUIRED. Sale status is PENDING_APPROVAL with zero commissions/null final split. A/B expense status is AWAITING_ALLOCATION with null final allocation. Overhead is immediately ALLOCATED to COMPANY_OVERHEAD, with database time and no manager audit.

Only the financial insert has a nested exception boundary. A reference UNIQUE failure returns DUPLICATE_REFERENCE while preserving the outer claim and unchanged session; other unique failures propagate. Persisted invariant failures return INVALID with no row. No failed insert can produce a SAVED receipt.

## Initial confirmations and linking

The controller awaits the successful RPC result before sending any recorded message. It uses the persisted target and exact amount, and includes reference, project/proposed allocation and English status. Success marks SENT, sets sent time and clears error. Failure marks FAILED with a fixed safe error, leaves sent time null and retains the financial row. The tracking RPC updates only PENDING Telegram confirmations and never changes the frozen target, business revision, financial status or decision notification.

`setManagerTelegramLink(actorEmployeeId, telegramUserId, employeeId)` is server-only and has no route, website UI or Telegram command. The DB verifies an active MANAGER and active target employee, requires the Telegram row to exist, unmaps the target employee's former Telegram account, replaces the target account's assignment and clears sessions of changed mappings. Reapplying an unchanged link preserves its session. Historical transaction identity, origin, proposal and notification targets are untouched. No optional unlink operation was needed.

## Verification

- `pnpm test`: PASS, 259 tests in six files: 197 existing + 62 Block E tests.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, zero warnings.
- `pnpm build`: PASS, existing static routes plus dynamic `/api/telegram/webhook`.
- Test/build initially hit Windows sandbox child-process EPERM and passed with approved execution outside the sandbox. No code workaround was introduced.
- All application tests mock only the DB/RPC boundary, Telegram HTTP boundary and server-only marker; no real credentials/network are used.
- Tests cover secret rejection, malformed/unsupported updates, identity separation/self-assignment prevention, command authorization outcomes, persistent snapshot handling, invalid answers, exact money/percentages, duplicate delivery, stale/remapped outcomes, post-DB confirmation ordering, origin routing, overhead/project messages, SENT/FAILED tracking, safe errors and manager RPC denial. Mocked role outcomes test the adapter; actual authorization assertions are in SQL QA.
- Frozen-file diff is empty for A–D code, migrations, tests and prerequisite contracts. Build client assets contain none of the private environment variable names.

The SQL QA script contains 39 named behavior assertions, four function privilege checks and one function-count check, plus actual post-rollback checks of all five application tables. It covers identity upsert, claims, duplicate commands/answers/final delivery, unlinked/wrong-role denials, invalid answers, snapshot conflicts, transaction-abort rollback, decimal/failing splits, missing persisted data, sale and expense insertion, source/origin/initial intent, duplicate reference, stale mapping/role/inactive employee, one-to-one remap, historical preservation and confirmation states. It commits only temporary prestate before the test transaction, wraps every application mutation in BEGIN/ROLLBACK, and raises named exceptions on genuine failures. Run the entire script in one dedicated connection with unrelated writes paused.

## Deferred work and review limits

No local PostgreSQL/Supabase executable was available. The new migration and SQL QA were statically inspected but have NOT been run against PostgreSQL/Supabase here. No remote project was changed. Prior Block D real runtime validation is supplied by the user's instructions, not newly claimed by this run. Actual PostgREST serialization/ACL execution, simultaneous-connection races and crash recovery remain runtime verification tasks.

No real bot, BotFather action, token or webhook URL was configured, and no live Telegram message was sent. Telegram send success followed by a crash/tracking-DB failure can leave PENDING; a network timeout can have an uncertain external outcome. The durable intent survives, but this block does not promise exactly-once external delivery. Duplicate update delivery intentionally sends no replacement confirmation. Future recovery must address PENDING as well as FAILED; no retry worker/UI is included.

Intentionally deferred: manager Telegram setup UI, website transaction/manager/dashboard UI, full authentication, manager-decision send/retries, Sheets API/sync, background workers, Vercel deployment and persistent Test 1/Test 2 fixtures. No known implementation blocker remains. All 29 Block E implementation acceptance criteria are satisfied by the delivered code, automated gates and static database review, subject to the explicitly unverified runtime behavior above. Ready for implementation review; no claim of live integration readiness.
