import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { createSheetsClient } from "../sheets/client";
import { sendMessage } from "../telegram/client";
import { employees, sale, expense } from "../sheets/fixtures.test-support";
import { sheetRow } from "../sheets/rows";
import { executeWebsiteForm } from "./execute";
import type { TransactionView } from "../records/types";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("../sheets/client", async original => ({ ...await original<typeof import("../sheets/client")>(), createSheetsClient: vi.fn() }));
vi.mock("../telegram/client", () => ({ sendMessage: vi.fn() }));
const rpc = vi.fn();
const read = vi.fn(); const write = vi.fn(); const append = vi.fn();
const manager = employees[0].id; const richard = employees[1].id; const kevin = employees[4].id;
const token = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
type Row = TransactionView & { original_submission: unknown; commission_pool_cents: string | null; decision_notification_status: string; decision_target_chat_id: string | null };
let row: Row;
let linkedChat: string | null;
let events: string[];
const ok = (data: unknown) => ({ data, error: null });
const fail = (code: string) => ({ data: null, error: { code, message: "private boundary diagnostic" } });
const receipt = () => ({ id: row.id, reference: row.reference, status: row.status, revision: row.revision });
function form(command: string, override: Record<string, string> = {}) {
  const values = { employee: command === "sale" ? richard : command === "expense" ? kevin : manager, command,
    transaction: sale.id, revision: "1", reference: "Website QA", customer: "Customer", project: "A", description: "Description",
    amount: "123.45", richard: "12.5", anastasia: "37.5", jeanClaude: "50", category: "TRAVEL", allocation: "B", ...override };
  const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f;
}
// Network-boundary contract double. SQL QA (separate) checks actual DB authority.
async function database(name: string, a: Record<string, string | number | null>) {
  events.push(name);
  const actor = employees.find(e => e.id === a.p_actor_employee_id);
  if (name === "read_visible_transactions") return actor ? ok({ actor, transactions: [] }) : fail("BF001");
  if (["create_website_sale", "create_website_expense"].includes(name)) {
    if (a.p_reference === "duplicate") return fail("BD005");
    const isSale = name === "create_website_sale";
    row = { ...row, ...(isSale ? sale : expense), reference: String(a.p_reference), submitter_employee_id: actor!.id,
      amount_cents: String(a.p_amount_cents), description: String(a.p_description),
      ...(isSale ? { customer: String(a.p_customer), project: a.p_project as "A", proposed_richard_pct: String(a.p_richard_pct),
        proposed_anastasia_pct: String(a.p_anastasia_pct), proposed_jean_claude_pct: String(a.p_jean_claude_pct) }
        : { proposed_allocation: a.p_proposed_allocation as "B", final_allocation: a.p_proposed_allocation === "COMPANY_OVERHEAD" ? "COMPANY_OVERHEAD" : null,
          status: a.p_proposed_allocation === "COMPANY_OVERHEAD" ? "ALLOCATED" : "AWAITING_ALLOCATION" }) };
    events.push("committed"); return ok(receipt());
  }
  if (name === "read_sale_for_approval") return ok(row);
  if (["correct_pending_sale", "approve_sale", "allocate_expense"].includes(name)) {
    if (actor?.role !== "MANAGER") return fail("BD001");
    if (row.revision !== a.p_expected_revision || !["PENDING_APPROVAL", "AWAITING_ALLOCATION"].includes(row.status)) return fail("BD003");
    if (name === "correct_pending_sale") row = { ...row, customer: String(a.p_customer), project: a.p_project as "A",
      description: String(a.p_description), amount_cents: String(a.p_amount_cents) };
    else if (name === "approve_sale") row = { ...row, status: "APPROVED", final_richard_pct: String(a.p_richard_pct),
      final_anastasia_pct: String(a.p_anastasia_pct), final_jean_claude_pct: String(a.p_jean_claude_pct),
      commission_pool_cents: String(a.p_pool_cents), richard_commission_cents: String(a.p_richard_cents),
      anastasia_commission_cents: String(a.p_anastasia_cents), jean_claude_commission_cents: String(a.p_jean_claude_cents) };
    else row = { ...row, status: "ALLOCATED", final_allocation: a.p_final_allocation as "A" };
    row.revision++; row.sheet_sync_status = "PENDING";
    if (name !== "correct_pending_sale") {
      row.decision_target_chat_id = linkedChat;
      row.decision_notification_status = linkedChat ? "PENDING" : "NO_RECIPIENT";
    }
    events.push("committed"); return ok(receipt());
  }
  if (name === "begin_sheet_sync") return ok({ outcome: "STARTED", token, transaction: row });
  if (name === "finish_sheet_sync") { row.sheet_sync_status = a.p_outcome === "SUCCESS" ? "SYNCED" : "FAILED"; return ok({ outcome: row.sheet_sync_status }); }
  if (name === "begin_decision_delivery") return ok(row.decision_notification_status === "PENDING" || row.decision_notification_status === "FAILED"
    ? { outcome: "STARTED", token, target_chat_id: row.decision_target_chat_id, transaction: row } : { outcome: row.decision_notification_status });
  if (name === "finish_decision_delivery") { row.decision_notification_status = String(a.p_outcome); return ok({ outcome: a.p_outcome }); }
  if (name === "telegram_set_link") return ok(null);
  throw new Error(`Unexpected RPC ${name}`);
}
beforeEach(() => {
  vi.resetAllMocks(); events = []; linkedChat = "987654321";
  row = { ...sale, original_submission: { customer: "Original", amount_cents: "12345" }, commission_pool_cents: "0",
    decision_notification_status: "NOT_REQUIRED", decision_target_chat_id: null };
  rpc.mockImplementation(database);
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  read.mockImplementation(async () => { events.push("google"); return [sheetRow(row).headers, [row.reference]]; });
  vi.mocked(createSheetsClient).mockReturnValue({ read, write, append });
  vi.mocked(sendMessage).mockImplementation(async () => { events.push("telegram"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real network forbidden"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("website entry", () => {
  it.each(employees.slice(1, 4))("$code creates own pending sale from stored actor, ignoring spoofed fields", async actor => {
    const result = await executeWebsiteForm(form("sale", { employee: actor.id, role: "MANAGER", submitter_employee_id: manager, source: "TELEGRAM" }));
    expect(result).toMatchObject({ ok: true }); expect(row.submitter_employee_id).toBe(actor.id);
    expect(row.status).toBe("PENDING_APPROVAL"); expect(row.richard_commission_cents).toBe("0");
    const args = rpc.mock.calls.find(c => c[0] === "create_website_sale")![1];
    expect(args).not.toHaveProperty("role"); expect(args).not.toHaveProperty("source"); expect(args.p_actor_employee_id).toBe(actor.id);
    expect(events.indexOf("google")).toBeGreaterThan(events.indexOf("committed")); expect(sendMessage).not.toHaveBeenCalled();
  });
  it.each([manager, kevin])("denies sale by non-salesperson %s", async employee => {
    expect(await executeWebsiteForm(form("sale", { employee }))).toMatchObject({ ok: false }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["", "0", "-1", "1.234", "hello", "1e2", "90071992547409.92"])("rejects invalid sale amount %s", async amount => {
    expect(await executeWebsiteForm(form("sale", { amount }))).toMatchObject({ ok: false }); expect(read).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["reference", "customer", "description", "richard", "project"])("rejects missing sale %s", async field => {
    expect(await executeWebsiteForm(form("sale", { [field]: "" }))).toMatchObject({ ok: false }); expect(read).not.toHaveBeenCalled();
  });
  it("rejects split other than exactly 100", async () => {
    expect(await executeWebsiteForm(form("sale", { richard: "60", anastasia: "30", jeanClaude: "20" })))
      .toMatchObject({ ok: false, message: expect.stringContaining("exactly 100") }); expect(read).not.toHaveBeenCalled();
  });
  it("duplicate reference is rejected with no delivery", async () => {
    expect(await executeWebsiteForm(form("sale", { reference: "duplicate" }))).toMatchObject({ ok: false, message: "That reference is already recorded." });
    expect(read).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  });
  it.each(["A", "B", "COMPANY_OVERHEAD"])("Kevin creates expense %s with post-commit Sheets", async allocation => {
    expect(await executeWebsiteForm(form("expense", { allocation }))).toMatchObject({ ok: true });
    expect(row.submitter_employee_id).toBe(kevin); expect(row.status).toBe(allocation === "COMPANY_OVERHEAD" ? "ALLOCATED" : "AWAITING_ALLOCATION");
    expect(row.proposed_allocation).toBe(allocation); expect(events.indexOf("google")).toBeGreaterThan(events.indexOf("committed"));
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it.each([manager, richard, employees[2].id, employees[3].id])("denies expense by %s", async employee => {
    expect(await executeWebsiteForm(form("expense", { employee }))).toMatchObject({ ok: false }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each<Record<string, string>>([{ amount: "0" }, { amount: "" }, { category: "Food" }, { allocation: "C" }, { description: "" }])("rejects invalid expense %j", async fields => {
    expect(await executeWebsiteForm(form("expense", fields))).toMatchObject({ ok: false }); expect(read).not.toHaveBeenCalled();
  });
  it.each(["sale", "expense"])("Sheets failure retains saved %s", async command => {
    write.mockRejectedValue(new Error("private external failure"));
    const result = await executeWebsiteForm(form(command)); expect(result).toEqual({ ok: true, message: "Saved. Sheets: FAILED." });
    expect(row.revision).toBe(1); expect(events.filter(e => e === "committed")).toHaveLength(1);
  });
});

describe("manager decisions and independent deliveries", () => {
  it.each(["correct", "approveProposed", "approveFinal", "allocate", "link", "retryDecision"])("denies crafted %s from Richard with spoofed role", async command => {
    expect(await executeWebsiteForm(form(command, { employee: richard, role: "MANAGER" }))).toMatchObject({ ok: false });
    expect(rpc).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  });
  it("correction preserves original and proposal and updates same Sheets reference without approval", async () => {
    const original = structuredClone(row.original_submission);
    const reference = row.reference;
    expect(await executeWebsiteForm(form("correct", { customer: "Corrected", amount: "200.00", richard: "100" }))).toMatchObject({ ok: true });
    expect(row).toMatchObject({ customer: "Corrected", amount_cents: "20000", original_submission: original,
      proposed_richard_pct: "12.5", status: "PENDING_APPROVAL", revision: 2 });
    expect(write.mock.calls[0][1][0][0]).toBe(reference); expect(append).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
    expect(rpc.mock.calls.find(c => c[0] === "correct_pending_sale")![1]).not.toHaveProperty("p_richard_pct");
  });
  it.each(["approveProposed", "approveFinal"])("%s uses authoritative approval then both deliveries", async command => {
    const original = structuredClone(row.original_submission);
    expect(await executeWebsiteForm(form(command, { richard: "20", anastasia: "40", jeanClaude: "40" }))).toMatchObject({ ok: true });
    expect(row.status).toBe("APPROVED"); expect(row.original_submission).toEqual(original);
    expect(row.final_richard_pct).toBe(command === "approveProposed" ? "12.5" : "20");
    expect(row.commission_pool_cents).toBe("1235"); expect(row.decision_notification_status).toBe("SENT");
    expect(events.indexOf("google")).toBeGreaterThan(events.indexOf("committed"));
    expect(events.indexOf("telegram")).toBeGreaterThan(events.indexOf("committed"));
    expect(write.mock.calls[0][1][0][0]).toBe(sale.reference); expect(append).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1); expect(sendMessage).toHaveBeenCalledWith(linkedChat, expect.any(String));
  });
  it("rejects incorrect final split before decision", async () => {
    expect(await executeWebsiteForm(form("approveFinal", { richard: "80" }))).toMatchObject({ ok: false });
    expect(row.status).toBe("PENDING_APPROVAL"); expect(sendMessage).not.toHaveBeenCalled();
  });
  it("double approval and correction after approval cause no additional effects", async () => {
    await executeWebsiteForm(form("approveProposed")); const saved = structuredClone(row);
    expect(await executeWebsiteForm(form("approveProposed", { revision: "2" }))).toMatchObject({ ok: false });
    expect(await executeWebsiteForm(form("correct", { revision: "2" }))).toMatchObject({ ok: false });
    expect(row).toEqual(saved); expect(write).toHaveBeenCalledTimes(1); expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it.each(["A", "B", "COMPANY_OVERHEAD"])("allocates B proposal to %s on same row without changing amount", async allocation => {
    row = { ...row, ...expense }; const original = structuredClone(row.original_submission);
    expect(await executeWebsiteForm(form("allocate", { transaction: row.id, allocation }))).toMatchObject({ ok: true });
    expect(row).toMatchObject({ proposed_allocation: "B", final_allocation: allocation, status: "ALLOCATED", amount_cents: "12345", original_submission: original });
    expect(write).toHaveBeenCalledWith("'Expenses'!A2:I2", [sheetRow(row).values]); expect(append).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const saved = structuredClone(row);
    expect(await executeWebsiteForm(form("allocate", { transaction: row.id, revision: "2" }))).toMatchObject({ ok: false }); expect(row).toEqual(saved);
  });
  it.each(["correct", "approveProposed", "allocate"])("stale %s has no integration effects", async command => {
    row.revision = 2;
    expect(await executeWebsiteForm(form(command))).toMatchObject({ ok: false, message: expect.stringContaining("Reload") });
    expect(read).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  });
  it("Sheets failure leaves approval committed and Telegram independent", async () => {
    write.mockRejectedValue(new Error("private token"));
    expect(await executeWebsiteForm(form("approveProposed"))).toEqual({ ok: true, message: "Saved. Sheets: FAILED. Telegram decision: SENT." });
    expect(row.status).toBe("APPROVED"); expect(row.revision).toBe(2);
  });
  it("Telegram failure leaves approval committed and Sheets synced; retry sends same target without finance replay", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("private token"));
    expect(await executeWebsiteForm(form("approveProposed"))).toEqual({ ok: true, message: "Saved. Sheets: SYNCED. Telegram decision: FAILED." });
    expect(row.status).toBe("APPROVED"); linkedChat = "another-current-chat";
    expect(await executeWebsiteForm(form("retryDecision"))).toMatchObject({ ok: true });
    expect(vi.mocked(sendMessage).mock.calls.map(c => c[0])).toEqual(["987654321", "987654321"]);
    expect(rpc.mock.calls.filter(c => c[0] === "approve_sale")).toHaveLength(1); expect(row.revision).toBe(2); expect(write).toHaveBeenCalledTimes(1);
  });
  it("website without a decision-time link returns exact no-recipient text", async () => {
    linkedChat = null;
    expect(await executeWebsiteForm(form("approveProposed"))).toEqual({ ok: true, message: "Saved. Sheets: SYNCED. Telegram decision: NO_RECIPIENT — No Telegram recipient linked." });
    expect(sendMessage).not.toHaveBeenCalled(); expect(row.status).toBe("APPROVED");
  });
  it("Svetlana links known user with exact IDs through frozen RPC only", async () => {
    expect(await executeWebsiteForm(form("link", { telegramUserId: "900000000000000001", linkedEmployee: kevin }))).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("telegram_set_link", { p_actor_employee_id: manager, p_user_id: "900000000000000001", p_employee_id: kevin });
    expect(read).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  });
  it.each(["", "0", "-1", "1e5", "9223372036854775808"])("rejects invalid link ID %s", async telegramUserId => {
    expect(await executeWebsiteForm(form("link", { telegramUserId, linkedEmployee: kevin }))).toMatchObject({ ok: false }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("honors mutation-time denial even after manager preflight", async () => {
    rpc.mockImplementation((name, args) => name === "approve_sale" ? fail("BD001") : database(name, args));
    expect(await executeWebsiteForm(form("approveProposed"))).toMatchObject({ ok: false }); expect(read).not.toHaveBeenCalled();
  });
  it("ambiguous financial RPC failure gives no success and no deliveries", async () => {
    rpc.mockImplementation((name, args) => name === "create_website_sale" ? Promise.reject(new Error("private secret")) : database(name, args));
    const result = await executeWebsiteForm(form("sale")); expect(result.ok).toBe(false); expect(result.message).not.toContain("secret"); expect(read).not.toHaveBeenCalled();
  });
  it("duplicate actor fields fail closed", async () => {
    const f = form("sale"); f.append("employee", manager);
    expect(await executeWebsiteForm(f)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled();
  });
});
