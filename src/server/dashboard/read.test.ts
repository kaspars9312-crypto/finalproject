import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../../app/page";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { readDashboardRecords, DASHBOARD_ERROR } from "./read";
import { employees } from "../sheets/fixtures.test-support";
import { test1, test2 } from "./fixtures.test-support";
import type { Employee, TransactionView } from "../records/types";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("../../app/actions", () => ({ retrySheetsAction: vi.fn() }));
vi.mock("../../app/workflow-action", () => ({ workflowAction: vi.fn() }));
const rpc = vi.fn();
let rows: TransactionView[];
let actor: Employee;
const manager = employees[0].id;
const read = () => readDashboardRecords(actor.id);
const render = (query: Record<string, string | string[]> = { employee: actor.id }) =>
  Home({ searchParams: Promise.resolve(query) }).then(renderToStaticMarkup);
beforeEach(() => {
  vi.clearAllMocks(); actor = { ...employees[0] }; rows = test2();
  rpc.mockImplementation(async (name: string) => ({ data: name === "read_visible_transactions"
    ? { actor, transactions: structuredClone(rows) }
    : { actor, transactions: [], links: [] }, error: null }));
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc,
    from: () => ({ select: async () => ({ data: employees, error: null }) }),
  } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No real network allowed"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it("official Test 1 final: exact values through the real authorized read and domain mapper", async () => {
  rows = test1();
  expect((await read()).dashboard).toEqual({ totals: {
    projects: {
      A: { approved_income_cents: 100000, commission_expense_cents: 10000, allocated_expenses_cents: 20000, result_cents: 70000 },
      B: { approved_income_cents: 200000, commission_expense_cents: 20000, allocated_expenses_cents: 0, result_cents: 180000 },
    },
    company: { approved_income_cents: 300000, total_commissions_cents: 30000, allocated_project_expenses_cents: 20000,
      company_overhead_cents: 10000, awaiting_allocation_cents: 0, all_recorded_expenses_cents: 30000, result_cents: 240000 },
    earned_commissions_cents: { RICHARD: 9000, ANASTASIA: 11000, JEAN_CLAUDE: 10000 },
  }, pendingSales: { count: 0, amount_cents: 0 }, awaitingExpenses: { count: 0, amount_cents: 0 } });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_visible_transactions", { p_actor_employee_id: manager });
});
it("official Test 1 before decisions: company minus 300, projects and commissions zero", async () => {
  rows = test1(true);
  expect((await read()).dashboard).toEqual({ totals: {
    projects: {
      A: { approved_income_cents: 0, commission_expense_cents: 0, allocated_expenses_cents: 0, result_cents: 0 },
      B: { approved_income_cents: 0, commission_expense_cents: 0, allocated_expenses_cents: 0, result_cents: 0 },
    },
    company: { approved_income_cents: 0, total_commissions_cents: 0, allocated_project_expenses_cents: 0,
      company_overhead_cents: 10000, awaiting_allocation_cents: 20000, all_recorded_expenses_cents: 30000, result_cents: -30000 },
    earned_commissions_cents: { RICHARD: 0, ANASTASIA: 0, JEAN_CLAUDE: 0 },
  }, pendingSales: { count: 2, amount_cents: 300000 }, awaitingExpenses: { count: 2, amount_cents: 20000 } });
  expect(await render()).toContain("−€300.00");
});
it("official Test 2 cumulative: every measure and reconciliation", async () => {
  const result = await read();
  expect(result.dashboard).toEqual({ totals: {
    projects: {
      A: { approved_income_cents: 250000, commission_expense_cents: 25000, allocated_expenses_cents: 20000, result_cents: 205000 },
      B: { approved_income_cents: 280000, commission_expense_cents: 28000, allocated_expenses_cents: 34000, result_cents: 218000 },
    },
    company: { approved_income_cents: 530000, total_commissions_cents: 53000, allocated_project_expenses_cents: 54000,
      company_overhead_cents: 16000, awaiting_allocation_cents: 14000, all_recorded_expenses_cents: 84000, result_cents: 393000 },
    earned_commissions_cents: { RICHARD: 14000, ANASTASIA: 17500, JEAN_CLAUDE: 21500 },
  }, pendingSales: { count: 1, amount_cents: 60000 }, awaitingExpenses: { count: 1, amount_cents: 14000 } });
  const t = result.dashboard!.totals;
  expect(t.projects.A.result_cents + t.projects.B.result_cents - t.company.company_overhead_cents - t.company.awaiting_allocation_cents).toBe(t.company.result_cents);
  expect(result.transactions.find(t => t.reference === "S05")?.status).toBe("PENDING_APPROVAL");
  expect(result.transactions.find(t => t.reference === "E07")?.status).toBe("AWAITING_ALLOCATION");
});
it.each([1, 2, 3, 4])("non-manager %i cannot retrieve dashboard even with spoofed role and excess RPC rows", async index => {
  actor = { ...employees[index] };
  expect(await read()).toMatchObject({ dashboard: null, dashboardError: null });
  const html = await render({ employee: actor.id, role: "MANAGER", dashboard: "true" });
  expect(html).not.toContain('id="financial-dashboard-title"');
  expect(html).not.toContain("€3930.00"); expect(html).not.toContain("Cumulative earned commission");
  expect((await read()).transactions.every(t => t.submitter_employee_id === actor.id)).toBe(true);
});
it("uses the stored role rather than employee code or selector list", async () => {
  actor.role = "SALESPERSON";
  expect((await read()).dashboard).toBeNull();
  expect(await render()).not.toContain('id="financial-dashboard-title"');
});
it.each([{ active: false }, { role: "ADMIN" }, { id: employees[1].id }])("invalid stored actor fails closed: %j", async override => {
  actor = { ...actor, ...override } as Employee;
  await expect(readDashboardRecords(manager)).rejects.toThrow("Records are unavailable");
});
it("malformed, repeated and unknown identities cannot obtain aggregates", async () => {
  await expect(readDashboardRecords("MANAGER")).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
  expect(await render({ employee: [manager, employees[1].id] })).not.toContain('id="financial-dashboard-title"');
  rpc.mockResolvedValue({ data: null, error: { code: "BF001", message: "private diagnostic" } });
  const html = await render({ employee: "99999999-9999-4999-8999-999999999999" });
  expect(html).toContain("Records are unavailable"); expect(html).not.toContain("private diagnostic");
});
it("renders required measures, commissions and the submission shell without replacing controls", async () => {
  const html = await render();
  for (const label of ["Financial dashboard", "Project A", "Project B", "Company", "Approved income", "Commission expense",
    "Allocated project expenses", "Total approved income", "Total commission expense", "Total allocated project expenses",
    "Company overhead", "Expenses awaiting allocation", "Total company result", "Cumulative earned commission",
    "Richard", "Anastasia", "Jean-Claude", "Total", "€2050.00", "€2180.00", "€3930.00", "€140.00", "€175.00", "€215.00", "€530.00",
    "Kaspars Bickovs", "Student:", "How to use the application", "Demonstration role", "Manager decisions", "Transactions"]) expect(html).toContain(label);
  for (const url of ["https://t.me/friends_included_final_bot",
    "https://docs.google.com/spreadsheets/d/1Q8_NLiBBNTiDLmSAhnhs7ddAKkJU8xiHbRyN-CNdTMk/edit",
    "https://github.com/kaspars9312-crypto/finalproject"]) expect(html).toContain(`href="${url}" target="_blank" rel="noopener noreferrer"`);
});
it("refresh rereads persisted state; no accumulated balances or fixture-specific references", async () => {
  const before = (await read()).dashboard;
  expect((await read()).dashboard).toEqual(before);
  rows = rows.map(t => ({ ...t, reference: `Instructor ${t.id}` }));
  expect((await read()).dashboard).toEqual(before);
  rows.push({ ...rows.find(t => t.reference.includes("bbbbbbbb"))!, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    reference: "Additional instructor expense", amount_cents: "1234", final_allocation: "B" });
  const after = (await read()).dashboard!;
  expect(after.totals.company.result_cents).toBe(391766);
  expect(after.totals.projects.B.result_cents).toBe(216766);
});
it("empty persisted data produces real zeros", async () => {
  rows = [];
  expect((await read()).dashboard!.totals.company.result_cents).toBe(0);
  expect(await render()).toContain("€0.00");
});
it("pending sale changes no approved financial totals", async () => {
  const before = (await read()).dashboard!.totals;
  rows = rows.filter(t => t.reference !== "S05");
  expect((await read()).dashboard!.totals).toEqual(before);
});
it.each(["A", "B", "COMPANY_OVERHEAD"] as const)("allocating E07 to %s deducts company expense only once", async final => {
  const before = (await read()).dashboard!.totals;
  rows = rows.map(t => t.reference === "E07" ? { ...t, status: "ALLOCATED", final_allocation: final, revision: 2 } : t);
  const after = (await read()).dashboard!;
  expect(after.totals.company.result_cents).toBe(before.company.result_cents);
  expect(after.totals.company.all_recorded_expenses_cents).toBe(before.company.all_recorded_expenses_cents);
  expect(after.awaitingExpenses).toEqual({ count: 0, amount_cents: 0 });
  if (final === "COMPANY_OVERHEAD") {
    expect(after.totals.projects).toEqual(before.projects); expect(after.totals.company.company_overhead_cents).toBe(30000);
  } else expect(after.totals.projects[final].result_cents).toBe(before.projects[final].result_cents - 14000);
});
it("current corrected amount/project/final split wins over original proposal", async () => {
  rows = [{ ...test1()[0], amount_cents: "12345", project: "B", final_richard_pct: "20", final_anastasia_pct: "40", final_jean_claude_pct: "40",
    richard_commission_cents: "247", anastasia_commission_cents: "494", jean_claude_commission_cents: "494",
    original_submission: { amount_cents: "100000", project: "A" } } as TransactionView];
  const t = (await read()).dashboard!.totals;
  expect(t.projects.A.result_cents).toBe(0); expect(t.projects.B.result_cents).toBe(11110);
  expect(t.earned_commissions_cents).toEqual({ RICHARD: 247, ANASTASIA: 494, JEAN_CLAUDE: 494 });
});
it.each(["PENDING", "FAILED", "SYNCED"] as const)("Sheets %s retry metadata cannot change totals", async status => {
  const before = (await read()).dashboard;
  rows = rows.map(t => ({ ...t, sheet_sync_status: status, sheet_synced_revision: status === "SYNCED" ? t.revision : null,
    sheet_last_error: status === "FAILED" ? "safe error" : null, sheet_sync_token: "private-token", sheet_sync_started_at: "later" }));
  expect((await read()).dashboard).toEqual(before);
});
it.each(["PENDING", "FAILED", "SENT", "NO_RECIPIENT"])("Telegram/decision %s retry metadata cannot change totals", async status => {
  const before = (await read()).dashboard;
  rows = rows.map(t => ({ ...t, decision_notification_status: status, submission_confirmation_status: status,
    decision_delivery_token: "private-token", decision_target_chat_id: "private-chat", decision_last_error: "private-error" }));
  const result = await read();
  expect(result.dashboard).toEqual(before);
  expect(JSON.stringify(result.dashboard)).not.toContain("private-");
  expect(await render()).not.toContain("private-");
});
it.each(["9007199254740992", "9223372036854775807"])("unsafe cents %s yield unavailable instead of rounded totals", async amount => {
  rows[0].amount_cents = amount;
  expect(await read()).toMatchObject({ dashboard: null, dashboardError: DASHBOARD_ERROR });
});
it("inconsistent commissions fail closed while preserving existing record view", async () => {
  rows[0].richard_commission_cents = "5001";
  expect(await read()).toMatchObject({ dashboard: null, dashboardError: DASHBOARD_ERROR });
  const html = await render(); expect(html).toContain(DASHBOARD_ERROR); expect(html).toContain("S01");
  expect(html).not.toContain("€3930.00");
});
it("duplicate read rows are refused instead of double-counted", async () => {
  rows.push({ ...rows[0] });
  expect(await read()).toMatchObject({ dashboard: null, dashboardError: DASHBOARD_ERROR });
});
