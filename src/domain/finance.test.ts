import { describe, expect, it } from "vitest";
import { calculateCommission } from "./commission";
import { aggregateDashboard, expenseContribution, saleContribution, type DashboardTotals } from "./finance";
import type { Allocation, CommissionSplit, Expense, FinancialTransaction, Project, Sale, SalespersonCode } from "./types";
import { DomainError } from "./validation";

const split = (r: string, a: string, j: string): CommissionSplit => ({ RICHARD: r, ANASTASIA: a, JEAN_CLAUDE: j });
const zeroCommission = () => ({ pool_cents: 0, earned_cents: { RICHARD: 0, ANASTASIA: 0, JEAN_CLAUDE: 0 } });

// Proposal and identity metadata live only in these test fixtures. Finance uses
// the current project and final split, never the original proposal or reference.
function sale(reference: string, salesperson: SalespersonCode, project: Project, amount: number,
  proposed: CommissionSplit, final: CommissionSplit | null) {
  const financial: Sale = final === null
    ? { transaction_type: "SALE", amount_cents: amount, project, status: "PENDING_APPROVAL", final_split: null, commission: zeroCommission() }
    : { transaction_type: "SALE", amount_cents: amount, project, status: "APPROVED", final_split: final, commission: calculateCommission(amount, final) };
  return { ...financial, reference, salesperson, proposed_split: proposed };
}
function expense(reference: string, amount: number, proposed: Allocation, final: Allocation | null) {
  let financial: Expense;
  if (final === null) {
    if (proposed === "COMPANY_OVERHEAD") throw new Error("Overhead cannot await allocation.");
    financial = { transaction_type: "EXPENSE", amount_cents: amount, status: "AWAITING_ALLOCATION", proposed_allocation: proposed, final_allocation: null };
  } else {
    financial = { transaction_type: "EXPENSE", amount_cents: amount, status: "ALLOCATED", proposed_allocation: proposed, final_allocation: final };
  }
  return { ...financial, reference, reporter: "KEVIN" as const };
}
function test1(beforeDecisions = false) {
  return [
    sale("S01", "RICHARD", "A", 100000, split("50", "30", "20"), beforeDecisions ? null : split("50", "30", "20")),
    sale("S02", "ANASTASIA", "B", 200000, split("0", "50", "50"), beforeDecisions ? null : split("20", "40", "40")),
    expense("E01", 12000, "A", beforeDecisions ? null : "A"),
    expense("E02", 8000, "B", beforeDecisions ? null : "A"),
    expense("E03", 10000, "COMPANY_OVERHEAD", "COMPANY_OVERHEAD"),
  ];
}
function test2() {
  return [
    ...test1(),
    sale("S03", "JEAN_CLAUDE", "A", 150000, split("40", "40", "20"), split("20", "30", "50")),
    sale("S04", "RICHARD", "B", 80000, split("25", "25", "50"), split("25", "25", "50")),
    sale("S05", "RICHARD", "B", 60000, split("100", "0", "0"), null),
    expense("E04", 25000, "B", "B"),
    expense("E05", 9000, "A", "B"),
    expense("E06", 6000, "COMPANY_OVERHEAD", "COMPANY_OVERHEAD"),
    expense("E07", 14000, "A", null),
  ];
}
function reconcile(totals: DashboardTotals) {
  const { projects, company } = totals;
  expect(projects.A.result_cents + projects.B.result_cents - company.company_overhead_cents - company.awaiting_allocation_cents)
    .toBe(company.result_cents);
  expect(Object.values(totals.earned_commissions_cents).reduce((a, b) => a + b, 0)).toBe(company.total_commissions_cents);
  expect(company.allocated_project_expenses_cents + company.company_overhead_cents + company.awaiting_allocation_cents)
    .toBe(company.all_recorded_expenses_cents);
  for (const group of [projects.A, projects.B, company, totals.earned_commissions_cents]) {
    expect(Object.values(group).every(Number.isSafeInteger)).toBe(true);
  }
}

