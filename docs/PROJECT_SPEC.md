**Friends Included / Wedding Guests for Hire**

**FINAL Frozen Architecture**

Consolidated after Source Fidelity Audit \#1, Red-Team Audit \#2, and
Implementation Simplicity Audit \#3

| FROZEN DESIGN NOTE: The ORIGINAL Day 4 Homework remains the sole authoritative requirements source. This document is the final minimum-safe implementation architecture after three independent audits. If an implementation conflicts with the assignment, the assignment wins. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

**Document status: ARCHITECTURE FROZEN — READY FOR CODEX**

Purpose: define the minimum safe architecture to implement the ORIGINAL
Day 4 Homework faithfully, in small Codex blocks, without unnecessary
production-grade complexity.

# 1. Source hierarchy and project goal

- Authoritative source: ORIGINAL Day 4 Homework - Wedding Guests for
  Hire.

- This architecture exists only to implement that assignment faithfully;
  if a conflict is found, the assignment wins.

- Goal: build a working fictional finance system connecting Telegram,
  Supabase, Vercel and Google Sheets.

- Supabase is the source of truth. Google Sheets is an automatically
  updated readable copy.

- Telegram and website entry paths must use the same server-side
  transaction-processing and financial logic.

- The finished application does not require an AI model or paid AI API.

# 2. Planned technology and implementation sequence

- Next.js + TypeScript for the Vercel web application and server-side
  endpoints/actions.

- Supabase/PostgreSQL for persistent authoritative data.

- Telegram Bot API for staff submissions, confirmations and decision
  notifications.

- Google Sheets API via service account for the readable synchronized
  copy.

**Mandatory first working milestone:** one real transaction must travel
Telegram -\> shared server/domain logic -\> Supabase -\> appear on
Vercel -\> synchronize to Google Sheets. Approvals, commissions,
decision notifications and the full dashboard are added only after this
vertical slice works.

**Before Test 1:** remove temporary practice financial transactions,
while preserving employees, current Telegram mappings and integration
configuration unless intentionally changed.

# 3. Actors, demonstration access and permissions

| **Employee**            | **Role**         | **Can submit**                 | **Can approve/correct**                       |
|-------------------------|------------------|--------------------------------|-----------------------------------------------|
| Svetlana de Monte Carlo | MANAGER          | No routine entry required      | Sales, commission splits, expense allocations |
| Richard Darling         | SALESPERSON      | Sales + proposed split         | Nothing                                       |
| Anastasia Ferrari       | SALESPERSON      | Sales + proposed split         | Nothing                                       |
| Jean-Claude Bērziņš     | SALESPERSON      | Sales + proposed split         | Nothing                                       |
| Kevin von Whatever      | EXPENSE_REPORTER | Expenses + proposed allocation | Nothing                                       |

- Website uses a Demonstration role selector for the five fictional
  employees; no full login system is required.

- Salespeople and Kevin see their own submissions/statuses. Svetlana
  sees all transactions and financial results.

- Website UI visibility is not the permission boundary. Server/domain
  code loads the selected employee record and derives the actual stored
  role.

- A client-supplied role string is never authoritative.

- Telegram users do not choose a fictional role; identity is resolved
  from telegram_user_id through the manager-controlled mapping.

- Denied actions cause no financial DB mutation and no false-success
  external side effect.

# 4. Telegram manager setup and identity model

- Manager area includes a Telegram Setup screen controlled by Svetlana.

- It links Telegram user ID -\> fictional employee and supports
  remapping for the assignment tests.

- An unlinked Telegram user cannot submit transactions.

- The bot never allows a user to self-assign a fictional role.

- telegram_user_id answers WHO is interacting; chat_id answers WHERE a
  message is delivered. These concepts remain separate even if their
  numeric values coincide in a private chat.

- Historical transactions are never rewritten when a Telegram mapping
  changes.

# 5. Core database model

Final core tables after three audits:

> employees  
> telegram_links  
> telegram_sessions  
> telegram_updates  
> transactions

**Design choice:** one transactions table stores SALE and EXPENSE rows.
Type-specific database constraints must prevent invalid hybrid records.
This choice is intended to provide one reference namespace, shared
integration metadata and simpler retries.

## 5.1 employees

