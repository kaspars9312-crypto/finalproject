# Codex Block B — Supabase Schema and Database Contract

You are implementing ONLY Block B of the Friends Included / Wedding Guests for Hire project.

## Source hierarchy

Read these files completely before making changes:

1. `docs/ORIGINAL_ASSIGNMENT.md` — authoritative source. If anything conflicts with it, this file wins.
2. `docs/PROJECT_SPEC.md` — frozen implementation architecture after three independent audits.
3. `CODEX_BLOCK_A_FOUNDATION.md` — previous frozen block scope.
4. Current repository state — Block A has passed independent review.

Do not reinterpret or expand the assignment.
Do not implement Block C or later blocks early.

## First action: inspect and preserve Block A

Before changing files:

1. Inspect the entire repository.
2. Confirm Block A is still intact.
3. Run `git status`.
4. If the current Block A state is not committed, create a baseline commit without changing files:
   `chore: freeze block A foundation`
5. Read `docs/PROJECT_SPEC.md`, especially sections:
   - Core database model
   - Sale model and state machine
   - Expense model and state machine
   - Atomic/idempotent business operations
   - Telegram confirmation/notification state
   - Google Sheets synchronization
   - Final frozen design decisions
   - Codex implementation sequence
6. Report any conflict that affects Block B. If a material conflict exists, STOP instead of silently choosing another design.

## Scope of Block B

Implement ONLY the PostgreSQL/Supabase schema and database contract.

Required outcome:

- SQL migration(s) defining the final five core tables:
  - `employees`
  - `telegram_links`
  - `telegram_sessions`
  - `telegram_updates`
  - `transactions`
- Seed the five fictional employees.
- Implement required PK/FK/UNIQUE/CHECK/index constraints.
- Encode structural SALE vs EXPENSE invariants.
- Encode state-compatible nullable/non-null fields.
- Add mandatory `revision`.
- Add minimal external-delivery state columns required by the frozen architecture.
- Preserve a clean migration path for later blocks.
- No business/domain service implementation yet.
- No Telegram API logic.
- No Google Sheets API logic.
- No website forms/dashboard/manager UI.
- No Test 1/Test 2 transaction fixtures.

## Simplicity rules

Prefer plain PostgreSQL supported by Supabase.

For this homework:

- Prefer `TEXT + CHECK` constraints for small state/value sets rather than creating many PostgreSQL enum types.
- Do not introduce triggers unless this prompt explicitly requires one.
- Do not create an immutability trigger for `original_submission`.
- Do not create stored financial balance tables.
- Do not create a commissions table.
- Do not create an expense-allocation table.
- Do not create an event/outbox table.
- Do not add Redis, queues, workers, Prisma, an ORM, or another persistence layer.
- Do not add a full authentication model.
- Do not add speculative tables.

The schema must remain understandable enough to audit manually.

# 1. `employees`

Create a table conceptually equivalent to:

- `id UUID PRIMARY KEY`
- `code TEXT NOT NULL UNIQUE`
- `display_name TEXT NOT NULL`
- `role TEXT NOT NULL`
- `active BOOLEAN NOT NULL DEFAULT TRUE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Allowed employee codes:

- `SVETLANA`
- `RICHARD`
- `ANASTASIA`
- `JEAN_CLAUDE`
- `KEVIN`

Allowed roles:

- `MANAGER`
- `SALESPERSON`
- `EXPENSE_REPORTER`

Seed exactly these five fictional employees with these role assignments:

- Svetlana de Monte Carlo → `SVETLANA` / `MANAGER`
- Richard Darling → `RICHARD` / `SALESPERSON`
- Anastasia Ferrari → `ANASTASIA` / `SALESPERSON`
- Jean-Claude Bērziņš → `JEAN_CLAUDE` / `SALESPERSON`
- Kevin von Whatever → `KEVIN` / `EXPENSE_REPORTER`

The seed must be safely rerunnable / conflict-safe.
Do not seed Test 1/Test 2 transactions.

# 2. `telegram_links`

Minimum fields:

- `telegram_user_id BIGINT PRIMARY KEY`
- `employee_id UUID NULL REFERENCES employees(id)`
- `last_private_chat_id BIGINT NULL`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Required constraint:

- `employee_id` must be UNIQUE while remaining nullable.
  PostgreSQL's ordinary UNIQUE null semantics are acceptable.

Purpose:

- `/start` may create/update a Telegram identity/chat before manager linking.
- An unlinked user has `employee_id = NULL`.
- One Telegram user maps to at most one employee.
- One fictional employee has at most one current Telegram user.

Do NOT add:
- arbitrary UUID id
- mapping version
- mapping history table

# 3. `telegram_sessions`

Minimum fields:

- `telegram_user_id BIGINT PRIMARY KEY`
- `chat_id BIGINT NOT NULL`
- `employee_id_at_start UUID NOT NULL REFERENCES employees(id)`
- `flow_type TEXT NOT NULL`
- `step TEXT NOT NULL`
- `draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Allowed flow types:

