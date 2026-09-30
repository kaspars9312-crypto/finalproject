# Block H dashboard and final submission readiness

## 1. Scope, baseline and Git state

Only the user-invoked `D:/CODEX_BLOCK_H_DASHBOARD_FINAL_READINESS (1).md`
is implemented. It was read completely, together with the original assignment,
frozen architecture and A–G contracts. Historical commit, setup, cleanup and
deployment instructions in those documents are not authorization to perform them
in this block. The revised block sequence follows the supplied H specification.
No material conflict with frozen business semantics was found.

Baseline and final HEAD: `0d28d6b6c3fe1276ac8290b028513f47160ea7db`, branch `main`.
Initial status: six untracked review ZIPs for A/B/C/D/E/G; tracked tree clean.
Final status: the nine H files below modified/new, plus those same six untouched ZIPs.
Nothing staged or committed. `.env.local` is ignored and untouched. Tracked-file
checks found no local env, credential files, configured private values or review ZIPs.

Supplied live baseline, not re-tested here: Block G migration applied; SQL QA passed
with all five application tables restored after rollback; Vercel deployment live;
website sale → Supabase → Svetlana split/approval → same Sheets row update → Telegram
decision verified. Expense workflow has automated/SQL coverage but was NOT manually
live-tested. Earlier contracts preserve their historical review-time limitations.

## 2. Files modified or created

Modified:

- `README.md`
- `src/app/page.tsx`
- `src/app/globals.css`

Created:

- `src/app/financial-dashboard.tsx`
- `src/app/submission-info.tsx`
- `src/server/dashboard/read.ts`
- `src/server/dashboard/read.test.ts`
- `src/server/dashboard/fixtures.test-support.ts`
- `docs/BLOCK_H_DASHBOARD_CONTRACT.md`

No dependencies, environment variables, lockfiles, existing tests, financial
operations, domain modules, integrations, previous contracts or migrations changed.

## 3. Migration decision

No migration or new RPC is needed. Block F's existing service-only
`read_visible_transactions` provides all current financial fields required.
Its projection omits `commission_pool_cents`, but the schema constrains that pool
to the exact sum of the three stored individual commissions. The adapter sums those
stored cents; Block C verifies each stored commission against the approved current
amount and final split with its frozen rounding rules. This avoids duplicating
the finance engine or changing the read/Sheets contract.

## 4. Data source

`readDashboardRecords(employeeId)` calls the existing `readVisibleTransactions`
once. The same authorized Supabase snapshot supplies records and dashboard.
Exact SQL cent strings are range-checked before conversion to safe integer cents.
Only current financial fields enter the frozen `aggregateDashboard` implementation.
Duplicate snapshot identities/references, inconsistent commissions and unsafe
amounts/totals fail closed to a fixed dashboard-unavailable message. Existing record
cards remain available when only dashboard calculation fails.

## 5. Authorization

The SQL read resolves and locks the active stored employee, filtering own/all rows.
The existing server read independently checks actor identity/activity/role and row
visibility. H calls `canViewFinancialResults` on that resolved actor; only MANAGER
gets aggregate data. Non-managers receive `dashboard: null`, with their own records.
No client role string, code/name inference, browser calculation, new public endpoint,
Server Action for aggregates, privileged client access or public grant is added.
The adapter and financial component import `server-only`.

The required fictional selector still permits any visitor to deliberately select
Svetlana. This is demonstration-role authorization, not authentication of real people.

## 6–9. Calculation paths

All paths use `src/domain/finance.ts` unchanged:

- **6. Project A:** approved current A sale income minus those sales' commissions
  minus expense rows finally allocated to A.
- **7. Project B:** the same rule for B, independent of original proposals.
- **8. Company:** all approved income minus all approved commissions minus every
  recorded expense once. Allocated project expenses, overhead and awaiting amounts
  are displayed separately. Combined project results less overhead and awaiting
  amounts reconcile to the company result.
- **9. Salespeople:** sum validated persisted final commissions for Richard,
  Anastasia and Jean-Claude. Total equals company commission expense.

The React component only formats values as euros with two decimals, including a
visible minus sign, and renders them. It contains no financial formulas or fixtures.

## 10–13. States and persistence

- **10. Pending sale:** retained in records and pending count/value, excluded from
  approved income and all earned commissions.
- **11. Awaiting allocation:** reduces company result immediately, affects neither
  project, and appears in awaiting count/value. Allocation moves attribution on the
  same row and cannot deduct company expense again.
- **12. Overhead:** reduces company result once and neither project. This includes
  an A/B proposal later finalized as overhead.
- **13. Refresh:** the existing `force-dynamic` page reads Supabase on every request.
  There is no cached balance or browser memory aggregation. Existing website actions
  revalidate `/` after operations. External changes become visible on refresh.
  Repeated read tests reproduce the same totals; changed persisted snapshots change
  the totals. Real browser/database refresh remains a post-deployment live check.

