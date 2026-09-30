# Final release validation status

Validated on 2026-09-30 (Europe/Riga). This document records the production
validation completed after the local Block H readiness review.

## Release outcome

| Gate | Result | Evidence |
| --- | --- | --- |
| Deployment | PASS | Production deployment `dpl_Da2uBYdikjZybwigP7quzDo2nfLs` serves `https://finalproject-gray-kappa.vercel.app`. All seven required server environment-variable names were present in Vercel without exposing values. |
| Official Test 1 | PASS | Project A €700.00, Project B €1,800.00, company €2,400.00; commissions €90.00 / €110.00 / €100.00. Supabase, Telegram, dashboard, and in-place Sheets updates agreed. |
| Cumulative Official Test 2 | PASS | Final Project A €2,050.00, Project B €2,180.00, company €3,930.00; cumulative commissions €140.00 / €175.00 / €215.00. S05 remains pending €600.00 and E07 awaiting allocation €140.00. |
| Expense workflow | PASS | Allocated, reassigned, overhead, and awaiting expenses were manually exercised; every expense affects company results once, and allocation affects project results only once. |
| Telegram failure/retry | PASS | S03 decision delivery was intentionally blocked only for the linked recipient, recorded FAILED without changing finance, then retried after restoration and recorded SENT. |
| Sheets failure/retry | PASS | Only S04's exact existing row was temporarily protected, the sync recorded FAILED without financial change, protection was removed, and retry updated that same row. |
| Instructor access | PASS | A signed-out browser loaded the deployed dashboard, public GitHub repository, bot link, and Google Sheets in view-only mode. |
| Local quality gates | PASS | 485 tests, typecheck, lint, production build, client-secret scan, and `git diff --check` passed. |

## Authorized practice cleanup

Only these references were removed before Official Test 1; the corresponding
Supabase and Google Sheets rows were verified by exact reference, and no other
record changed:

- `QA_BLOCK_G_SALE_001` — Supabase ID `187cd131-297e-45f5-ac22-a681d725605f`;
  WEBSITE, APPROVED, €1,000.00.
- `QA_TELEGRAM_SALE_001` — Supabase ID `15fead09-22e8-4b51-ad6d-eded2f403ae0`;
  TELEGRAM, PENDING_APPROVAL, €1,000.00.

The read-only audit material is retained in `RELEASE_CLEANUP_SUPABASE_AUDIT.json`,
`RELEASE_CLEANUP_SHEETS_BEFORE.json`, and `RELEASE_CLEANUP_SHEETS_AFTER.json`.

## Final state

No production data was reset after Test 1. The maintained production state contains
the 12 official records and no practice transactions. `RELEASE_FINAL_AUDIT.md`
contains the deployed-reality acceptance audit. The only remaining repository action
is the user-authorized commit, push, public verification, and release tag.
