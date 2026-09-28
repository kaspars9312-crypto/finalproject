import { calculateCommission } from "./commission";
import { ALLOCATIONS, PROJECTS, SALESPERSON_CODES, type EarnedCommissions, type Expense, type FinancialTransaction, type Project, type Sale, type SalespersonCode } from "./types";
import { assertCents, DomainError, sumCents } from "./validation";

export interface ProjectTotals {
  approved_income_cents: number;
  commission_expense_cents: number;
  allocated_expenses_cents: number;
  result_cents: number;
}
export interface CompanyTotals {
  approved_income_cents: number;
  total_commissions_cents: number;
  all_recorded_expenses_cents: number;
  allocated_project_expenses_cents: number;
  company_overhead_cents: number;
  awaiting_allocation_cents: number;
  result_cents: number;
}
export interface DashboardTotals {
  projects: Record<Project, ProjectTotals>;
  company: CompanyTotals;
  earned_commissions_cents: Record<SalespersonCode, number>;
}

function invalidState(field: string): never {
  throw new DomainError("INVALID_STATE", field, `Invalid financial transaction ${field}.`);
}
function zeroEarned(): Record<SalespersonCode, number> {
  return { RICHARD: 0, ANASTASIA: 0, JEAN_CLAUDE: 0 };
}

export function saleContribution(sale: Sale): {
  project: Project;
  approved_income_cents: number;
  commission_expense_cents: number;
  result_cents: number;
  earned_commissions_cents: EarnedCommissions;
} {
  if (sale.transaction_type !== "SALE") invalidState("transaction_type");
  assertCents(sale.amount_cents, "amount_cents");
  if (!PROJECTS.includes(sale.project)) invalidState("project");
  if (!sale.commission || !sale.commission.earned_cents) invalidState("commission");
  assertCents(sale.commission.pool_cents, "pool_cents", true);
  for (const person of SALESPERSON_CODES) {
    assertCents(sale.commission.earned_cents[person], person, true);
  }
  if (sale.status === "PENDING_APPROVAL") {
    if (sale.final_split !== null || sale.commission.pool_cents !== 0 ||
        SALESPERSON_CODES.some((person) => sale.commission.earned_cents[person] !== 0)) {
      invalidState("pending commission");
    }
    return { project: sale.project, approved_income_cents: 0, commission_expense_cents: 0,
      result_cents: 0, earned_commissions_cents: zeroEarned() };
  }
  if (sale.status !== "APPROVED") invalidState("status");
  // Never fall back to proposed percentages or silently repair stored amounts.
  const expected = calculateCommission(sale.amount_cents, sale.final_split);
  if (expected.pool_cents !== sale.commission.pool_cents ||
      SALESPERSON_CODES.some((person) => expected.earned_cents[person] !== sale.commission.earned_cents[person])) {
    throw new DomainError("COMMISSION_MISMATCH", "commission", "Stored commission does not match the sale amount and final split.");
  }
  return {
    project: sale.project,
    approved_income_cents: sale.amount_cents,
    commission_expense_cents: expected.pool_cents,
    result_cents: sumCents([sale.amount_cents, -expected.pool_cents], "sale result"),
    earned_commissions_cents: { ...expected.earned_cents },
  };
}

export function expenseContribution(expense: Expense) {
  if (expense.transaction_type !== "EXPENSE") invalidState("transaction_type");
  assertCents(expense.amount_cents, "amount_cents");
  if (!ALLOCATIONS.includes(expense.proposed_allocation)) invalidState("proposed_allocation");
  const contribution = {
    company_expenses_cents: expense.amount_cents,
    project_expenses_cents: { A: 0, B: 0 },
    company_overhead_cents: 0,
    awaiting_allocation_cents: 0,
  };
  if (expense.status === "AWAITING_ALLOCATION") {
    if (expense.final_allocation !== null || !PROJECTS.includes(expense.proposed_allocation)) {
      invalidState("awaiting allocation");
    }
    contribution.awaiting_allocation_cents = expense.amount_cents;
  } else if (expense.status === "ALLOCATED") {
    if (!ALLOCATIONS.includes(expense.final_allocation) ||
        (expense.proposed_allocation === "COMPANY_OVERHEAD" && expense.final_allocation !== "COMPANY_OVERHEAD")) {
      invalidState("final_allocation");
    }
    if (expense.final_allocation === "COMPANY_OVERHEAD") {
      contribution.company_overhead_cents = expense.amount_cents;
    } else {
      contribution.project_expenses_cents[expense.final_allocation] = expense.amount_cents;
    }
  } else invalidState("status");
  return contribution;
}

export function aggregateDashboard(transactions: readonly FinancialTransaction[]): DashboardTotals {
  const project = (): ProjectTotals => ({ approved_income_cents: 0, commission_expense_cents: 0,
    allocated_expenses_cents: 0, result_cents: 0 });
  const totals: DashboardTotals = {
    projects: { A: project(), B: project() },
    company: { approved_income_cents: 0, total_commissions_cents: 0, all_recorded_expenses_cents: 0,
      allocated_project_expenses_cents: 0, company_overhead_cents: 0, awaiting_allocation_cents: 0, result_cents: 0 },
    earned_commissions_cents: zeroEarned(),
  };
  const add = (a: number, b: number) => sumCents([a, b], "dashboard total");
  for (const transaction of transactions) {
    if (transaction.transaction_type === "SALE") {
      const sale = saleContribution(transaction);
      const target = totals.projects[sale.project];
      target.approved_income_cents = add(target.approved_income_cents, sale.approved_income_cents);
      target.commission_expense_cents = add(target.commission_expense_cents, sale.commission_expense_cents);
      for (const person of SALESPERSON_CODES) {
        totals.earned_commissions_cents[person] = add(totals.earned_commissions_cents[person], sale.earned_commissions_cents[person]);
      }
    } else if (transaction.transaction_type === "EXPENSE") {
      const expense = expenseContribution(transaction);
      totals.company.all_recorded_expenses_cents = add(totals.company.all_recorded_expenses_cents, expense.company_expenses_cents);
      totals.company.company_overhead_cents = add(totals.company.company_overhead_cents, expense.company_overhead_cents);
      totals.company.awaiting_allocation_cents = add(totals.company.awaiting_allocation_cents, expense.awaiting_allocation_cents);
      for (const code of PROJECTS) {
        totals.projects[code].allocated_expenses_cents = add(totals.projects[code].allocated_expenses_cents, expense.project_expenses_cents[code]);
      }
    } else invalidState("transaction_type");
  }
  for (const code of PROJECTS) {
    const target = totals.projects[code];
    target.result_cents = sumCents([target.approved_income_cents, -target.commission_expense_cents, -target.allocated_expenses_cents], "project result");
    totals.company.approved_income_cents = add(totals.company.approved_income_cents, target.approved_income_cents);
    totals.company.total_commissions_cents = add(totals.company.total_commissions_cents, target.commission_expense_cents);
    totals.company.allocated_project_expenses_cents = add(totals.company.allocated_project_expenses_cents, target.allocated_expenses_cents);
  }
  totals.company.result_cents = sumCents([totals.company.approved_income_cents,
    -totals.company.total_commissions_cents, -totals.company.all_recorded_expenses_cents], "company result");
  return totals;
}
