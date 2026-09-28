export const EMPLOYEE_ROLES = ["MANAGER", "SALESPERSON", "EXPENSE_REPORTER"] as const;
export const EMPLOYEE_CODES = ["SVETLANA", "RICHARD", "ANASTASIA", "JEAN_CLAUDE", "KEVIN"] as const;
// This order is also the authoritative commission tie priority.
export const SALESPERSON_CODES = ["RICHARD", "ANASTASIA", "JEAN_CLAUDE"] as const;
export const TRANSACTION_TYPES = ["SALE", "EXPENSE"] as const;
export const SALE_STATUSES = ["PENDING_APPROVAL", "APPROVED"] as const;
export const EXPENSE_STATUSES = ["AWAITING_ALLOCATION", "ALLOCATED"] as const;
export const PROJECTS = ["A", "B"] as const;
export const EXPENSE_CATEGORIES = ["MATERIALS", "TRAVEL", "OTHER"] as const;
export const ALLOCATIONS = ["A", "B", "COMPANY_OVERHEAD"] as const;
export const SOURCES = ["TELEGRAM", "WEBSITE"] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];
export type EmployeeCode = (typeof EMPLOYEE_CODES)[number];
export type SalespersonCode = (typeof SALESPERSON_CODES)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type SaleStatus = (typeof SALE_STATUSES)[number];
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export type Project = (typeof PROJECTS)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type Allocation = (typeof ALLOCATIONS)[number];
export type Source = (typeof SOURCES)[number];
export type CommissionSplit = Readonly<Record<SalespersonCode, string>>;
export type EarnedCommissions = Readonly<Record<SalespersonCode, number>>;
export type Commission = Readonly<{ pool_cents: number; earned_cents: EarnedCommissions }>;

// Financial projections only, not database rows or submission payloads.
type SaleBase = Readonly<{
  transaction_type: "SALE";
  amount_cents: number;
  project: Project;
  commission: Commission;
}>;
export type Sale = SaleBase & (
  | Readonly<{ status: "PENDING_APPROVAL"; final_split: null }>
  | Readonly<{ status: "APPROVED"; final_split: CommissionSplit }>
);
type ExpenseBase = Readonly<{ transaction_type: "EXPENSE"; amount_cents: number }>;
export type Expense = ExpenseBase & (
  | Readonly<{ status: "AWAITING_ALLOCATION"; proposed_allocation: Project; final_allocation: null }>
  | Readonly<{ status: "ALLOCATED"; proposed_allocation: Allocation; final_allocation: Allocation }>
);
export type FinancialTransaction = Sale | Expense;
