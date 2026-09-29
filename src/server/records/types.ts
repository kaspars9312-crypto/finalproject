import "server-only";
import type { Allocation, EmployeeCode, EmployeeRole, ExpenseCategory, Project } from "../../domain/types";

export interface Employee {
  id: string; code: EmployeeCode; display_name: string; role: EmployeeRole; active: boolean;
}
export interface TransactionView {
  id: string; reference: string; transaction_type: "SALE" | "EXPENSE"; revision: number;
  submitter_employee_id: string; submitter_name: string; submitted_at: string;
  description: string; amount_cents: string; customer: string | null; project: Project | null;
  proposed_richard_pct: string | null; proposed_anastasia_pct: string | null; proposed_jean_claude_pct: string | null;
  final_richard_pct: string | null; final_anastasia_pct: string | null; final_jean_claude_pct: string | null;
  richard_commission_cents: string | null; anastasia_commission_cents: string | null; jean_claude_commission_cents: string | null;
  expense_category: ExpenseCategory | null; proposed_allocation: Allocation | null; final_allocation: Allocation | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "AWAITING_ALLOCATION" | "ALLOCATED";
  sheet_sync_status: "PENDING" | "FAILED" | "SYNCED"; sheet_synced_revision: number | null; sheet_last_error: string | null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Fail closed if the exact SQL wire contract ever regresses to JSON numbers. */
export function parseTransaction(value: unknown): TransactionView {
  if (!value || typeof value !== "object") throw new Error("Invalid transaction projection.");
  const row = value as TransactionView;
  if (!isUuid(row.id) || !isUuid(row.submitter_employee_id) || !Number.isInteger(row.revision) || row.revision < 1 ||
    !["reference", "submitter_name", "submitted_at", "description"].every(key => typeof (value as Record<string, unknown>)[key] === "string") ||
    !["PENDING", "FAILED", "SYNCED"].includes(row.sheet_sync_status)) throw new Error("Invalid transaction projection.");
  const cents = (v: unknown) => typeof v === "string" && /^\d+$/.test(v);
  const pct = (v: unknown) => typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v);
  if (!cents(row.amount_cents) || BigInt(row.amount_cents) <= BigInt(0)) throw new Error("Invalid exact money.");
  if (row.transaction_type === "SALE") {
    if (!["PENDING_APPROVAL", "APPROVED"].includes(row.status) || typeof row.customer !== "string" || !["A", "B"].includes(row.project ?? "") ||
      ![row.proposed_richard_pct, row.proposed_anastasia_pct, row.proposed_jean_claude_pct].every(pct) ||
      ![row.richard_commission_cents, row.anastasia_commission_cents, row.jean_claude_commission_cents].every(cents) ||
      ![row.final_richard_pct, row.final_anastasia_pct, row.final_jean_claude_pct].every(v => row.status === "APPROVED" ? pct(v) : v === null)) {
      throw new Error("Invalid exact sale.");
    }
  } else if (row.transaction_type !== "EXPENSE" || !["AWAITING_ALLOCATION", "ALLOCATED"].includes(row.status) ||
    !["MATERIALS", "TRAVEL", "OTHER"].includes(row.expense_category ?? "") ||
    !["A", "B", "COMPANY_OVERHEAD"].includes(row.proposed_allocation ?? "") ||
    (row.status === "AWAITING_ALLOCATION" ? row.final_allocation !== null : !["A", "B", "COMPANY_OVERHEAD"].includes(row.final_allocation ?? ""))) {
    throw new Error("Invalid expense.");
  }
  return row;
}