| **Column**   | **Type / rule**                                                   |
|--------------|-------------------------------------------------------------------|
| id           | UUID primary key                                                  |
| code         | TEXT UNIQUE; SVETLANA / RICHARD / ANASTASIA / JEAN_CLAUDE / KEVIN |
| display_name | TEXT NOT NULL                                                     |
| role         | MANAGER / SALESPERSON / EXPENSE_REPORTER                          |
| active       | BOOLEAN, default true                                             |
| created_at   | TIMESTAMPTZ                                                       |

The five fictional employee rows are seeded and stable.

## 5.2 telegram_links

| Column               | Type / rule                                                                                                 |
|----------------------|-------------------------------------------------------------------------------------------------------------|
| telegram_user_id     | BIGINT primary key; current Telegram account identity                                                       |
| employee_id          | UUID FK employees, NULLABLE, UNIQUE; NULL means /start seen but manager has not linked a fictional employee |
| last_private_chat_id | BIGINT nullable; current private chat destination captured from bot interaction                             |
| updated_at           | TIMESTAMPTZ                                                                                                 |

- One Telegram user maps to at most one fictional employee at a time.

- Final design gives each fictional employee at most one current
  Telegram account, which keeps website-origin notification routing
  deterministic for this assignment.

- Remapping is a domain operation and must satisfy both uniqueness
  constraints atomically; it never alters historical transaction
  submitter/origin fields.

- No mapping_version is used. Stale wizard protection relies on
  employee_id_at_start plus an atomic final check of the current
  Telegram mapping and role before the financial transaction is
  inserted.

## 5.3 telegram_sessions

| Column               | Purpose                                        |
|----------------------|------------------------------------------------|
| telegram_user_id     | Primary key / session identity                 |
| chat_id              | Current wizard chat destination                |
| employee_id_at_start | Fictional employee resolved when wizard starts |
| flow_type            | SALE / EXPENSE                                 |
| step                 | Current wizard step                            |
| draft_payload        | JSONB draft form values                        |
| updated_at           | TIMESTAMPTZ                                    |

- Persistent session state is used because Vercel/serverless process
  memory is not durable.

- At final submission, the current telegram_links.employee_id must still
  equal employee_id_at_start and the current stored role must permit the
  requested transaction type.

- If the current mapping no longer matches the session identity, the
  stale wizard is rejected/cancelled and the user starts again.

- Critically, durable Telegram update deduplication, the final
  mapping/role check, the financial insert, and the required session
  mutation are committed atomically for that final Telegram update.

## 5.4 telegram_updates - durable update deduplication

| Column      | Purpose                                             |
|-------------|-----------------------------------------------------|
| update_id   | Telegram update ID; PRIMARY KEY / durable dedup key |
| received_at | TIMESTAMPTZ                                         |

Critical invariant: one Telegram update_id may change application state
at most once, even after a temporary wizard session has completed or
been deleted.

> Minimum mechanism: telegram_updates stores update_id as a durable
> primary key plus received_at. The claim of update_id and the state
> mutation caused by that update occur in the same database transaction.
> A replay therefore performs no second state mutation. No
> processing-status lifecycle, queue, or exactly-once message system is
> required.

## 5.5 transactions - common identity and money

| Column                  | Type / rule                                                                  |
|-------------------------|------------------------------------------------------------------------------|
| id                      | UUID primary key                                                             |
| reference               | TEXT UNIQUE NOT NULL; global transaction reference                           |
| transaction_type        | SALE / EXPENSE                                                               |
| source                  | TELEGRAM / WEBSITE                                                           |
| submitter_employee_id   | UUID FK employees NOT NULL                                                   |
| submitted_at            | TIMESTAMPTZ generated server/database-side                                   |
| origin_telegram_chat_id | BIGINT nullable; immutable snapshot for Telegram-origin submissions          |
| original_submission     | JSONB original employee proposal snapshot                                    |
| status                  | Type-compatible status                                                       |
| revision                | INTEGER NOT NULL DEFAULT 1; increment on each accepted business modification |
| description             | TEXT NOT NULL                                                                |
| amount_cents            | BIGINT \> 0                                                                  |
| created_at / updated_at | TIMESTAMPTZ                                                                  |

**Reference policy:** global uniqueness across both transaction types is
our stricter design interpretation. Outer whitespace is trimmed. The
architecture does not claim that case-insensitive equivalence is
required by the source.

**Money policy:** store euro amounts in integer cents, e.g. €1,000.00 =
100000 cents. Do not use binary floating point as authoritative money
storage.