## 14–16. Submission shell

The existing page gains a compact visible submission area and expandable six-step
usage instructions. The role selector, forms, manager queues, link setup, record
cards and delivery controls remain intact. Project A/B/Company use a responsive
card grid; cumulative commissions use a semantic table with row/column headings.
No chart library or overall redesign was introduced.

**15. Exact links:** ordinary labeled anchors, each with `target="_blank"` and
`rel="noopener noreferrer"`, containing no credential query parameters:

- Telegram bot: https://t.me/friends_included_final_bot
- Google Sheets transactions: https://docs.google.com/spreadsheets/d/1Q8_NLiBBNTiDLmSAhnhs7ddAKkJU8xiHbRyN-CNdTMk/edit
- GitHub repository: https://github.com/kaspars9312-crypto/finalproject

**16. Student:** `Student: Kaspars Bickovs`, rendered by `SubmissionInfo`.
No unrelated personal information or environment values are displayed.
Link reachability and instructor access permissions were not verified or modified.

## 17–18. Official regression results

All official fixtures live only in test code. They include the supplied customers,
descriptions, categories, submitters, proposed/final splits and allocations. They
are mocked RPC snapshots, never inserted into any database or integration.
Expected commissions are literal test data, independent of the tested mapper.

**17. Test 1 PASS:** A income/commission/expenses/result = €1000.00/€100.00/€200.00/€700.00;
B = €2000.00/€200.00/€0.00/€1800.00. Company income €3000.00, commission €300.00,
allocated project expenses €200.00, overhead €100.00, awaiting €0.00, result €2400.00.
Earned Richard/Anastasia/Jean-Claude = €90.00/€110.00/€100.00; total €300.00.
Before decisions PASS: both projects, income and commissions zero; company −€300.00;
two pending sales worth €3000.00, two awaiting expenses worth €200.00 and €100.00 overhead.

**18. Cumulative Test 2 PASS:** A = €2500.00/€250.00/€200.00/€2050.00;
B = €2800.00/€280.00/€340.00/€2180.00. Company income €5300.00, commission €530.00,
allocated expenses €540.00, overhead €160.00, awaiting €140.00, result €3930.00.
Earned = €140.00/€175.00/€215.00; total €530.00. S05 remains pending €600.00;
E07 remains awaiting €140.00. Reconciliation €2050.00 + €2180.00 − €160.00 − €140.00
= €3930.00 passes through the real read adapter and frozen domain code.

## 19. Rule-enforcement regression coverage

Existing domain, operation, website, Sheets and Telegram tests remain unchanged:
60/30/20 rejection; Richard approval denial; Kevin sale denial; missing/zero expense
rejection; duplicate reference rejection; stale/repeated approval refusal; metadata-only
delivery retry without replaying finance. Actual database constraints, role checks
and CAS have existing SQL QA; H does not claim new live database execution.

The 31 new H cases directly prove official pre/post decisions and cumulative totals,
manager-only data and markup, spoofed roles/excess RPC rows, inactive/invalid actors,
malformed/repeated/unknown identity requests, all required markup/links, repeat reads,
arbitrary renamed references and an instructor expense, empty data, pending exclusion,
allocation to A/B/overhead without double deduction, current corrected financial
state over audit data, Sheets retry metadata independence, Telegram/decision retry
metadata independence, numeric limits, inconsistent commissions and duplicate rows.
No new financial mutation implementation or redundant mutation test engine was added.

## 20–22. Quality gates and SQL QA

