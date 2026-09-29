import type { Employee, TransactionView } from "../records/types";
export const employees: Employee[] = [
  { id: "11111111-1111-4111-8111-111111111111", code: "SVETLANA", display_name: "Svetlana de Monte Carlo", role: "MANAGER", active: true },
  { id: "22222222-2222-4222-8222-222222222222", code: "RICHARD", display_name: "Richard Darling", role: "SALESPERSON", active: true },
  { id: "33333333-3333-4333-8333-333333333333", code: "ANASTASIA", display_name: "Anastasia Ferrari", role: "SALESPERSON", active: true },
  { id: "44444444-4444-4444-8444-444444444444", code: "JEAN_CLAUDE", display_name: "Jean-Claude Bērziņš", role: "SALESPERSON", active: true },
  { id: "55555555-5555-4555-8555-555555555555", code: "KEVIN", display_name: "Kevin von Whatever", role: "EXPENSE_REPORTER", active: true },
];
export const sale: TransactionView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "Practice / sale", transaction_type: "SALE", revision: 1,
  submitter_employee_id: employees[1].id, submitter_name: employees[1].display_name, submitted_at: "2026-09-28T12:00:00+00:00",
  description: "Wedding guests", amount_cents: "12345", customer: "Customer", project: "A",
  proposed_richard_pct: "12.5", proposed_anastasia_pct: "37.5", proposed_jean_claude_pct: "50",
  final_richard_pct: null, final_anastasia_pct: null, final_jean_claude_pct: null,
  richard_commission_cents: "0", anastasia_commission_cents: "0", jean_claude_commission_cents: "0",
  expense_category: null, proposed_allocation: null, final_allocation: null,
  status: "PENDING_APPROVAL", sheet_sync_status: "PENDING", sheet_synced_revision: null, sheet_last_error: null,
};
export const expense: TransactionView = { ...sale, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", reference: "Practice / expense",
  transaction_type: "EXPENSE", submitter_employee_id: employees[4].id, submitter_name: employees[4].display_name,
  customer: null, project: null, proposed_richard_pct: null, proposed_anastasia_pct: null, proposed_jean_claude_pct: null,
  richard_commission_cents: null, anastasia_commission_cents: null, jean_claude_commission_cents: null,
  status: "AWAITING_ALLOCATION", expense_category: "TRAVEL", proposed_allocation: "B" };
export const approved: TransactionView = { ...sale, revision: 2, status: "APPROVED", final_richard_pct: "20",
  final_anastasia_pct: "40", final_jean_claude_pct: "40", richard_commission_cents: "247",
  anastasia_commission_cents: "494", jean_claude_commission_cents: "494" };