# 6. Sale model and state machine

> CREATE SALE -\> PENDING_APPROVAL -\> APPROVED

- Required sale data: reference, automatically identified salesperson,
  customer, project A/B, description, positive amount, proposed
  Richard/Anastasia/Jean-Claude commission percentages, automatic
  submission time.

- Pending sale is visible in records but contributes zero approved
  income and zero earned commission.

- Svetlana may approve the proposed split, change the split before
  approval, and correct pending sale data under the correction policy.

- Svetlana may leave a sale pending.

- Approved sale contributes revenue and final commissions. Editing
  approved transactions is outside required assignment scope.

## 6.1 Sale correction policy

- Before approval Svetlana may correct current customer, project,
  description and amount. The employee proposed commission percentages
  remain immutable proposal fields; manager-selected final percentages
  are written only by the approval operation.

- Immutable identity/audit fields: reference, original submitter,
  source, original submission time, Telegram origin information and
  original_submission.

- Corrections affect current structured fields. original_submission
  remains the original employee proposal.

- If an approval wins a race before a correction commits, the correction
  must fail rather than modify a finalized sale.

## 6.2 Sale-specific structured fields

- customer; project A/B.

- proposed_richard_pct; proposed_anastasia_pct;
  proposed_jean_claude_pct.

- final_richard_pct; final_anastasia_pct; final_jean_claude_pct — NULL
  while pending and written only during approval.

- commission_pool_cents; richard_commission_cents;
  anastasia_commission_cents; jean_claude_commission_cents.

- approved_by_employee_id; approved_at.

For PENDING_APPROVAL: commission pool and individual commissions are
zero; approved_at/approved_by are null; final percentages are NULL and
must be blank in Google Sheets.

# 7. Commission contract

- Commission pool = 10% of the APPROVED sale amount.

- Each of the three final shares is within 0% to 100%, and their total
  is exactly 100%.

- Commission is an expense of the same project as the sale and must
  never also be entered as a separate expense transaction.

- Pool and individual amounts are rounded to cents.

- After individual rounding, any residual difference is assigned to the
  salesperson with the largest final percentage; equal-largest tie order
  is Richard, then Anastasia, then Jean-Claude.

- Individual commission cents must sum exactly to the rounded pool.

**Percentage representation:** PostgreSQL NUMERIC / exact decimal
representation is proposed; the architecture does not impose
integer-only percentages because the assignment does not state such a
limit.

Rounding convention: use exact decimal arithmetic and one deterministic
positive-currency half-cent convention (HALF-UP is acceptable). Do not
create a separate rounding subsystem; the assignment-specific residual
rule remains authoritative.

# 8. Expense model and state machine

> Proposed A/B: CREATE -\> AWAITING_ALLOCATION -\> ALLOCATED  
> Proposed COMPANY_OVERHEAD: CREATE -\> ALLOCATED immediately

- Required expense data: reference, automatically identified reporter,
  description, positive amount, category Materials/Travel/Other,
  proposed allocation A/B/Company overhead, automatic submission time.

- Every saved expense immediately reduces Company Result.

- A/B proposals wait for manager allocation and do not affect either
  project until allocated.

- Svetlana may confirm the proposed project, move to the other project,
  or move to Company overhead.

- Allocation must not reduce Company Result a second time; only
  attribution changes.

- Company-overhead proposals are automatically allocated and do not
  enter the manager allocation queue.

- Automatically allocated overhead needs only its initial Telegram
  submission confirmation, not a later allocation-decision notification.

## 8.1 Expense-specific fields

- expense_category = MATERIALS / TRAVEL / OTHER.

- proposed_allocation = A / B / COMPANY_OVERHEAD.

- final_allocation = A / B / COMPANY_OVERHEAD; null while awaiting.

- allocated_by_employee_id; allocated_at.

# 9. Original proposal vs final decision

- original_submission JSONB preserves the original employee-submitted
  proposal.

- Canonical proposed and final business fields also remain separately
  queryable, because Sheets, notifications and dashboard logic need them
  directly.

- Sale S02 example: proposed 0/50/50 remains stored even when final is
  20/40/40.

- Expense E02 example: proposed B remains stored even when final
  allocation is A.

- No custom PostgreSQL immutability trigger is required in the minimum
  design. Restricted server/domain mutation paths enforce that
  original_submission is never edited.

