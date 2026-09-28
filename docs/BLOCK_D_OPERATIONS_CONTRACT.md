# Block D operation contract

Scope authority: supplied `D:/CODEX_BLOCK_D_ATOMIC_OPERATIONS.md`. Its website/atomic-operation scope follows the supplied pure-domain Block C prompt, narrowing the older architecture's block numbering. The original assignment and frozen business/schema rules are preserved. No UI, route, server action, Telegram submission flow, Telegram/Sheets delivery, worker, deployment or persistent assignment fixture is added. Stop at Block D review.

## Baseline and files

Started on `master` at `4e3df8f`, with reviewed Block C changes in README, package/lock files, `src/domain/`, the Block C contract and Vitest configuration. All 34 existing files in `Friends_Included_Block_C_Review.zip` matched the working files byte-for-byte. The archive's Block C prompt was absent locally; both supplied copies on D: have the same SHA256 and were read from there. All Block C implementation files and the complete diff were inspected before changes.

Committed only those Block C changes as `abec4aa` (`chore: freeze block C domain rules`), using the prior A/B commit identity for that command without changing Git configuration. No A/B commit was amended. Review ZIPs remain untouched and untracked. Block D changes remain uncommitted for review.

New files:

- `supabase/migrations/20260928000000_atomic_operations.sql`
- `supabase/tests/block_d_atomic_operations.sql`
- `src/server/operations/transactions.ts`
- `src/server/operations/transactions.test.ts`
- This contract.

Modified: README and Vitest's test-file include list. No package or dependency changes. The original migration, source Markdown/DOCX documents, Block B/C contracts, domain code/tests, client factory and app files remain unchanged from the frozen baseline.

## Server and database boundary

`transactions.ts` imports `server-only` and uses the existing lazy `createSupabaseAdminClient`. There are five direct operations: `createWebsiteSale`, `createWebsiteExpense`, `correctPendingSale`, `approveSale`, `allocateExpense`. They return a discriminated success/error result. Success returns only transaction UUID, normalized reference, status and revision, not the full privileged row.

Inputs contain an employee UUID, never an authoritative role. Each mutation verifies an active employee's stored role inside the same database transaction. The actor row is held with `FOR SHARE` through commit, preventing a concurrent role/deactivation update from passing an obsolete role check. These are demonstration identities, not an added login system. Future transport code must resolve the selected employee identity appropriately. Block C permission helpers remain available for later callers; persistence authority is the DB check, without a redundant role preflight.

All six new functions use explicit `SECURITY INVOKER`, `search_path = pg_catalog`, and schema-qualified application relations. Each explicitly revokes EXECUTE from PUBLIC, `anon`, and `authenticated` and grants EXECUTE to `service_role`. The migration owner retains normal administrative authority. No SECURITY DEFINER, trigger, policy, table, column or constraint is added or changed. Existing service-role table permissions and BYPASSRLS remain required.

| RPC | Purpose |
| --- | --- |
| `create_website_sale` | Atomic role check and website pending-sale insert. |
| `create_website_expense` | Atomic role check and website expense insert, including automatic overhead. |
| `correct_pending_sale` | Manager-only current-field correction with status/revision CAS. |
| `read_sale_for_approval` | Manager-only exact-string read of current amount and immutable proposal for Block C calculation. No business mutation. |
| `approve_sale` | Atomic one-way approval, final commissions, audit and durable delivery intent. |
| `allocate_expense` | Atomic one-way final allocation, audit and durable delivery intent. |

## Business behavior and concurrency

Website sale creation requires SALESPERSON. It normalizes required text/reference through Block C, validates positive safe integer cents and exact split sum 100, then inserts a single pending sale at revision 1. Current fields and proposed percentages contain the submission, final percentages are NULL and commissions zero. Database defaults initialize timestamps and Sheets PENDING. Telegram origin/targets are NULL, initial confirmation and decision status NOT_REQUIRED. A duplicate exact reference, including a collision with an expense, fails at the existing UNIQUE constraint; case is preserved.

Website expense creation requires EXPENSE_REPORTER and validates category/allocation against the Block C constants. A/B proposals await allocation with no final allocation or allocation audit. COMPANY_OVERHEAD is immediately ALLOCATED to overhead at a database timestamp, with no manager or decision notification. All start at revision 1, Sheets PENDING and initial confirmation NOT_REQUIRED. Managers cannot submit either type.

The DB constructs `original_submission` itself from normalized original business values, rather than trusting a caller-supplied JSON snapshot. Sale snapshots include reference, customer, project, description, amount and three proposed percentages. Expense snapshots include reference, description, amount, category and proposed allocation. Money and percentages inside snapshots are exact decimal strings. Identity/source/timestamps remain in their dedicated row columns. Manager functions never assign snapshot/proposed/identity fields.

Correction locks the current transaction and requires SALE + PENDING_APPROVAL + expected revision. Only customer, project, description and amount change; revision increments, updated_at is set by the DB, and Sheets error/start metadata is cleared with status PENDING. Final percentages stay NULL, all commissions stay zero, and decision intent remains NOT_REQUIRED. No manager split draft is persisted.

Approval reads current amount and proposed split through the exact read RPC, uses the optional manager override if supplied, and invokes frozen Block C validation/calculation. The mutation independently rechecks actor role, locks the transaction and requires SALE + PENDING_APPROVAL + the same expected revision. The UPDATE repeats those predicates. This prevents calculation from an earlier read overwriting a correction or approval. Success writes final percentages, rounded pool/individual amounts, manager/time, revision N+1 and all delivery intent together.