- `SALE`
- `EXPENSE`

It is acceptable and preferred for `telegram_user_id` to reference `telegram_links(telegram_user_id)` with sensible cleanup behavior.

Do NOT add:
- `mapping_version_at_start`
- required session expiration
- business transaction creation logic

# 4. `telegram_updates`

Minimum durable dedup table:

- `update_id BIGINT PRIMARY KEY`
- `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Do NOT add:
- processing lifecycle
- processing_status
- retries table
- queue metadata

Important:
Block B defines only the table.
The atomic rule "claim update_id + caused state mutation in one DB transaction" is implemented in a later domain/operation block, not here.

# 5. `transactions` — common fields

Create one table for both SALE and EXPENSE.

Required common fields:

- `id UUID PRIMARY KEY`
- `reference TEXT NOT NULL UNIQUE`
- `transaction_type TEXT NOT NULL`
- `source TEXT NOT NULL`
- `submitter_employee_id UUID NOT NULL REFERENCES employees(id)`
- `submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `origin_telegram_chat_id BIGINT NULL`
- `original_submission JSONB NOT NULL`
- `status TEXT NOT NULL`
- `revision INTEGER NOT NULL DEFAULT 1`
- `description TEXT NOT NULL`
- `amount_cents BIGINT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Required common rules:

- `reference` must be non-empty.
- Prevent persisted leading/trailing whitespace in `reference` with a simple DB constraint if practical.
- Keep reference comparison case-sensitive. Do NOT invent lowercasing/citext behavior.
- `amount_cents > 0`
- `revision >= 1`
- `description` must be non-empty after trimming.

Allowed:

`transaction_type`
- `SALE`
- `EXPENSE`

`source`
- `TELEGRAM`
- `WEBSITE`

Allowed status universe:
- `PENDING_APPROVAL`
- `APPROVED`
- `AWAITING_ALLOCATION`
- `ALLOCATED`

Status must also be compatible with transaction type through type-specific checks below.

# 6. SALE-specific columns

Add:

- `customer TEXT NULL`
- `project TEXT NULL`
- `proposed_richard_pct NUMERIC NULL`
- `proposed_anastasia_pct NUMERIC NULL`
- `proposed_jean_claude_pct NUMERIC NULL`
- `final_richard_pct NUMERIC NULL`
- `final_anastasia_pct NUMERIC NULL`
- `final_jean_claude_pct NUMERIC NULL`
- `commission_pool_cents BIGINT NULL`
- `richard_commission_cents BIGINT NULL`
- `anastasia_commission_cents BIGINT NULL`
- `jean_claude_commission_cents BIGINT NULL`
- `approved_by_employee_id UUID NULL REFERENCES employees(id)`
- `approved_at TIMESTAMPTZ NULL`

For SALE rows:

- `customer` must be present and non-empty.
- `project` must be `A` or `B`.
- proposed percentages must all be present.
- every proposed percentage must be between 0 and 100 inclusive.
- proposed percentages must sum EXACTLY to 100 using PostgreSQL exact NUMERIC arithmetic.
- all EXPENSE-only columns must be NULL.

For `PENDING_APPROVAL` SALE:

- final percentages must all be NULL.
- `commission_pool_cents = 0`
- each individual commission cents = 0
- `approved_by_employee_id IS NULL`
- `approved_at IS NULL`

For `APPROVED` SALE:

- final percentages must all be present.
- every final percentage must be between 0 and 100 inclusive.
- final percentages must sum EXACTLY to 100.
- commission fields must be non-negative.
- individual commission cents must sum exactly to `commission_pool_cents`.
- `approved_by_employee_id` must be present.
- `approved_at` must be present.

If it can be expressed cleanly and readably, also enforce the 10% rounded commission-pool rule at DB level using exact PostgreSQL numeric arithmetic for positive amounts.
If doing so makes the constraint obscure or fragile, leave the exact pool calculation to Block C and document that choice in the final report.
Do NOT implement individual residual-allocation calculation in SQL in this block.

# 7. EXPENSE-specific columns

Add:

- `expense_category TEXT NULL`
- `proposed_allocation TEXT NULL`
- `final_allocation TEXT NULL`
- `allocated_by_employee_id UUID NULL REFERENCES employees(id)`
- `allocated_at TIMESTAMPTZ NULL`

Allowed expense categories:

- `MATERIALS`
- `TRAVEL`
- `OTHER`

Allowed allocations:

- `A`
- `B`
- `COMPANY_OVERHEAD`

For EXPENSE rows:

- `expense_category` must be present.
- `proposed_allocation` must be present.
- all SALE-only fields must be NULL.
- SALE commission fields must be NULL, not zero.

For `AWAITING_ALLOCATION`:

- proposed allocation must be `A` or `B`.
- `final_allocation IS NULL`
- `allocated_by_employee_id IS NULL`
- `allocated_at IS NULL`

For automatically allocated Company overhead:

- proposed allocation = `COMPANY_OVERHEAD`
- status = `ALLOCATED`
- final allocation = `COMPANY_OVERHEAD`
- `allocated_by_employee_id IS NULL`
- `allocated_at IS NOT NULL`

For a manager-finalized allocation originating from proposed `A` or `B`:

- status = `ALLOCATED`
- `final_allocation` must be one of `A`, `B`, `COMPANY_OVERHEAD`
- `allocated_by_employee_id IS NOT NULL`
- `allocated_at IS NOT NULL`

Do not implement allocation mutation logic yet.

# 8. Google Sheets delivery fields

Add the minimum fields required by the frozen architecture:

- `sheet_sync_status TEXT NOT NULL DEFAULT 'PENDING'`
- `sheet_last_error TEXT NULL`
- `sheet_sync_started_at TIMESTAMPTZ NULL`

Allowed:
- `PENDING`
- `SYNCED`
- `FAILED`

This block only stores the contract.
Do NOT implement Google Sheets API calls or sync locking logic yet.

# 9. Telegram initial confirmation fields

Add:

- `submission_confirmation_status TEXT NOT NULL`
- `submission_target_chat_id BIGINT NULL`
- `submission_last_error TEXT NULL`
- `submission_sent_at TIMESTAMPTZ NULL`

Allowed status:
- `NOT_REQUIRED`
- `PENDING`
- `SENT`
- `FAILED`

Add simple source-aware structural constraints where they remain readable:

For WEBSITE-origin rows:
- `origin_telegram_chat_id IS NULL`
- initial Telegram confirmation status should be `NOT_REQUIRED`
- initial confirmation target should be NULL

For TELEGRAM-origin rows:
- `origin_telegram_chat_id IS NOT NULL`
- initial confirmation status must not be `NOT_REQUIRED`
- initial confirmation target should be present

Do not create the message-sending code.

# 10. Telegram manager-decision notification fields

Add:

- `decision_notification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'`
- `decision_target_chat_id BIGINT NULL`
- `decision_last_error TEXT NULL`
- `decision_sent_at TIMESTAMPTZ NULL`