# 10. Database structural constraints

- reference database UNIQUE constraint is authoritative for concurrent
  duplicate submission protection.

- amount_cents \> 0 below the UI layer.

- SALE rows require sale fields and disallow expense-only fields;
  EXPENSE rows require expense fields and disallow sale-only fields.

- Status must be compatible with transaction_type.

- Proposed sale shares are in range and sum exactly 100%.

- Approved sale requires final shares and commission data consistent
  with the commission contract.

- CHECK conditions must use explicit NOT NULL/allowed-value logic rather
  than weak nullable expressions that can pass as UNKNOWN.

# 11. Financial calculations

> Project Result = Approved project sales - Project sales commissions -
> Expenses finally allocated to that project  
>   
> Company Result = All approved sales - All sales commissions - ALL
> recorded expenses

- Do not store mutable company/project result balances.

- Dashboard results are derived from authoritative transactions.

- All EXPENSE rows count in Company Result immediately, including
  AWAITING_ALLOCATION rows.

- Only ALLOCATED project expenses affect Project A or B.

- Because allocation does not create another expense row or mutate a
  stored company balance, a correct query model prevents double
  deduction.

- This also allows arbitrary instructor-added transactions to
  recalculate naturally instead of relying on hard-coded Test 1/Test 2
  totals.

# 12. Atomic and idempotent business operations

## 12.1 Create sale

1.  Resolve actor from website employee identity or Telegram mapping;
    server verifies stored role = SALESPERSON.

2.  Validate required fields, positive amount, project, reference and
    proposed split = exactly 100%.

3.  For Telegram final submit, atomically claim the Telegram update_id,
    verify current mapping and role against the session identity, insert
    the financial transaction, and update/clear the session in the same
    database transaction.

4.  Insert one SALE in PENDING_APPROVAL with zero commissions, revision
    = 1, and durable Google Sheets / submission-confirmation delivery
    intent set in the same authoritative DB mutation.

5.  Telegram source snapshots origin_telegram_chat_id and schedules
    initial confirmation only after save. Website source does not
    require an initial Telegram confirmation.

6.  If another exact reference is inserted concurrently, DB UNIQUE
    allows only one row.

## 12.2 Create expense

7.  Resolve actor and verify stored role = EXPENSE_REPORTER.

8.  Validate required fields, positive amount, category and allocation.

9.  For A/B, create AWAITING_ALLOCATION with final_allocation null.

10. For Company overhead, create ALLOCATED immediately with
    final_allocation = COMPANY_OVERHEAD.

11. For Telegram-origin expense creation, the update_id claim, current
    mapping/role validation, financial insert, session mutation and
    required delivery intent are committed atomically.

## 12.3 Correct pending sale

12. Actor must be MANAGER and row must still be PENDING_APPROVAL at the
    expected revision.

13. Update only allowed current business fields; never rewrite original
    identity/audit data or original_submission.

14. Commission remains zero until approval.

15. Any accepted correction increments revision and marks Google Sheets
    synchronization PENDING in the same DB mutation.

16. Use compare-and-set semantics: update only when status is
    PENDING_APPROVAL and revision still equals the revision read by the
    manager flow. This prevents stale correction/approval races.

## 12.4 Approve sale

17. Actor must be MANAGER and current state must be PENDING_APPROVAL.

18. Use proposed split if unchanged, otherwise the manager-selected
    final split supplied by the approval action; no manager-draft final
    split is persisted while the sale remains pending.

19. Calculate commission from the CURRENT corrected sale amount/project
    and final split.

20. Commit a one-way compare-and-set transition PENDING_APPROVAL +
    expected revision -\> APPROVED + revision+1, storing final split,
    commissions, approval audit data, Sheets sync intent, and
    decision-notification intent atomically.

21. Exactly one concurrent approval may succeed. A second attempt
    produces no financial change, no second commission and no duplicate
    downstream logical decision.

22. Only after that DB commit may Google Sheets and Telegram network
    calls run. Their success/failure is recorded independently and never
    rolls back financial approval.

## 12.5 Allocate expense

23. Actor must be MANAGER and current state AWAITING_ALLOCATION.

24. Choose final A/B/COMPANY_OVERHEAD.

25. Commit one-way conditional transition AWAITING_ALLOCATION -\>
    ALLOCATED, storing final allocation, audit data, revision+1, Sheets
    sync intent and decision-notification intent atomically.