Allocation uses the same actor lock and transaction lock/CAS, requiring EXPENSE + AWAITING_ALLOCATION. It writes the final allocation, manager/time, revision N+1 and delivery intent together. Amount and original proposal are unchanged. No extra financial row or mutable balance exists, so allocation cannot deduct another company expense. Automatic overhead is already final and cannot enter this path.

Missing rows produce NOT_FOUND; wrong transaction types INVALID_STATE; mismatched revision or already-finalized status STALE_CONFLICT. Second approval/allocation and approval/correction races make no second change, including no revision increment or new notification target. Constraint failure rolls back the entire function, including delivery fields. No automatic mutation retries are implemented. At PostgreSQL READ COMMITTED, a waiting row lock sees the committed updated row; at stricter isolation a serialization failure maps to STALE_CONFLICT.

## Exact numeric contract

NUMERIC percentages cross both directions as decimal strings. BIGINT input cents also go over RPC as strings after Block C safe-integer validation. `read_sale_for_approval` casts amount and percentages to SQL text before building JSON, preventing loss during JSON parsing. The TypeScript adapter verifies the BIGINT string with BigInt, rejects zero/negative/out-of-safe-range values, and only then converts to Number.

Block C alone calculates individual ROUND_HALF_UP commissions, signed residual and Richard/Anastasia/Jean-Claude tie priority. The frozen schema independently checks exact final percentage ranges/sum, the rounded 10% pool for the current amount, nonnegative commissions and their sum. Deliberate simplification: no duplicate individual commission algorithm in SQL. Service-role callers must use the server operation to supply the Block C result; the service role remains trusted and already has direct table DML rights under Block B.

## Durable delivery intent

Every accepted insert/correction/decision leaves Sheets PENDING. Corrections and decisions clear `sheet_last_error` and `sheet_sync_started_at`. Approval/allocation select the decision recipient inside the database operation after locking the transaction:

- TELEGRAM: immutable `origin_telegram_chat_id`, independent of remapping.
- WEBSITE: submitter's current `telegram_links.last_private_chat_id`, looked up at decision time, not submission. Existing matching links are locked FOR SHARE until commit.
- No linked chat: NO_RECIPIENT and NULL target; otherwise PENDING with the frozen target.

Both decisions clear `decision_last_error` and `decision_sent_at`. A website link absent at the lookup snapshot yields NO_RECIPIENT; a link created after that decision belongs to later recovery policy, outside this block. Later mapping changes cannot redirect an existing target. These fields are part of the same DB transaction as the business decision, so a process death after commit leaves recoverable intent without a network call. This is a transaction design guarantee; no live process-crash experiment was performed here.

## Error model

| Operation code | Mapping |
| --- | --- |
| VALIDATION | Block C errors with field/message; SQLSTATE 22023, 22P02, 22003, 23502, 23514. |
| FORBIDDEN | BD001: missing/inactive/wrong-role actor. |
| DUPLICATE_REFERENCE | BD005: creation catches 23505 only for `transactions_reference_key`, using diagnostic constraint name. |
| NOT_FOUND | BD002: transaction absent. |
| STALE_CONFLICT | BD003: status/revision conflict; 40001 serialization failure; 40P01 deadlock. |
| INVALID_STATE | BD004: wrong transaction type. |
| DATABASE_ERROR | Other DB/transport/configuration failures, unsafe or malformed stored numbers, malformed receipts. |

No error-message string parsing and no raw DB error messages/details or credentials leave the operation. Other UNIQUE failures are not mislabeled duplicate reference. DATABASE_ERROR can represent an uncertain commit after a transport failure: reload before retrying. The UNIQUE barrier and one-way CAS protect repeated attempts but this block does not promise exactly-once transport delivery.

## Verification and review limits

- `pnpm test`: PASS, 197 tests in five files (137 frozen domain tests + 60 new operation tests).
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, zero warnings.
- `pnpm build`: PASS, only `/` and `/_not-found` static routes.
- Vitest and build initially encountered sandbox Windows child-process EPERM; both passed with approved execution outside the sandbox. No application workaround or dependency was added.
- Operation tests mock only the existing admin-client/RPC boundary and the `server-only` marker. They forbid fetch, require no credentials, test normalization/validation, exact percentages, safe money conversion, default/override approval, corrected amounts, residual/tie behavior, allowed-field whitelists, stale interleavings and sanitized errors.
- SQL script assertions cover all 22 requested scenarios, plus active-role denial, manager submission denial, wrong type/not found, null revision, failed-constraint atomic rollback, overhead, late website expense linking, frozen retry target, exact numeric wire types and per-function privilege/search-path checks. Original sale/expense snapshots are compared before and after manager operations; refused operations compare the whole row.
- The SQL script is a separate executable database assertion suite. It uses temporary result/helpers and UUID-prefixed fake QA references. All application-table setup/mutations are inside BEGIN/ROLLBACK. Session-only metadata is set before BEGIN for actual post-rollback absence/link-restoration checks. It prints measured PASS/FAIL rows and totals. Run the whole script in one connection, preferably while other mapping changes are paused; no fixture is committed.
- The script exercises ordered stale interleavings in one connection. It does not simulate simultaneous connections. Lock/CAS behavior is statically reviewed; real concurrent calls, process-crash persistence, RPC ACLs and PostgREST serialization have not been runtime-verified in this workspace.
- No local PostgreSQL/Supabase executable was found. No database/toolchain was installed and no credentials or remote connections were invented. Neither migration application nor SQL-script execution is claimed. Apply the new migration through the authorized Supabase workflow, then run `supabase/tests/block_d_atomic_operations.sql`; any FAIL must be investigated before using the operations.

All 26 Block D implementation acceptance criteria are satisfied by the delivered code, tests and static review, with the database runtime limitation above explicitly outstanding. No known implementation blocker remains. There is no claim of completed integration or deployed database behavior. No Block E work is included.
