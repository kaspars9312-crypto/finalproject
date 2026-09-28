import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { allocateExpense, approveSale, correctPendingSale, createWebsiteExpense, createWebsiteSale,
  type CreateWebsiteExpenseInput, type CreateWebsiteSaleInput } from "./transactions";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
const rpc = vi.fn();
const actorEmployeeId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const split = { RICHARD: "50", ANASTASIA: "30", JEAN_CLAUDE: "20" };
const sale: CreateWebsiteSaleInput = { actorEmployeeId, reference: " qa / Sale ", customer: " Customer ",
  project: "A", description: " Description ", amountCents: 100000, proposedSplit: split };
const expense: CreateWebsiteExpenseInput = { actorEmployeeId, reference: " qa / Expense ",
  description: " Expense ", amountCents: 8000, category: "TRAVEL", proposedAllocation: "B" };
const decision = { actorEmployeeId, transactionId, expectedRevision: 1 };
const receipt = { id: transactionId, reference: "qa / Sale", status: "PENDING_APPROVAL", revision: 1 };
const readRow = { status: "PENDING_APPROVAL", revision: 1, amount_cents: "100000",
  proposed_richard_pct: "50", proposed_anastasia_pct: "30", proposed_jean_claude_pct: "20" };
const ok = (data: unknown) => ({ data, error: null });
const error = (code: string) => ({ data: null, error: { code, message: "Sensitive internal details", details: "secret" } });
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset().mockResolvedValue(ok(receipt));
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed in unit tests"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("website creation boundaries", () => {
  it("normalizes sale input and passes exact strings without a supplied role or snapshot", async () => {
    const input = Object.freeze({ ...sale, role: "MANAGER", original_submission: "untrusted",
      proposedSplit: { RICHARD: " 12.5 ", ANASTASIA: "37.5", JEAN_CLAUDE: "50" } });
    expect(await createWebsiteSale(input)).toEqual({ ok: true, transaction: receipt });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_website_sale", {
      p_actor_employee_id: actorEmployeeId, p_reference: "qa / Sale", p_customer: "Customer",
      p_project: "A", p_description: "Description", p_amount_cents: "100000",
      p_richard_pct: "12.5", p_anastasia_pct: "37.5", p_jean_claude_pct: "50",
    });
    expect(input.customer).toBe(" Customer ");
  });
  it.each(["A", "B", "COMPANY_OVERHEAD"] as const)("passes expense proposal %s to its atomic RPC", async (allocation) => {
    await createWebsiteExpense({ ...expense, proposedAllocation: allocation });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_website_expense", {
      p_actor_employee_id: actorEmployeeId, p_reference: "qa / Expense", p_description: "Expense",
      p_amount_cents: "8000", p_category: "TRAVEL", p_proposed_allocation: allocation,
    });
  });
  it.each([
    { reference: " \n " }, { customer: " " }, { description: "" }, { project: "C" },
    { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { actorEmployeeId: "not-a-uuid" }, { proposedSplit: { ...split, RICHARD: "60" } },
    { proposedSplit: { RICHARD: "33.33", ANASTASIA: "33.33", JEAN_CLAUDE: "33.33" } },
    { proposedSplit: { ...split, RICHARD: 50 } },
  ])("rejects invalid sale before client creation: %j", async (override) => {
    expect(await createWebsiteSale({ ...sale, ...override } as CreateWebsiteSaleInput))
      .toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
  it.each([{ category: "Food" }, { proposedAllocation: "C" }, { amountCents: 0 }, { description: " " }])(
    "validates expenses: %j", async (override) => {
      expect(await createWebsiteExpense({ ...expense, ...override } as CreateWebsiteExpenseInput))
        .toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      expect(rpc).not.toHaveBeenCalled();
    });
});

describe("manager operation boundaries", () => {
  it("corrects only allowed fields with expected revision", async () => {
    await correctPendingSale({ ...sale, ...decision });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("correct_pending_sale", {
      p_actor_employee_id: actorEmployeeId, p_transaction_id: transactionId, p_expected_revision: 1,
      p_customer: "Customer", p_project: "A", p_description: "Description", p_amount_cents: "100000",
    });
  });
  it.each([0, -1, 1.5, NaN, 2147483648])("rejects invalid expected revision %s", async (expectedRevision) => {
    expect(await allocateExpense({ ...decision, expectedRevision, finalAllocation: "A" }))
      .toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("allocates without resubmitting amount, proposal or original snapshot", async () => {
    await allocateExpense({ ...decision, finalAllocation: "A" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("allocate_expense", {
      p_actor_employee_id: actorEmployeeId, p_transaction_id: transactionId,
      p_expected_revision: 1, p_final_allocation: "A",
    });
  });
  it("defaults approval to the stored employee proposal using the current corrected amount", async () => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, amount_cents: "12345" }));
    await approveSale(decision);
    expect(rpc).toHaveBeenNthCalledWith(1, "read_sale_for_approval", {
      p_actor_employee_id: actorEmployeeId, p_transaction_id: transactionId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "approve_sale", {
      p_actor_employee_id: actorEmployeeId, p_transaction_id: transactionId, p_expected_revision: 1,
      p_richard_pct: "50", p_anastasia_pct: "30", p_jean_claude_pct: "20",
      p_pool_cents: "1235", p_richard_cents: "617", p_anastasia_cents: "371", p_jean_claude_cents: "247",
    });
  });
  it("uses optional override and Block C's negative residual / Richard tie rule", async () => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, amount_cents: "5" }));
    await approveSale({ ...decision, finalSplit: { RICHARD: "50", ANASTASIA: "50", JEAN_CLAUDE: "0" } });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_richard_pct: "50", p_anastasia_pct: "50", p_jean_claude_pct: "0",
      p_pool_cents: "1", p_richard_cents: "0", p_anastasia_cents: "1", p_jean_claude_cents: "0" });
  });
  it("preserves NUMERIC precision beyond binary floating point", async () => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, amount_cents: "5",
      proposed_richard_pct: "49.999999999999999999999999999999",
      proposed_anastasia_pct: "50.000000000000000000000000000001", proposed_jean_claude_pct: "0" }));
    await approveSale(decision);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_richard_pct: "49.999999999999999999999999999999",
      p_anastasia_pct: "50.000000000000000000000000000001", p_richard_cents: "0", p_anastasia_cents: "1" });
  });
  it("rejects invalid override before any read", async () => {
    expect(await approveSale({ ...decision, finalSplit: { ...split, RICHARD: "60" } }))
      .toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ revision: 2 }, { status: "APPROVED" }])("rejects a stale read: %j", async (override) => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, ...override }));
    expect(await approveSale(decision)).toMatchObject({ ok: false, error: { code: "STALE_CONFLICT" } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("maps a correction winning between read and approval to conflict without retry", async () => {
    rpc.mockResolvedValueOnce(ok(readRow)).mockResolvedValueOnce(error("BD003"));
    expect(await approveSale(decision)).toMatchObject({ ok: false, error: { code: "STALE_CONFLICT" } });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each(["9007199254740992", "9223372036854775807", 100000, "1.1", "-1", "0", null])(
    "rejects unsafe or lossy stored money %j before mutation", async (amount_cents) => {
      rpc.mockResolvedValueOnce(ok({ ...readRow, amount_cents }));
      expect(await approveSale(decision)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  it("accepts maximum safe stored cents", async () => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, amount_cents: "9007199254740991" }));
    expect(await approveSale(decision)).toMatchObject({ ok: true });
    expect(rpc.mock.calls[1][1].p_pool_cents).toBe("900719925474099");
  });
  it("refuses already-parsed numeric percentages from a broken DB adapter", async () => {
    rpc.mockResolvedValueOnce(ok({ ...readRow, proposed_richard_pct: 50 }));
    expect(await approveSale(decision)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("stable sanitized errors", () => {
  it.each([
    ["BD001", "FORBIDDEN"], ["BD002", "NOT_FOUND"], ["BD003", "STALE_CONFLICT"],
    ["BD004", "INVALID_STATE"], ["BD005", "DUPLICATE_REFERENCE"], ["23514", "VALIDATION"],
    ["22003", "VALIDATION"], ["40001", "STALE_CONFLICT"], ["40P01", "STALE_CONFLICT"],
    ["23505", "DATABASE_ERROR"], ["XX000", "DATABASE_ERROR"],
  ])("maps SQLSTATE %s to %s", async (sqlstate, code) => {
    rpc.mockResolvedValueOnce(error(sqlstate));
    const result = await createWebsiteSale(sale);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toMatch(/Sensitive|secret/);
  });
  it("does not let a claimed manager role override database denial", async () => {
    rpc.mockResolvedValueOnce(error("BD001"));
    const input = { ...decision, finalAllocation: "A" as const, role: "MANAGER" };
    expect(await allocateExpense(input)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("role");
  });
  it("sanitizes missing configuration and uncertain network errors", async () => {
    vi.mocked(createSupabaseAdminClient).mockImplementationOnce(() => { throw new Error("private configuration"); });
    expect(await createWebsiteSale(sale)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
    rpc.mockRejectedValueOnce(new Error("internal network detail"));
    expect(await createWebsiteSale(sale)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });
  it.each([null, [], {}, { ...receipt, revision: 0 }])("rejects malformed RPC receipt %j", async (data) => {
    rpc.mockResolvedValueOnce(ok(data));
    expect(await createWebsiteSale(sale)).toMatchObject({ ok: false, error: { code: "DATABASE_ERROR" } });
  });
});