26. A concurrent second allocation cannot alter financial totals or
    create another expense effect.

27. Company expense amount is unchanged; only project attribution
    changes.

# 13. Telegram confirmation and notification contracts

## 13.1 Initial submission confirmation

- Only sent after successful transaction save.

- Successful message includes reference, amount, project or proposed
  allocation, and current status.

- Validation failure explains what must be corrected (e.g. missing
  amount, zero amount, split total, duplicate reference, unlinked user).

- Never send a false "recorded" confirmation before the DB commit
  succeeds.

> submission_confirmation_status: NOT_REQUIRED / PENDING / SENT /
> FAILED  
> metadata: target_chat_id, last_error, sent_at. attempt_count /
> last_attempt_at are optional diagnostics, not required architecture.

## 13.2 Manager decision notification

> decision_notification_status: NOT_REQUIRED / PENDING / SENT / FAILED /
> NO_RECIPIENT  
> metadata: target_chat_id, last_error, sent_at. attempt_count /
> last_attempt_at are optional diagnostics, not required architecture.

- Sale approval message: reference, sale amount, total commission, each
  person final percentage and euro amount, and whether manager changed
  the split.

- Expense decision message: reference, amount, description, final
  allocation, and highlight any change from proposal.

- Only submitting salesperson must receive sale approval notification;
  all commission recipients need not be messaged.

- Company-overhead expense gets initial confirmation only.

# 14. Telegram routing rules

## 14.1 Telegram-origin transaction

- origin_telegram_chat_id is captured and retained on submission.

- Later manager-decision notification always targets that original chat,
  regardless of subsequent account-to-employee remapping.

- Historical submitter_employee_id and origin_telegram_chat_id never
  change.

## 14.2 Website-origin transaction

- Website submission does not snapshot a Telegram destination.

- At manager decision time, resolve submitter_employee_id -\> current
  telegram_links -\> current linked private chat.

- If a linked chat exists, store it as the decision notification target
  and attempt delivery.

- If none exists, set NO_RECIPIENT and display "No Telegram recipient
  linked" visibly on the website transaction record.

- This decision-time lookup is required by Test 2, where S03 exists
  before Jean-Claude is linked and must still notify after he is linked
  before approval.

Retry target rule: once a real decision-notification target has been
resolved and stored for the decision, retries use that same target
rather than re-resolving a later mapping.

# 15. Google Sheets contract

Exactly two tabs: Sales and Expenses.

## 15.1 Sales columns

- Reference; Submission time; Salesperson; Customer; Project;
  Description; Amount.

- Proposed Richard %; Proposed Anastasia %; Proposed Jean-Claude %.

- Approved Richard %; Approved Anastasia %; Approved Jean-Claude %.

- Richard earned commission €; Anastasia earned commission €;
  Jean-Claude earned commission €.

- Status.

Pending sale: approved percentage columns blank; earned commissions
zero.

## 15.2 Expenses columns

- Reference; Submission time; Reporter; Description; Category; Amount;
  Proposed allocation; Final allocation; Status.

- Proposed and final allocations remain separate.

## 15.3 Google infrastructure and access

28. Create Google Cloud project and enable Google Sheets API.

29. Create service account and credentials.

30. Create spreadsheet with Sales and Expenses tabs.

31. Share spreadsheet with service-account email as Editor.

32. Store credentials and spreadsheet ID in server-side Vercel
    environment/configuration.

33. Give instructor Viewer access; do not give public editing access.

34. If institution blocks service-account creation/key download,
    identify the exact restriction and contact instructor; do not
    replace required integration with manual copying.

# 16. Google Sheets synchronization and retry

> sheet_sync_status: PENDING / SYNCED / FAILED  
> minimum metadata: last_error plus a lightweight per-transaction
> sync-lock marker if needed. Operational attempt counters are optional.

35. On each sync/retry, obtain one-sync-per-transaction serialization,
    then reload the CURRENT authoritative transaction and its revision
    from Supabase.

36. Choose Sales or Expenses tab.

37. Find the row by transaction reference.

38. If found, update the same row. If absent, append one row.

39. After the Sheet write, re-check the authoritative transaction
    revision before declaring SYNCED. If revision changed during the
    write, immediately write the newest state again; on API failure keep
    financial state and mark FAILED/PENDING with retry UI.