Allowed:
- `NOT_REQUIRED`
- `PENDING`
- `SENT`
- `FAILED`
- `NO_RECIPIENT`

Structural state rules should remain readable.

At minimum:

- pending SALE must have decision status `NOT_REQUIRED`
- awaiting EXPENSE must have decision status `NOT_REQUIRED`
- automatically allocated Company-overhead EXPENSE must have decision status `NOT_REQUIRED`

For finalized manager decisions, later business logic will atomically set PENDING / NO_RECIPIENT and target as appropriate.
Do NOT implement recipient routing logic in Block B.

# 11. Type-specific integrity

Create a clear top-level constraint (or a small number of named constraints) ensuring:

For SALE:
- only `PENDING_APPROVAL` or `APPROVED`
- required sale fields present
- expense-only fields NULL
- pending vs approved final/commission/audit rules above

For EXPENSE:
- only `AWAITING_ALLOCATION` or `ALLOCATED`
- required expense fields present
- sale-only fields NULL
- awaiting vs auto-overhead vs manager-finalized allocation rules above

Be careful with PostgreSQL CHECK three-valued logic.
Do not write checks that accidentally pass invalid rows because the expression evaluates to NULL/UNKNOWN.
Use explicit `IS NULL` / `IS NOT NULL` branches.

# 12. Indexes

Keep indexes minimal.

UNIQUE constraints already create indexes.

Add only indexes with clear near-term value for assignment queries, for example:
- transactions by `submitter_employee_id`
- transactions by `transaction_type, status`

Do not create a large speculative index set.

# 13. RLS / browser access

Do NOT build a full authentication/RLS policy system.

All authoritative business mutations will go through server/domain code with the service-role client.

Do not add browser-direct write code.

If you choose to enable RLS with no public policies as a simple protective default, explain why and verify it does not interfere with service-role server access.
Do not create a complex policy matrix in Block B.

# 14. Migration organization