| Gate | Result |
| --- | --- |
| 20. `pnpm test` | PASS — 485 tests in 16 files; 454 preserved plus 31 new. |
| 21. `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS, zero warnings. |
| `pnpm build` | PASS; `/` and Telegram webhook remain dynamic. |
| `node scripts/check-client-secrets.mjs` | PASS — 11 browser assets, no private names/configured values. |
| `git diff --check` | PASS. |
| Frozen implementation/contracts/dependencies diff | Empty. |
| Staged diff | Empty. |
| 22. Migration/SQL QA | No new migration or SQL QA required; no remote execution. |

Vitest and build hit the inherited Windows sandbox worker-spawn EPERM and passed
with approved execution outside the sandbox. No application workaround was added.
Tests mock DB/RPC boundaries and forbid real fetch. Server-rendered markup is tested;
this is not a deployed browser test. Git's LF-to-CRLF notices are informational.

## 23–25. Deferred work, unverified runtime and risks

**23. Deferred:** review/commit/deploy, scoped practice cleanup, manual official
Test 1/Test 2, final course submission and external access verification. No practice
row was deleted. No S01–S05/E01–E07 entered production. Full authentication, workers,
new retry infrastructure and bidirectional Sheets behavior remain out of scope.

**24. Not verified here:** deployed H rendering, real browser interactions/responsive
visual inspection, live Supabase refresh/authorization, actual Google/Telegram delivery,
instructor link permissions and concurrent database sessions. Expense workflow was
not manually live-tested. Supplied prior sale/Block G live successes are baseline
information only, not newly executed checks.

**25. Known risks/limits:** intentionally unauthenticated demo identities; full reads
for a small demonstration dataset; safe-integer monetary ceiling (invalid/overflow
totals fail visibly); separate workflow read may observe a later moment than the
records/dashboard snapshot. Inherited integration limits remain: interrupted ownership
claims need operator recovery, external timeouts may have uncertain outcomes, and
manual Sheets row editing can race synchronization. No new known implementation blocker.

## 26. Acceptance review of all 40 criteria

PASS means local implementation/review readiness, not completion of deferred live tests.

| # | Criterion | Review |
| --- | --- | --- |
| 1 | A–G frozen behavior intact | PASS — frozen paths unchanged; 454 existing tests pass. |
| 2 | Block G live functionality preserved | PASS — existing operations/workflow/integrations unchanged. |
| 3 | Svetlana financial dashboard | PASS — active stored manager gate. |
| 4 | No non-manager aggregate response | PASS — server gate and crafted-query tests. |
| 5 | Dynamic A income | PASS — current approved rows. |
| 6 | Dynamic A commissions | PASS — validated final commissions. |
| 7 | Dynamic A expenses | PASS — final A allocations. |
| 8 | Correct A result | PASS — frozen aggregate and exact oracles. |
| 9 | Dynamic B income | PASS — current approved rows. |
| 10 | Dynamic B commissions | PASS — validated final commissions. |
| 11 | Dynamic B expenses | PASS — final B allocations. |
| 12 | Correct B result | PASS — frozen aggregate and exact oracles. |
| 13 | Dynamic company income | PASS — all approved sales. |
| 14 | Dynamic company commissions | PASS — all approved commissions. |
| 15 | Allocated project expenses shown | PASS — separate company measure. |
| 16 | Overhead shown | PASS — separate company measure. |
| 17 | Awaiting expenses shown | PASS — amount plus count. |
| 18 | Correct company result | PASS — all saved expenses counted once. |
| 19 | Richard commission | PASS — cumulative table. |
| 20 | Anastasia commission | PASS — cumulative table. |
| 21 | Jean-Claude commission | PASS — cumulative table. |
| 22 | Total earned commission | PASS — total row. |
| 23 | Pending sales excluded | PASS — direct read-path test. |
| 24 | Awaiting affects company only | PASS — direct state/oracle tests. |
| 25 | Overhead affects company only | PASS — automatic and reassigned coverage. |
| 26 | No double count on decisions | PASS — frozen one-way operations; allocation read tests. |
| 27 | Persistent refresh | PASS — dynamic Supabase reads/repeated snapshot test; live check deferred. |
| 28 | Official Test 1 regression | PASS — before/after exact assertions. |
| 29 | Official cumulative Test 2 | PASS — all measures and reconciliation. |
| 30 | No runtime official answers | PASS — fixtures/assertions in tests only. |
| 31 | Visible student name | PASS — Kaspars Bickovs. |
| 32 | Visible safe Telegram link | PASS — supplied anchor. |
| 33 | Visible safe Sheets link | PASS — supplied anchor; instructor access unverified. |
| 34 | Visible safe GitHub link | PASS — supplied anchor; instructor access unverified. |
| 35 | Brief instructions | PASS — compact six steps. |
| 36 | Existing controls retained | PASS — additive page changes. |
| 37 | No secret exposure | PASS — server-only boundary and browser asset scan. |
| 38 | All quality gates | PASS — results above. |
| 39 | No official production fixture mutation | PASS — tests only, no production calls. |
| 40 | No automatic commit/deploy | PASS — HEAD unchanged; uncommitted review files. |

## 27. Final release validation addendum

This addendum supersedes the review-time deferred-live-work statements above. It
does not change the implementation or architecture described in this contract.

The authorized production deployment was completed, followed by manual Official
Test 1, cumulative Official Test 2, Expense workflow, scoped Telegram and Google
Sheets failure/retry checks, and signed-out instructor access verification. The
official records are intentionally retained in their cumulative end state:

- Project A result: €2,050.00; Project B result: €2,180.00; company result:
  €3,930.00.
- Cumulative earned commission: Richard €140.00, Anastasia €175.00, Jean-Claude
  €215.00.
- S05 remains pending at €600.00; E07 remains awaiting allocation at €140.00.

All 40 acceptance criteria now have deployed-reality PASS evidence in
`RELEASE_FINAL_AUDIT.md`. The original criteria 39 and 40 continue to pass because
official records, deployment, commit, and tag actions occurred only through explicit
user direction; no fixture, deployment, or Git mutation is automatic.

BLOCK H READY FOR SUBMISSION
