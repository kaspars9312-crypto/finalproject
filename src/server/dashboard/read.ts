import "server-only";
import { aggregateDashboard, type DashboardTotals } from "../../domain/finance";
import { canViewFinancialResults } from "../../domain/roles";
import type { FinancialTransaction } from "../../domain/types";
import { sumCents } from "../../domain/validation";
import { readVisibleTransactions } from "../records/read";
import type { TransactionView } from "../records/types";

export interface FinancialDashboard {
  totals: DashboardTotals;
  pendingSales: { count: number; amount_cents: number };
  awaitingExpenses: { count: number; amount_cents: number };
}
export const DASHBOARD_ERROR = "Financial dashboard is unavailable. Check the saved financial records and refresh.";

function cents(value: string | null): number {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Invalid exact financial amount.");
  }
  return Number(value);
}

/** Map current persisted fields only; Block C validates states and rounding. */
function financialRecord(t: TransactionView): FinancialTransaction {
  const amount_cents = cents(t.amount_cents);
  if (t.transaction_type === "SALE") {
    const earned_cents = { RICHARD: cents(t.richard_commission_cents),
      ANASTASIA: cents(t.anastasia_commission_cents), JEAN_CLAUDE: cents(t.jean_claude_commission_cents) };
    // The frozen read omits the pool. The DB constrains it to this exact sum;
    // aggregateDashboard also checks each stored commission against Block C.
    const commission = { pool_cents: sumCents(Object.values(earned_cents), "stored commission pool"), earned_cents };
    const base = { transaction_type: "SALE" as const, amount_cents, project: t.project!, commission };
    return t.status === "PENDING_APPROVAL" ? { ...base, status: "PENDING_APPROVAL", final_split: null }
      : { ...base, status: "APPROVED", final_split: { RICHARD: t.final_richard_pct!,
        ANASTASIA: t.final_anastasia_pct!, JEAN_CLAUDE: t.final_jean_claude_pct! } };
  }
  const base = { transaction_type: "EXPENSE" as const, amount_cents };
  return t.status === "AWAITING_ALLOCATION"
    ? { ...base, status: "AWAITING_ALLOCATION", proposed_allocation: t.proposed_allocation as "A" | "B", final_allocation: null }
    : { ...base, status: "ALLOCATED", proposed_allocation: t.proposed_allocation!, final_allocation: t.final_allocation! };
}

/** One authorized Supabase snapshot supplies both record cards and dashboard.
 * No caller-provided role or records, cache, mutation, or browser action. */
export async function readDashboardRecords(employeeId: string) {
  const records = await readVisibleTransactions(employeeId);
  let dashboard: FinancialDashboard | null = null;
  let dashboardError: string | null = null;
  if (records.actor.active && canViewFinancialResults(records.actor.role)) {
    try {
      const rows = records.transactions;
      if (new Set(rows.map(t => t.id)).size !== rows.length || new Set(rows.map(t => t.reference)).size !== rows.length) {
        throw new Error("Duplicate financial records.");
      }
      const financial = rows.map(financialRecord);
      const pending = financial.filter(t => t.status === "PENDING_APPROVAL");
      const awaiting = financial.filter(t => t.status === "AWAITING_ALLOCATION");
      dashboard = { totals: aggregateDashboard(financial),
        pendingSales: { count: pending.length, amount_cents: sumCents(pending.map(t => t.amount_cents), "pending sales") },
        awaitingExpenses: { count: awaiting.length, amount_cents: sumCents(awaiting.map(t => t.amount_cents), "awaiting expenses") } };
    } catch { dashboardError = DASHBOARD_ERROR; }
  }
  return { ...records, dashboard, dashboardError };
}
