import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { readWorkflow, type WorkflowData, type WorkflowTransaction } from "./read";
import { WebsiteWorkflow } from "../../app/workflow";
import { employees, sale, expense, approved } from "../sheets/fixtures.test-support";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("../../app/workflow-action", () => ({ workflowAction: vi.fn() }));
const rpc = vi.fn();
const pending: WorkflowTransaction = { ...sale, original_submission: { reference: sale.reference, customer: "Original customer",
  description: "Original description", project: "B", amount_cents: "99999", proposed_richard_pct: "12.5", proposed_anastasia_pct: "37.5", proposed_jean_claude_pct: "50" },
  decision_notification_status: "NOT_REQUIRED", decision_delivery_busy: false };
const awaiting: WorkflowTransaction = { ...pending, ...expense };
const finalized: WorkflowTransaction = { ...pending, ...approved, decision_notification_status: "FAILED" };
const links = [{ telegram_user_id: "900000000000000001", employee_id: employees[4].id, private_chat_known: true }];
const data = (index = 0, transactions = [pending, awaiting, finalized]): WorkflowData => ({ actor: employees[index], transactions, links });
const render = (value: WorkflowData) => renderToStaticMarkup(createElement(WebsiteWorkflow, { data: value, employees }));
beforeEach(() => {
  vi.clearAllMocks(); rpc.mockReset().mockResolvedValue({ data: data(), error: null });
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
it("manager reads pending queues and links with exact IDs", async () => {
  expect(await readWorkflow(employees[0].id)).toEqual(data());
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_website_workflow", { p_actor_employee_id: employees[0].id });
});
it.each([1, 2, 3, 4])("own visibility and no links for employee %s", async index => {
  rpc.mockResolvedValue({ data: data(index), error: null });
  const result = await readWorkflow(employees[index].id);
  expect(result.transactions.every(t => t.submitter_employee_id === employees[index].id)).toBe(true); expect(result.links).toEqual([]);
});
it.each([{ active: false }, { role: "ADMIN" }, { id: employees[1].id }])("rejects invalid actor %j", async override => {
  rpc.mockResolvedValue({ data: { ...data(), actor: { ...employees[0], ...override } }, error: null });
  await expect(readWorkflow(employees[0].id)).rejects.toThrow("Records are unavailable");
});
it("rejects unknown actor and database diagnostics without leakage", async () => {
  rpc.mockRejectedValue(new Error("private credential"));
  await expect(readWorkflow(employees[0].id)).rejects.toThrow("Records are unavailable");
});
it.each([{ decision_notification_status: "UNKNOWN" }, { decision_delivery_busy: undefined }, { original_submission: { amount_cents: 123 } }])("rejects broken workflow record %j", async override => {
  rpc.mockResolvedValue({ data: data(0, [{ ...pending, ...override } as WorkflowTransaction]), error: null });
  await expect(readWorkflow(employees[0].id)).rejects.toThrow();
});
it.each([1, 2, 3])("salesperson %s sees sale form only", index => {
  const html = render(data(index, [])); expect(html).toContain("Submit sale");
  expect(html).not.toContain("Submit expense"); expect(html).not.toContain("Manager decisions"); expect(html).not.toContain("Telegram employee-link setup");
  for (const label of ["Unique reference", "Customer", "Project", "Description", "Amount (EUR", "Proposed Richard %", "Proposed Anastasia %", "Proposed Jean-Claude %"]) expect(html).toContain(label);
});
it("Kevin sees expense form and all allocation/category choices", () => {
  const html = render(data(4, [])); expect(html).toContain("Submit expense"); expect(html).not.toContain("Submit sale");
  for (const label of ["Category", "Materials", "Travel", "Other", "Proposed allocation", "Company overhead"]) expect(html).toContain(label);
});
it("manager sees separate queues, original/current fields, split approval and setup without routine entry", () => {
  const html = render(data());
  for (const label of ["Manager decisions", "Pending sales (1)", "Awaiting expense allocations (1)", "Original submitted proposal",
    "Original customer", "€999.99", "Current pending values", "€123.45", "Save correction without approval",
    "Approve proposed split unchanged", "Approve with final split", "Final Richard %", "Final allocation", "Approve allocation",
    "Telegram employee-link setup", "900000000000000001", "Kevin von Whatever", "Private chat known", "Retry Telegram decision"]) expect(html).toContain(label);
  expect(html).not.toContain("Submit sale"); expect(html).not.toContain("Submit expense");
});
it("approved sales and auto-overhead have no correction or allocation controls", () => {
  const overhead: WorkflowTransaction = { ...awaiting, status: "ALLOCATED", proposed_allocation: "COMPANY_OVERHEAD", final_allocation: "COMPANY_OVERHEAD" };
  const html = render(data(0, [finalized, overhead]));
  expect(html).not.toContain("Save correction without approval"); expect(html).not.toContain("Approve allocation");
  expect(html).toContain("No sales await approval"); expect(html).toContain("No expenses await allocation");
});
it("NO_RECIPIENT displays exact text and does not offer retargeting", () => {
  const html = render(data(0, [{ ...finalized, decision_notification_status: "NO_RECIPIENT" }]));
  expect(html).toContain("No Telegram recipient linked"); expect(html).not.toContain("Retry Telegram decision");
});
it.each(["SENT", "PENDING", "FAILED"] as const)("delivery %s is visible to own submitter with no manager retry", status => {
  const html = render(data(1, [{ ...finalized, decision_notification_status: status }]));
  expect(html).toContain(`Telegram decision: ${status}`); expect(html).not.toContain("Retry Telegram decision");
});
it("busy delivery explains recovery and disables overlapping retry", () => {
  const html = render(data(0, [{ ...finalized, decision_notification_status: "PENDING", decision_delivery_busy: true }]));
  expect(html).toContain("operator must check"); expect(html).not.toContain("Retry Telegram decision");
});
it("client form has no privileged imports or credentials and output escapes user text", () => {
  const client = readFileSync("src/app/action-form.tsx", "utf8");
  expect(client).not.toMatch(/supabase|process\.env|TELEGRAM_BOT_TOKEN|GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  const html = render(data(0, [{ ...pending, reference: '<script>alert("x")</script>' }]));
  expect(html).not.toContain('<script>alert("x")</script>'); expect(html).toContain("&lt;script&gt;");
  for (const file of ["src/server/website/execute.ts", "src/server/website/read.ts", "src/server/telegram/decisions.ts"])
    expect(readFileSync(file, "utf8")).toContain('import "server-only"');
});