40. Retry synchronizes the same authoritative transaction; it never
    creates another financial transaction and must not intentionally
    create another logical Sheet row.

Use only this minimum stale-write guard: one active Sheets sync per
transaction plus revision re-check. Do not introduce queues, worker
clusters, distributed outbox infrastructure or recursive sync machinery
beyond what this rule requires.

Reference-based upsert remains authoritative: find by transaction
reference, update the same row when present, append only when absent,
and never create a second logical row during approval or retry.

# 17. Failure isolation

- Financial state, durable external-delivery intent, Google Sheets
  delivery state and Telegram delivery state are separate concerns. The
  intent that a side effect is due is persisted in the same DB mutation
  as the business change that requires it.

- A valid transaction may be APPROVED while Sheets sync is FAILED and
  Telegram decision notification is FAILED.

- Sheets failure never deletes/reverts a Supabase transaction.

- Telegram failure never reverts approval/allocation.

- A failed delivery is never labelled SENT.

- Retry retries only the failed external side effect, not the original
  financial mutation.

# 18. Practice reset

- Before Test 1 remove temporary practice financial transactions, clear
  active Telegram wizard sessions, and remove practice data rows from
  the Sales and Expenses Sheets tabs while preserving the headers.

- Do not delete seeded employees, current Telegram mappings,
  Google/service configuration or application secrets unless
  intentionally reconfiguring them.

- Avoid a dangerous full-database reset command. Practice cleanup is
  explicit and scoped.

# 19. Test 1 acceptance oracle

- S01 must be submitted through the real Telegram bot while the tester
  account is linked to Richard.

- Then remap that Telegram account to Kevin and submit E01 through the
  real bot.

- S01 must retain Richard as submitter and the original chat as
  notification destination.

- S02 and E02/E03 may be entered via website using the appropriate
  demonstration roles.

- Before decisions: both sales pending; E01/E02 awaiting; E03 overhead;
  approved income and commission = 0; Project A/B results = 0; Company
  Result = -€300.

- Manager: S01 approve unchanged; S02 change 0/50/50 -\> 20/40/40 and
  approve; E01 confirm A; E02 change B -\> A and approve.

| **Measure**                  | **Project A** | **Project B** | **Company** |
|------------------------------|---------------|---------------|-------------|
| Approved income              | €1,000        | €2,000        | €3,000      |
| Commission expense           | €100          | €200          | €300        |
| Allocated project expenses   | €200          | €0            | €200        |
| Company overhead             | \-            | \-            | €100        |
| Expenses awaiting allocation | \-            | \-            | €0          |
| Result                       | €700          | €1,800        | €2,400      |

Cumulative commission earned: Richard €90; Anastasia €110; Jean-Claude
€100.

# 20. Test 2 cumulative acceptance oracle

- Keep all Test 1 records.

- Add S03, S04, S05 and E04, E05, E06, E07 through website using
  appropriate demonstration roles.

- Before S03 approval link Jean-Claude to the tester Telegram account.
  Link Kevin before relevant expense decisions.

- Manager: S03 change 40/40/20 -\> 20/30/50 and approve; S04 approve
  proposed; S05 leave pending; E04 approve B; E05 change A -\> B; E07
  leave awaiting.

- S03 notification must work even though Jean-Claude was linked only
  after the website submission and before approval.

- S05 remains pending; E07 remains awaiting and already counts in
  Company expenses.

| **Measure**                  | **Project A** | **Project B** | **Company** |
|------------------------------|---------------|---------------|-------------|
| Approved income              | €2,500        | €2,800        | €5,300      |
| Commission expense           | €250          | €280          | €530        |
| Allocated project expenses   | €200          | €340          | €540        |
| Company overhead             | \-            | \-            | €160        |
| Expenses awaiting allocation | \-            | \-            | €140        |
| Result                       | €2,050        | €2,180        | €3,930      |

Cumulative commission earned: Richard €140; Anastasia €175; Jean-Claude
€215. Reconciliation: €2,050 + €2,180 - €160 - €140 = €3,930.

# 21. Negative and resilience tests

