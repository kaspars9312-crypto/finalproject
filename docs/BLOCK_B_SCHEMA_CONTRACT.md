# Block B database contract

The authoritative assignment and frozen architecture remain unchanged. This note describes only the schema in `supabase/migrations/20260927000000_initial_schema.sql`; it does not implement domain operations or integrations.

## Migration and seed

Apply the initial migration once, through the Supabase migration workflow, as the database migration owner. It uses an explicit transaction: an error rolls back the entire schema/seed change. Existing tables are intentionally not hidden by `IF NOT EXISTS`. Future changes belong in new timestamped migrations.

The target is a Supabase PostgreSQL database with the standard existing `anon`, `authenticated` and `service_role` roles. The migration does not create or modify roles. It uses built-in `gen_random_uuid()` and requires no additional extension, ORM or package. No database has been provisioned or connected during Block B.

The final employee INSERT is independently rerunnable using `ON CONFLICT (code) DO UPDATE`. It restores the specified names/roles while preserving existing UUIDs, creation timestamps and active flags. New employees default to active. The whole initial CREATE TABLE migration is not rerunnable.

| Code | Display name | Role |
| --- | --- | --- |
| SVETLANA | Svetlana de Monte Carlo | MANAGER |
| RICHARD | Richard Darling | SALESPERSON |
| ANASTASIA | Anastasia Ferrari | SALESPERSON |
| JEAN_CLAUDE | Jean-Claude Bērziņš | SALESPERSON |
| KEVIN | Kevin von Whatever | EXPENSE_REPORTER |

There are exactly five core table definitions. Only employees are seeded; no transactions, links, sessions or Telegram updates are seeded.

## Constraints by table

All required common fields use column-level NOT NULL. Nullable fields are explicitly required or prohibited by the relevant transaction-type/state CHECK. PostgreSQL accepts UNKNOWN for a CHECK, so the explicit `IS NOT NULL` guards are essential. See [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).

| Table | Keys and named checks |
| --- | --- |
| `employees` | UUID PK; UNIQUE `code`; `employees_code_check` permits only the five codes; `employees_role_check` permits the three roles; `employees_display_name_check` rejects whitespace-only names. |
| `telegram_links` | BIGINT `telegram_user_id` PK; nullable UNIQUE `employee_id` FK to employees. Multiple unlinked users are allowed; a non-null employee can be linked only once. |
| `telegram_sessions` | BIGINT `telegram_user_id` PK/FK to links, ON DELETE CASCADE; employee-at-start FK; `telegram_sessions_flow_type_check` permits SALE/EXPENSE; `telegram_sessions_step_check` rejects whitespace-only steps. Draft JSONB defaults to `{}`. |
| `telegram_updates` | BIGINT `update_id` PK and required `received_at` defaulting to `now()`, with no other columns. |
| `transactions` | UUID PK; global UNIQUE `reference`; submitter, approver and allocator FKs to employees; the named checks below. |

Other FKs keep the PostgreSQL NO ACTION default. In particular, deleting an employee cannot silently delete historical financial rows. Deleting a Telegram link removes its transient wizard session only; historical transaction chat IDs have no FK to the current mapping.

Transaction CHECK names use the `transactions_` prefix:

| Suffix | Rule |
| --- | --- |
| `reference_check` | Nonempty reference with no leading/trailing POSIX whitespace. `COLLATE "C"` plus UNIQUE preserves exact case-sensitive identity across both types. |
| `type_check`, `source_check`, `status_check` | Allowed transaction types, sources and four financial statuses. |
| `revision_check`, `amount_check`, `description_check` | Revision >= 1, amount > 0, description contains non-whitespace. |
| `sale_fields_check` | Required nonblank customer, A/B project, exact proposed shares in [0,100] summing to 100, present nonnegative commission fields, all expense-only columns NULL. |
| `sale_state_check` | Only pending/approved. Pending requires NULL final split/audit and zero commissions. Approved requires exact final shares, approval identity/time, sum of individual cents = pool, and the rounded 10% pool. |
| `expense_fields_check` | Required category and proposed allocation from the specified sets; every sale-only field, including all commission fields, must be NULL. |
| `expense_state_check` | Awaiting A/B has no final allocation/audit. Automatic overhead must be allocated to overhead, with time but no manager. Manager-finalized A/B proposals require a permitted final allocation, manager and time. |
| `sheet_status_check` | PENDING/SYNCED/FAILED. |
| `submission_status_check`, `submission_source_check` | Website has no origin chat or initial-confirmation target and uses NOT_REQUIRED. Telegram has both chat fields and uses PENDING/SENT/FAILED. |
| `decision_status_check`, `decision_state_check` | Five allowed notification statuses. Pending sales, awaiting expenses and automatic overhead require NOT_REQUIRED. Manager-finalized rows require PENDING/SENT/FAILED/NO_RECIPIENT. |

The two added non-unique indexes are `transactions_submitter_employee_id_idx` on `(submitter_employee_id)` and `transactions_type_status_idx` on `(transaction_type, status)`. PK/UNIQUE constraints supply the other indexes automatically.

## Arithmetic and boundaries