Prefer one clear initial migration for the schema unless the repository already has an established Supabase migration convention.

A sensible structure is:

- `supabase/migrations/<timestamp>_initial_schema.sql`

Optionally add a concise schema-contract note under `docs/` if it materially improves auditability.

Do not modify the authoritative source documents:
- `docs/ORIGINAL_ASSIGNMENT.md`
- `docs/PROJECT_SPEC.md`
- the two original DOCX files

# 15. Validation / quality gates

Run:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`

Also inspect the migration carefully for SQL correctness.

If a local Supabase/PostgreSQL environment ALREADY exists and can be used without installing Docker or introducing a large new toolchain:
- apply the migration;
- inspect created tables/constraints;
- test representative valid and invalid inserts inside rollback-safe transactions.

If no local database environment exists:
- do NOT invent remote credentials;
- do NOT install Docker solely for this block;
- do NOT connect to a random/shared database;
- report clearly that SQL execution was not independently run against PostgreSQL.

# 16. Required schema contract examples to reason through

Before finishing, manually verify the schema behavior for at least these rows:

VALID:
1. Pending SALE, proposed 50/30/20, final split NULL, commissions zero.
2. Approved SALE with final 20/40/40 and commission amounts summing to pool.
3. Expense proposed A and awaiting with no final allocation.
4. Expense proposed Company overhead and immediately allocated with no manager.
5. Expense proposed B and later allocated to A by manager.
6. WEBSITE sale with no Telegram origin and initial confirmation NOT_REQUIRED.
7. TELEGRAM sale with origin chat and initial confirmation PENDING.

INVALID:
8. SALE proposed 60/30/20.
9. Pending SALE with a final split already populated.
10. Pending SALE with non-zero earned commission.
11. APPROVED SALE with individual commissions not summing to pool.
12. EXPENSE carrying sale customer/project/commission fields.
13. AWAITING expense with final allocation populated.
14. Company-overhead proposal left AWAITING.
15. WEBSITE transaction with origin Telegram chat.
16. TELEGRAM transaction with initial confirmation NOT_REQUIRED.
17. Zero/negative amount.
18. Duplicate exact transaction reference.
19. Reference persisted with leading/trailing whitespace.
20. Revision 0.

Do not hard-code S01-S05 or E01-E07 into constraints.

# Explicit non-goals — DO NOT IMPLEMENT YET

Do NOT implement:

- domain service methods
- role authorization functions
- transaction creation API routes
- Telegram webhook handling
- Telegram wizard behavior
- `update_id` atomic claim logic
- Telegram manager setup UI
- sale correction function
- sale approval function
- commission calculation service
- expense allocation function
- financial aggregate queries/dashboard
- Google Sheets API
- Google Sheets retry/sync algorithm
- Telegram sendMessage
- notification retry logic
- website role selector/forms
- manager pages
- Test 1/Test 2 transaction data
- Vercel deployment

Those belong to later blocks.

# Acceptance criteria

Block B passes only if:

1. Block A remains intact.
2. Exactly the intended five core tables exist in the schema.
3. The five fictional employees are seeded correctly.
4. Exact transaction reference uniqueness exists at DB level.
5. SALE and EXPENSE structural constraints prevent invalid hybrid rows.
6. Pending SALE cannot contain an approved/final split or earned commission.
7. Approved SALE requires final split/audit data and commission sum integrity.
8. Expense state constraints correctly distinguish awaiting, auto-overhead, and manager-finalized allocation.
9. `revision` is mandatory and positive.
10. Telegram link uniqueness/nullability matches frozen architecture.
11. `telegram_updates` is only the minimal durable dedup table.
12. Delivery-state columns exist without external API implementation.
13. No schema/business code from Block C+ is implemented.
14. No Test 1/Test 2 fixture transactions are seeded.
15. No real secrets are introduced.
16. Source documents remain unchanged.
17. Typecheck, lint, and build still pass.

# Required final response

When finished, STOP. Do not continue to Block C.

Report:

1. Repository state before Block B and baseline commit status.
2. Files created/modified.
3. Exact tables created.
4. Exact constraints/checks added, summarized by table.
5. Employee seed rows.
6. Indexes added.
7. Whether RLS was changed and why.
8. Database validation actually executed, if any.
9. Results of `pnpm typecheck`, `pnpm lint`, `pnpm build`.
10. Any deliberate simplification or constraint left to Block C.
11. Any unresolved risk.
12. Explicit statement whether all Block B acceptance criteria pass.
13. End with exactly:
   `BLOCK B READY FOR REVIEW`
   or
   `BLOCK B NOT READY`

Do not continue beyond Block B.