| **Attempt**                           | **Required result**                                                                                  |
|---------------------------------------|------------------------------------------------------------------------------------------------------|
| Split 60 / 30 / 20                    | Reject because total != 100%                                                                         |
| Richard approves sale                 | Deny at processing layer                                                                             |
| Kevin submits sale                    | Deny at processing layer                                                                             |
| Expense missing amount or amount = 0  | Reject                                                                                               |
| Approve already-approved sale         | No changed totals, no duplicate commission/records                                                   |
| Submit an existing reference again    | Reject duplicate                                                                                     |
| Interrupted Sheets update             | Transaction survives; status pending/failed; retry restores same logical row without changing totals |
| Failed Telegram decision notification | Decision survives; failure visible; retry; never falsely mark sent                                   |

Denied actions must leave control totals unchanged.

# 22. Final deployment and submission contract

- Save project code in GitHub and connect the repository to Vercel.

- Final Vercel page shows the student name, working app with completed
  two-test results, Demonstration role selector, transaction forms,
  manager controls and financial dashboard.

- Page includes Telegram bot link, viewable Google Sheets link,
  instructor-accessible GitHub repository link and brief operating
  instructions.

- Instructor can enter additional transactions with different amounts;
  results must change legitimately. No hard-coded S01-S05/E01-E07-only
  behaviour or fixed €3,930 result.

- Bot tokens, passwords and private API keys stay out of browser-visible
  code, Google Sheets and GitHub.

- Submit one working Vercel URL in the student's own row of the course
  spreadsheet, in the designated Day 4 homework column. Do not modify
  anyone else's name, link or feedback.

# 23. Current critical invariants

41. Supabase is the financial source of truth.

42. One exact stored reference identifies at most one transaction
    globally.

43. A Telegram update_id may change application state at most once; the
    update_id claim and its application-state mutation are atomic.

44. Final Telegram wizard identity/role validation and financial
    transaction creation are atomic with the Telegram update claim and
    relevant session mutation.

45. Retry never creates a second financial transaction.

46. Pending sales never enter approved income and earn zero commission.

47. One sale approval has exactly one financial effect and is protected
    by PENDING_APPROVAL + expected revision compare-and-set.

48. Commission pool is 10% of the approved current sale amount.

49. Final commission shares total exactly 100%.

50. Individual earned commissions sum exactly to the rounded pool.

51. Commission belongs to the sale's final approved project and is never
    also a manual expense.

52. Every saved expense affects Company Result exactly once.

53. Awaiting allocation expense affects no project yet.

54. Allocating an expense never reduces Company Result again.

55. Company overhead is automatically allocated and bypasses the
    allocation queue.

56. Original employee proposal is never overwritten by manager
    corrections or the final manager decision; final commission
    percentages remain NULL until approval.

57. Approved/finalized transactions are not financially edited afterward
    within assignment scope.

58. Permissions are enforced server-side/processing-layer, not only by
    hidden buttons.

59. Telegram identity comes from telegram_user_id; delivery destination
    uses chat_id.

60. Telegram-origin transaction permanently retains original submitter
    and originating chat for later decision notification.

61. Website-origin manager decision resolves the submitter employee's
    current Telegram link at decision time.

62. Once an actual decision notification target is selected and stored,
    retries use that same target.

63. Sheets failure cannot invalidate Supabase financial state; Google
    sync intent is persisted atomically with the business mutation that
    requires synchronization.

64. Telegram failure cannot invalidate a valid manager decision;
    decision-notification intent is persisted atomically with that
    decision.

65. External retry retries a side effect, not the underlying financial
    operation.

66. Google Sheets maintains one logical row per transaction reference in
    the appropriate tab and uses one-sync-per-transaction plus revision
    re-check to prevent stale Pending data from overwriting newer
    Approved data.

67. Pending sale Sheets approved-split fields are blank and earned
    commissions are zero.

68. S05 may remain pending without contaminating totals.

69. E07 may remain awaiting while already reducing Company Result.

70. Financial outputs are generic derived calculations, never hard-coded
    Test 1/Test 2 constants.

71. S01 and E01 genuinely originate through the real Telegram bot.

72. Unlinked Telegram user cannot submit or self-assign role.

73. Initial Telegram confirmation occurs only after save and contains
    reference, amount, project/proposed allocation and current status.

74. NO_RECIPIENT is visible to the reviewer as "No Telegram recipient
    linked".

75. Sheets uses separate proposed, approved and individual
    earned-commission columns.

76. First Telegram -\> Supabase -\> Vercel -\> Sheets milestone must
    pass before full application build.