Percentages use unconstrained exact NUMERIC, not floating point or integer-only values. The range checks also reject nonfinite NUMERIC values. Money remains BIGINT cents. The approved pool must equal `round(amount_cents::numeric / 10, 0)`: PostgreSQL NUMERIC rounds ties away from zero, equivalent to HALF-UP for the positive amounts permitted here. Individual commission sums cast to NUMERIC before adding to avoid BIGINT overflow. See [PostgreSQL numeric rounding](https://www.postgresql.org/docs/current/functions-math.html).

Individual commission rounding, residual allocation and tie-breaking remain Block C. The schema validates the pool and sum, not each individual's arithmetic. No SQL calculation function or trigger is introduced.

Also left to later operations: stored-role authorization; proposal/identity immutability; permitted one-way transitions; revision increments and compare-and-set; updating `updated_at`; draft/original JSON payload validation; atomic update claims plus mutations; and atomic business-change plus delivery intent. Defaults initialize fields only; they do not implement these operations.

Delivery metadata columns store errors, targets, sent times and the Sheets sync marker. Status checks do not prove that an API call succeeded. Target resolution/equality with the originating chat, freezing the retry recipient, sent/error timestamp lifecycle, sync serialization and retries remain later work. No recipient-routing queries or external calls are present.

## RLS and service access

RLS is enabled on all five tables with no policies. All table privileges are revoked from PUBLIC, `anon` and `authenticated`; SELECT/INSERT/UPDATE/DELETE are explicitly granted to the existing `service_role`. No full login model or permission-policy matrix is added.

This preserves the server-only architecture and avoids relying on changing Supabase default grants. Supabase's service role has BYPASSRLS, and the existing Block A client uses the privileged key without a user session. Thus the migration's RLS setup is compatible with that client by static inspection and the documented role contract. Actual service-role access has **not** been tested on a database. See [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api) and [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles).

When applying to an authorized database, verify `service_role.rolbypassrls`, its schema USAGE/table DML privileges, no browser-role table privileges, and enabled RLS/no policies. Run representative valid and invalid inserts in a transaction ending in ROLLBACK before using the schema. Block B did not connect to a remote/shared database or create database roles to simulate Supabase.

## Required examples: manual review, not executed PostgreSQL tests

The following outcomes were checked against the SQL expressions. Every example assumes otherwise-valid required fields and valid employee FKs. Finalized manager decisions explicitly set a permitted decision status, since the default NOT_REQUIRED is for undecided/automatic rows.

| # | Example | Expected outcome and reason |
| --- | --- | --- |
| 1 | Pending SALE, proposed 50/30/20, final NULL, all commissions 0 | Accept: sale fields and pending branch pass. |
| 2 | Approved SALE, amount 123450 cents, final 20/40/40, pool 12345, individual cents 2469/4938/4938, manager/time present | Accept: exact split, rounded pool, sum and audit pass. |
| 3 | Expense proposed A, awaiting, final/manager/time NULL | Accept: awaiting branch passes. |
| 4 | Expense proposed overhead, allocated to overhead, time present, manager NULL | Accept: automatic branch passes; decision NOT_REQUIRED. |
| 5 | Expense proposed B, allocated to A, manager/time present | Accept: manager-finalized branch passes. |
| 6 | Website pending sale, origin/initial target NULL, initial status NOT_REQUIRED | Accept: website source branch passes. |
| 7 | Telegram pending sale, origin and initial target present, initial status PENDING | Accept: Telegram source branch passes. |
| 8 | SALE proposed 60/30/20 | Reject: `sale_fields_check`, total is 110. |
| 9 | Pending SALE with populated final split | Reject: `sale_state_check`, each final share must be NULL. |
| 10 | Pending SALE with nonzero earned commission | Reject: `sale_state_check`, all commission amounts must be zero. |
| 11 | Approved SALE with individual sum different from pool | Reject: `sale_state_check`. |
| 12 | EXPENSE with customer/project/commission values, even commission 0 | Reject: `expense_fields_check`, sale-only fields must be NULL. |
| 13 | Awaiting expense with populated final allocation | Reject: `expense_state_check`. |
| 14 | Overhead proposal with AWAITING_ALLOCATION | Reject: awaiting branch allows only proposed A/B. |
| 15 | Website transaction with origin Telegram chat | Reject: `submission_source_check`. |
| 16 | Telegram transaction with initial status NOT_REQUIRED | Reject: `submission_source_check`. |
| 17 | Zero or negative amount | Reject: `amount_check`. |
| 18 | Duplicate exact reference, including across sale/expense | Reject: reference UNIQUE. Case variants are distinct. |
| 19 | Reference with leading/trailing space, tab or newline | Reject: `reference_check`. |
| 20 | Revision 0 | Reject: `revision_check`. |

Additional manual checks: missing sale customer/project/proposed share/commission amount fails explicit non-null guards; missing approved final share/approval audit fails; missing expense category/proposal/final allocation/audit fails its required branch. Unknown codes/roles/states and invalid FKs fail their respective constraints. Multiple NULL employee links pass; duplicate non-null links fail UNIQUE. Fractions such as 33.33/33.33/33.34 sum exactly to 100. Approved amounts of 4 and 5 cents require pools of 0 and 1 cent respectively. A manager can allocate an A/B proposal to overhead, with manager audit and a decision notification. Automatic overhead cannot carry a manager audit or decision notification.

## Validation status

- Block A baseline: `191e750` (`chore: freeze block A foundation`), with all 20 source files matching the review ZIP before changes. The ZIP remains an untracked review artifact.
- No local PostgreSQL/Supabase binaries, service or usual local listener were found. No database/toolchain was installed and no credentials were invented.
- **SQL execution was not independently run against PostgreSQL.** Table creation, seed rerun, constraint insert tests and actual RLS/service access require database execution at a later validation step.
- SQL was manually inspected for syntax, type/state compatibility, nullable CHECK behavior, keys/indexes, exact arithmetic and all 20 cases above. This is static review, not a substitute for executing the migration.
- Static inventory check passed: exactly five CREATE TABLE statements, 21 distinct named CHECK constraints, two explicit indexes, five RLS declarations and an employee-only seed; no functions, triggers, policies, views or custom enum types.
- Application quality gates passed after the schema/documentation changes: `pnpm typecheck`, `pnpm lint`, `pnpm build` (exit code 0 for each). Build ran outside the sandbox because Next.js worker creation was previously blocked there. Application source, dependencies and lockfile are unchanged.
