import type { EmployeeRole, ExpenseStatus, SaleStatus } from "./types";

// Callers must resolve the stored employee role; these helpers do not authenticate.
export const canSubmitSale = (role: EmployeeRole): boolean => role === "SALESPERSON";
export const canSubmitExpense = (role: EmployeeRole): boolean => role === "EXPENSE_REPORTER";
export const canApproveSale = (role: EmployeeRole, status: SaleStatus): boolean =>
  role === "MANAGER" && status === "PENDING_APPROVAL";
export const canCorrectPendingSale = canApproveSale;
export const canAllocateExpense = (role: EmployeeRole, status: ExpenseStatus): boolean =>
  role === "MANAGER" && status === "AWAITING_ALLOCATION";
export const canManageTelegramLinks = (role: EmployeeRole): boolean => role === "MANAGER";
export const canViewFinancialResults = (role: EmployeeRole): boolean => role === "MANAGER";
export function canViewTransaction(role: EmployeeRole, actorId: string, submitterId: string): boolean {
  return role === "MANAGER" || (
    (role === "SALESPERSON" || role === "EXPENSE_REPORTER") &&
    actorId.trim().length > 0 && actorId === submitterId
  );
}