describe("assignment financial oracles in integer cents", () => {
  it("matches every Test 1 total", () => {
    const totals = aggregateDashboard(test1());
    expect(totals).toEqual({
      projects: {
        A: { approved_income_cents: 100000, commission_expense_cents: 10000, allocated_expenses_cents: 20000, result_cents: 70000 },
        B: { approved_income_cents: 200000, commission_expense_cents: 20000, allocated_expenses_cents: 0, result_cents: 180000 },
      },
      company: { approved_income_cents: 300000, total_commissions_cents: 30000, all_recorded_expenses_cents: 30000,
        allocated_project_expenses_cents: 20000, company_overhead_cents: 10000, awaiting_allocation_cents: 0, result_cents: 240000 },
      earned_commissions_cents: { RICHARD: 9000, ANASTASIA: 11000, JEAN_CLAUDE: 10000 },
    });
    reconcile(totals);
  });
  it("matches Test 1 before manager decisions", () => {
    const totals = aggregateDashboard(test1(true));
    expect(totals).toEqual({
      projects: {
        A: { approved_income_cents: 0, commission_expense_cents: 0, allocated_expenses_cents: 0, result_cents: 0 },
        B: { approved_income_cents: 0, commission_expense_cents: 0, allocated_expenses_cents: 0, result_cents: 0 },
      },
      company: { approved_income_cents: 0, total_commissions_cents: 0, all_recorded_expenses_cents: 30000,
        allocated_project_expenses_cents: 0, company_overhead_cents: 10000, awaiting_allocation_cents: 20000, result_cents: -30000 },
      earned_commissions_cents: { RICHARD: 0, ANASTASIA: 0, JEAN_CLAUDE: 0 },
    });
    reconcile(totals);
  });
  it("matches every cumulative Test 2 total, retaining Test 1", () => {
    const totals = aggregateDashboard(test2());
    expect(totals).toEqual({
      projects: {
        A: { approved_income_cents: 250000, commission_expense_cents: 25000, allocated_expenses_cents: 20000, result_cents: 205000 },
        B: { approved_income_cents: 280000, commission_expense_cents: 28000, allocated_expenses_cents: 34000, result_cents: 218000 },
      },
      company: { approved_income_cents: 530000, total_commissions_cents: 53000, all_recorded_expenses_cents: 84000,
        allocated_project_expenses_cents: 54000, company_overhead_cents: 16000, awaiting_allocation_cents: 14000, result_cents: 393000 },
      earned_commissions_cents: { RICHARD: 14000, ANASTASIA: 17500, JEAN_CLAUDE: 21500 },
    });
    reconcile(totals);
  });
  it("proves S05 contributes no income, commission or result", () => {
    const rows = test2();
    const pending = rows.find((row) => row.reference === "S05");
    if (!pending || pending.transaction_type !== "SALE") throw new Error("Missing S05 fixture.");
    expect(pending.amount_cents).toBe(60000);
    expect(saleContribution(pending)).toEqual({ project: "B", approved_income_cents: 0,
      commission_expense_cents: 0, result_cents: 0, earned_commissions_cents: { RICHARD: 0, ANASTASIA: 0, JEAN_CLAUDE: 0 } });
    expect(aggregateDashboard(rows)).toEqual(aggregateDashboard(rows.filter((row) => row.reference !== "S05")));
  });
  it("proves E07 immediately costs the company 14000 cents and neither project", () => {
    const rows = test2();
    const withExpense = aggregateDashboard(rows);
    const withoutExpense = aggregateDashboard(rows.filter((row) => row.reference !== "E07"));
    expect(withExpense.projects).toEqual(withoutExpense.projects);
    expect(withExpense.company.result_cents).toBe(withoutExpense.company.result_cents - 14000);
    expect(withExpense.company.all_recorded_expenses_cents).toBe(withoutExpense.company.all_recorded_expenses_cents + 14000);
    expect(withExpense.company.awaiting_allocation_cents).toBe(14000);
  });
});

