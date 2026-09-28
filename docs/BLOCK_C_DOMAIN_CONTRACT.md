# Block C domain contract

Baseline: `4e3df8f` (`chore: freeze block B database schema`), following Block A commit `191e750`. The initial migration, Block B contract, original assignment, frozen architecture and application foundation remain unchanged. Existing review ZIPs are preserved as untracked artifacts. Block C changes remain uncommitted for review.

The supplied `D:/CODEX_BLOCK_C_DOMAIN_RULES (1).md` narrows this block to pure domain logic and tests. The architecture's broader operation plan remains deferred: no database reads/writes, atomic approval/allocation operations, API, UI, Telegram, Sheets or deployment implementation is included.

## Public domain modules

| File | Contract |
| --- | --- |
| `src/domain/types.ts` | Stable roles, employee codes, salesperson tie order, transaction types/statuses, projects, categories, allocations and sources; decimal-string split; integer-cent commission; discriminated sale/expense financial projections. |
| `src/domain/validation.ts` | `DomainError` with code, field and English correction message; `requiredText`, case-preserving `normalizeReference`, `assertCents`, exact intermediate `sumCents`. |
| `src/domain/commission.ts` | `validateCommissionSplit`, `calculateCommissionPool`, `allocateCommission`, `calculateCommission`. |
| `src/domain/finance.ts` | `saleContribution`, `expenseContribution`, `aggregateDashboard`; project/company totals and earned commissions, all integer cents. |
| `src/domain/roles.ts` | Sale/expense submission, pending sale approval/correction, awaiting expense allocation, manager link management, financial visibility and own-transaction visibility. |

## Arithmetic and inputs

Percentages must be plain decimal strings. All three named shares are required, each in [0,100], and their exact total must be 100. Zero and fractional percentages are supported. Outer whitespace is trimmed; exponent notation, nonfinite values, percentage symbols, nonnumeric strings and JavaScript number inputs are rejected.

`decimal.js` performs authoritative percentage arithmetic. Local Decimal constructors use input-length-based precision plus 32 digits, sufficient for exact addition and safe-integer-cent multiplication/division by 100. The pool is exact sale cents divided by 10, rounded to integer cents with ROUND_HALF_UP. Individual amounts use the already-rounded pool and the same rounding mode.

The entire signed residual (pool minus rounded individual sum) goes to the greatest final percentage. Strict comparison in Richard, Anastasia, Jean-Claude order resolves largest-share ties. Final individual amounts must be nonnegative safe integer cents and sum exactly to the pool.

Money inputs and outputs use safe JavaScript integer cents, at most `Number.MAX_SAFE_INTEGER` in magnitude; transaction amounts must be positive. BigInt intermediate sums avoid binary precision loss before range checking. Unsafe inputs or aggregate totals throw structured errors. This intentionally supports a smaller money range than PostgreSQL BIGINT. Future database adapters must preserve NUMERIC percentages as exact strings and reject unsafe BIGINT-to-number conversions.

References are trimmed and retain case and arbitrary content. Duplicate detection remains the database UNIQUE constraint's job. Text helpers trim and reject empty customer/description values without imposing reference formats.

## Financial projection boundary

`Sale` and `Expense` are minimal financial projections, not full database rows or submission payloads. They omit identity, audit and delivery metadata. No database mapper is implemented here.

Sales require current amount/project and commission data. Pending sales require null final split and zero stored commissions and contribute zero. Approved sales require a valid final split and stored amounts matching recalculation, including individual residual allocation. Missing or inconsistent data is rejected, never reconstructed from proposals.

Every expense contributes its amount to company expenses. Awaiting A/B proposals affect neither project; final A/B allocations affect that project only; overhead affects no project. Automatic overhead must already be allocated to overhead. Allocating an existing expense changes attribution, never its company expense amount.

`aggregateDashboard` derives fresh totals from one collection of current transaction records. It expects each logical transaction once, not an event history or duplicate query rows; it does not perform reference deduplication. Repeated calls do not accumulate prior balances. Project results subtract project commissions and final project expenses. Company result subtracts all commissions and all recorded expenses. Combined project results less overhead and awaiting allocation reconcile to company result.

Permission helpers require a caller-resolved stored role; they do not authenticate a user or authorize a database mutation. Manager financial decisions are allowed only in pending/awaiting states. Managers cannot submit sales or expenses; salespeople and expense reporters submit only their respective types and see their own transaction status.

## Tests and verified oracles

Four colocated test files cover exact decimal validation, cent boundaries, positive and negative residuals, every largest-share tie pair, 2,079 deterministic split/pool combinations, roles, arbitrary references, inconsistent records, allocation invariants, input preservation and the full assignment oracles. All fixtures exist only in test code.

Amounts below are euros; assertions use literal integer cents.

| Measure | Test 1 A | Test 1 B | Test 1 company | Test 2 A | Test 2 B | Test 2 company |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Approved income | 1,000 | 2,000 | 3,000 | 2,500 | 2,800 | 5,300 |
| Commission | 100 | 200 | 300 | 250 | 280 | 530 |
| Allocated project expenses | 200 | 0 | 200 | 200 | 340 | 540 |
| All recorded expenses | — | — | 300 | — | — | 840 |
| Overhead | — | — | 100 | — | — | 160 |
| Awaiting allocation | — | — | 0 | — | — | 140 |
| Result | 700 | 1,800 | 2,400 | 2,050 | 2,180 | 3,930 |

Earned commissions (Richard / Anastasia / Jean-Claude): Test 1 = 90 / 110 / 100; cumulative Test 2 = 140 / 175 / 215. Test 2 reconciliation: 2,050 + 2,180 - 160 - 140 = 3,930.

Test 1 before decisions: approved income and commissions zero; both project results zero; company expenses 300; overhead 100; awaiting 200; company result -300; earned commissions zero. Separate tests prove S05 contributes nothing to totals and E07 immediately reduces company result by 140 without affecting a project.

## Verification and scope

- `pnpm test`: PASS, 137 tests across four files.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS, zero warnings.
- `pnpm build`: PASS; only the existing static foundation and not-found routes.
- Tests and build initially encountered Windows sandbox child-process `EPERM`; both passed when rerun with approved execution outside the sandbox. No application workaround was introduced.
- Added runtime `decimal.js` 10.6.0 and development `vitest` 5.0.2, with their lockfile dependencies; no dependencies removed.
- Frozen migration/source/application paths have no diff from `4e3df8f`.
- No external APIs, real secrets, persistent test data or later-block functionality introduced.

All 20 Block C acceptance criteria pass. No unresolved Block C correctness issue is known. Future integration must respect the documented numeric and projection boundaries; this block does not claim database or end-to-end integration validation. Existing ESLint deprecation is inherited from the foundation and does not fail lint.