77. Private credentials remain server-side; authoritative financial
    mutations are performed only through the server/domain layer, never
    by direct browser writes.

# 24. Final frozen design decisions

| Frozen decision                                                       | Final rationale                                                                                                                                           |
|-----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| One transactions table                                                | Minimum-safe model: one reference namespace and shared integration state; strict type-specific constraints prevent hybrid rows.                           |
| Global exact reference uniqueness                                     | DB UNIQUE is the final duplicate barrier. Outer whitespace may be trimmed; case-insensitive equality is not invented.                                     |
| Integer cents + NUMERIC percentages                                   | Avoid binary floating money and do not invent integer-only commission shares.                                                                             |
| original_submission JSONB; no DB immutability trigger                 | Preserve original proposal while keeping implementation simple; restricted server mutation paths protect it.                                              |
| Persistent telegram_sessions; no mapping_version                      | Serverless-safe wizard state. Final current employee/role check is atomic with transaction creation.                                                      |
| telegram_updates = update_id + received_at                            | Durable duplicate-update key. Claim and resulting state mutation occur in one DB transaction; no processing lifecycle.                                    |
| telegram_links keyed by telegram_user_id; employee_id nullable UNIQUE | /start can capture chat before manager link; one current deterministic employee recipient.                                                                |
| Mandatory transaction revision                                        | Protect correction-vs-approval and stale business mutations with compare-and-set.                                                                         |
| No persisted manager-draft final split                                | Proposed split stays immutable; final percentages remain NULL until approval.                                                                             |
| Separate initial-confirmation and decision-notification states        | Different required events and retry lifecycles; only minimal metadata is mandatory.                                                                       |
| Frozen resolved decision retry target                                 | Retry the same decision delivery rather than reinterpret a later remap.                                                                                   |
| Derived financial totals                                              | No mutable company/project balances; prevents double deduction and supports arbitrary instructor data.                                                    |
| Reference-based Sheets upsert + minimal stale-write guard             | One logical row/reference; serialize sync per transaction and re-check revision before SYNCED.                                                            |
| Atomic durable external-delivery intent                               | Business mutation and required Sheets/Telegram intent are persisted together before external network calls.                                               |
| No direct browser financial writes                                    | All authoritative mutations run through server/domain logic with stored-role checks.                                                                      |
| No enterprise infrastructure                                          | No Redis, brokers, worker clusters, event sourcing, microservices or full authentication unless a concrete assignment requirement later proves otherwise. |

# 25. Codex implementation sequence

- Block A — Project foundation: Next.js + TypeScript + Supabase
  client/server boundaries, environment-variable contract,
  Git/GitHub/Vercel-ready project skeleton. No business feature
  implementation yet.

- Block B — Supabase schema and database contract: employees,
  telegram_links, telegram_sessions, telegram_updates, transactions,
  enums/checks/indexes, seeded employees, revision field and structural
  constraints.

- Block C — Shared domain/business layer: role checks, validation,
  money/percentage arithmetic, commission calculation, financial
  aggregate queries, create/correct/approve/allocate operations with
  atomic compare-and-set semantics.

- Block D — First mandatory vertical slice: real Telegram submission -\>
  shared domain -\> Supabase -\> Vercel record view -\> Google Sheets
  row. Freeze only after this works end-to-end.

- Block E — Website demonstration role selector and website sale/expense
  entry using the same domain operations.

- Block F — Manager area: Telegram setup/remapping, pending review, sale
  correction/approval and expense allocation.

- Block G — Dashboard and full Google Sheets synchronization/retry,
  including one-sync-per-transaction stale-write guard.

- Block H — Telegram initial confirmations, manager-decision
  notifications, routing rules, NO_RECIPIENT display and retry.

- Block I — Exact Test 1, then Test 2, then negative/resilience tests.
  Do not proceed while any control total differs.

- Block J — Final deployment/access/secrets/submission audit and
  instructor-facing instructions.

# 26. Freeze verdict

ARCHITECTURE FROZEN — READY FOR CODEX. No fourth general architecture
audit is planned. From this point, each Codex block must be implemented
narrowly, tested, adversarially reviewed against this document and the
ORIGINAL assignment, then frozen before the next block begins.

**Implementation rule: ORIGINAL assignment -\> Frozen Architecture -\>
narrow Codex block -\> tests/build -\> adversarial review -\> freeze
block -\> next block.**