describe("financial contribution invariants", () => {
  it.each(["A", "B", "COMPANY_OVERHEAD"] as const)("allocation to %s never deducts a second company expense", (allocation) => {
    const before = aggregateDashboard([expense("arbitrary", 12345, "A", null)]);
    const after = aggregateDashboard([expense("arbitrary", 12345, "A", allocation)]);
    expect(after.company.result_cents).toBe(before.company.result_cents);
    expect(after.company.all_recorded_expenses_cents).toBe(12345);
    expect(after.company.awaiting_allocation_cents).toBe(0);
    expect(after.projects.A.allocated_expenses_cents).toBe(allocation === "A" ? 12345 : 0);
    expect(after.projects.B.allocated_expenses_cents).toBe(allocation === "B" ? 12345 : 0);
    expect(after.company.company_overhead_cents).toBe(allocation === "COMPANY_OVERHEAD" ? 12345 : 0);
    reconcile(after);
  });
  it("assigns income and commission to the corrected current project", () => {
    const original = sale("custom sale", "RICHARD", "A", 12345, split("100", "0", "0"), split("12.5", "37.5", "50"));
    const totals = aggregateDashboard([{ ...original, project: "B" }]);
    expect(totals.projects.A.result_cents).toBe(0);
    expect(totals.projects.B).toEqual({ approved_income_cents: 12345, commission_expense_cents: 1235,
      allocated_expenses_cents: 0, result_cents: 11110 });
    expect(totals.earned_commissions_cents).toEqual({ RICHARD: 154, ANASTASIA: 463, JEAN_CLAUDE: 618 });
  });
  it("returns zero totals for no transactions", () => {
    const totals = aggregateDashboard([]);
    for (const group of [totals.projects.A, totals.projects.B, totals.company, totals.earned_commissions_cents]) {
      expect(Object.values(group).every((value) => value === 0)).toBe(true);
    }
  });
  it("is repeatable, independent of order and does not mutate input", () => {
    const rows = test2();
    const snapshot = structuredClone(rows);
    const first = aggregateDashboard(Object.freeze(rows));
    expect(aggregateDashboard(rows)).toEqual(first);
    expect(aggregateDashboard([...rows].reverse())).toEqual(first);
    expect(rows).toEqual(snapshot);
    first.projects.A.result_cents = -1;
    expect(aggregateDashboard(rows).projects.A.result_cents).toBe(205000);
  });
  it("handles the maximum safe amount and rejects aggregate overflow", () => {
    const large = expense("large", Number.MAX_SAFE_INTEGER, "A", null);
    expect(aggregateDashboard([large]).company.result_cents).toBe(-Number.MAX_SAFE_INTEGER);
    expect(() => aggregateDashboard([large, expense("extra", 1, "B", null)]))
      .toThrowError(expect.objectContaining({ code: "UNSAFE_CENTS" }));
    const shares = split("100", "0", "0");
    const largeSale = sale("large sale", "RICHARD", "A", Number.MAX_SAFE_INTEGER, shares, shares);
    expect(aggregateDashboard([largeSale]).company.approved_income_cents).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => aggregateDashboard([largeSale, sale("extra sale", "RICHARD", "B", 1, shares, shares)]))
      .toThrowError(expect.objectContaining({ code: "UNSAFE_CENTS" }));
  });
});

describe("inconsistent financial projections", () => {
  const approved = () => sale("valid", "RICHARD", "A", 100000, split("50", "30", "20"), split("50", "30", "20"));
  it.each([
    { final_split: null }, { final_split: undefined }, { commission: undefined },
    { commission: { pool_cents: 10000 } }, { commission: zeroCommission() },
    { commission: { pool_cents: 10000, earned_cents: { RICHARD: 4000, ANASTASIA: 4000, JEAN_CLAUDE: 2000 } } },
    { commission: { pool_cents: 10000, earned_cents: { RICHARD: 5000, ANASTASIA: 3000 } } },
    { commission: { pool_cents: 10000, earned_cents: { RICHARD: -1, ANASTASIA: 8001, JEAN_CLAUDE: 2000 } } },
    { project: "C" }, { status: "ALLOCATED" }, { amount_cents: 0 }, { amount_cents: 1.5 },
    { final_split: split("60", "30", "20") },
  ])("rejects inconsistent approved data %j", (override) => {
    const invalid = { ...approved(), ...override } as unknown as Sale;
    expect(() => saleContribution(invalid)).toThrowError(DomainError);
    expect(() => aggregateDashboard([invalid])).toThrowError(DomainError);
  });
  it("rejects pending sales with final split or nonzero earned commission", () => {
    const pending = sale("pending", "RICHARD", "A", 100000, split("50", "30", "20"), null);
    expect(() => saleContribution({ ...pending, final_split: split("50", "30", "20") } as Sale)).toThrowError(DomainError);
    expect(() => saleContribution({ ...pending, commission: approved().commission })).toThrowError(DomainError);
  });
  it.each([
    { status: "AWAITING_ALLOCATION", proposed_allocation: "A", final_allocation: "B" },
    { status: "AWAITING_ALLOCATION", proposed_allocation: "COMPANY_OVERHEAD", final_allocation: null },
    { status: "ALLOCATED", proposed_allocation: "A", final_allocation: null },
    { status: "ALLOCATED", proposed_allocation: "A", final_allocation: "C" },
    { status: "ALLOCATED", proposed_allocation: "COMPANY_OVERHEAD", final_allocation: "A" },
    { status: "APPROVED", proposed_allocation: "A", final_allocation: "A" },
    { status: "ALLOCATED", proposed_allocation: "C", final_allocation: "A" },
  ])("rejects inconsistent expense state %j", (state) => {
    const invalid = { transaction_type: "EXPENSE", amount_cents: 100, ...state } as unknown as Expense;
    expect(() => expenseContribution(invalid)).toThrowError(DomainError);
  });
  it("rejects unknown transaction types and invalid expense money", () => {
    expect(() => aggregateDashboard([{ transaction_type: "OTHER" } as unknown as FinancialTransaction])).toThrowError(DomainError);
    expect(() => expenseContribution({ ...expense("bad", 1, "A", null), amount_cents: -1 })).toThrowError(DomainError);
  });
});
