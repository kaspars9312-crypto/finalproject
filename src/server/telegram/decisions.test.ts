import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { approved, expense, employees } from "../sheets/fixtures.test-support";
import { decisionText, deliverDecision, type DecisionRecord } from "./decisions";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
const rpc = vi.fn(); const http = vi.fn();
const token = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const manager = employees[0].id;
const saleDecision: DecisionRecord = { ...approved, commission_pool_cents: "1235" };
const expenseDecision: DecisionRecord = { ...expense, status: "ALLOCATED", final_allocation: "A", commission_pool_cents: null };
const ok = (data: unknown) => ({ data, error: null });
const claim = (transaction = saleDecision, target = "900000000000000001") => ({ outcome: "STARTED", token, transaction, target_chat_id: target });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("TELEGRAM_BOT_TOKEN", "fake-decision-test-token");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  rpc.mockResolvedValueOnce(ok(claim())).mockImplementation(async (_name, args) => ok({ outcome: args.p_outcome }));
  http.mockImplementation(async () => new Response('{"ok":true}')); vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("persisted decision messages", () => {
  it("sale contains reference amount pool all final shares/euros and explicit changed proposal", () => {
    const text = decisionText(saleDecision);
    for (const part of [approved.reference, "Sale amount: €123.45", "Total commission pool: €12.35", "MANAGER CHANGED THE SPLIT",
      "Richard: 12.5% → 20% = €2.47", "Anastasia: 37.5% → 40% = €4.94", "Jean-Claude: 50% → 40% = €4.94"]) expect(text).toContain(part);
  });
  it("equivalent decimal formatting is not a changed split", () => {
    const text = decisionText({ ...saleDecision, proposed_richard_pct: "20.000", proposed_anastasia_pct: "40.0", proposed_jean_claude_pct: "40" });
    expect(text).toContain("Manager changed the split: No"); expect(text).not.toContain("→");
  });
  it("expense contains amount description and clearly changed allocation", () => {
    const text = decisionText(expenseDecision);
    for (const part of [expense.reference, "€123.45", expense.description, "proposed B → final A"]) expect(text).toContain(part);
  });
  it("unchanged expense allocation is explicitly confirmed", () => {
    expect(decisionText({ ...expenseDecision, final_allocation: "B" })).toContain("Proposed allocation confirmed. Final allocation: B");
  });
  it("overhead destination is readable", () => {
    expect(decisionText({ ...expenseDecision, final_allocation: "COMPANY_OVERHEAD" })).toContain("final Company overhead");
  });
  it("automatic overhead has no later decision message", () => {
    expect(() => decisionText({ ...expenseDecision, proposed_allocation: "COMPANY_OVERHEAD", final_allocation: "COMPANY_OVERHEAD" })).toThrow();
  });
});

describe("claimed delivery and retries", () => {
  it.each(["Telegram-origin original chat", "website decision-time linked chat"])("uses only persisted %s, with one send to submitter", async () => {
    expect(await deliverDecision(manager, approved.id)).toBe("SENT");
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({ chat_id: "900000000000000001", text: decisionText(saleDecision) });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(["begin_decision_delivery", "finish_decision_delivery"]);
  });
  it("expense delivers only to reporter target", async () => {
    rpc.mockReset().mockResolvedValueOnce(ok(claim(expenseDecision, "700"))).mockResolvedValueOnce(ok({ outcome: "SENT" }));
    expect(await deliverDecision(manager, expense.id)).toBe("SENT");
    expect(JSON.parse(http.mock.calls[0][1].body).chat_id).toBe("700"); expect(http).toHaveBeenCalledTimes(1);
  });
  it("does not mark SENT before Telegram confirms success", async () => {
    let release!: (response: Response) => void;
    http.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const delivery = deliverDecision(manager, approved.id);
    await vi.waitFor(() => expect(http).toHaveBeenCalledTimes(1)); expect(rpc).toHaveBeenCalledTimes(1);
    release(new Response('{"ok":true}')); expect(await delivery).toBe("SENT");
    expect(rpc).toHaveBeenLastCalledWith("finish_decision_delivery", { p_transaction_id: approved.id, p_token: token, p_outcome: "SENT" });
  });
  it.each(["SENT", "NO_RECIPIENT", "NOT_REQUIRED", "BUSY"])("%s claim never sends or mutates finances", async outcome => {
    rpc.mockReset().mockResolvedValue(ok({ outcome })); expect(await deliverDecision(manager, approved.id)).toBe(outcome);
    expect(http).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["transport", "api", "http", "malformed"])("%s failure records FAILED with fixed vocabulary only", async mode => {
    if (mode === "transport") http.mockRejectedValueOnce(new Error("private token-bearing URL"));
    else http.mockResolvedValueOnce(new Response(mode === "api" ? '{"ok":false}' : mode === "malformed" ? "bad" : "{}", { status: mode === "http" ? 403 : 200 }));
    expect(await deliverDecision(manager, approved.id)).toBe("FAILED");
    expect(rpc).toHaveBeenLastCalledWith("finish_decision_delivery", { p_transaction_id: approved.id, p_token: token, p_outcome: "FAILED" });
    expect(console.error).not.toHaveBeenCalled(); expect(JSON.stringify(rpc.mock.calls)).not.toContain("private");
  });
  it("successful send with failed tracking stays PENDING and never downgrades or releases claim", async () => {
    rpc.mockReset().mockResolvedValueOnce(ok(claim())).mockRejectedValueOnce(new Error("private DB failure"));
    expect(await deliverDecision(manager, approved.id)).toBe("PENDING"); expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].p_outcome).toBe("SENT");
  });
  it("failed send with failed tracking stays PENDING", async () => {
    http.mockRejectedValueOnce(new Error("private"));
    rpc.mockReset().mockResolvedValueOnce(ok(claim())).mockRejectedValueOnce(new Error("private DB"));
    expect(await deliverDecision(manager, approved.id)).toBe("PENDING"); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("non-manager SQL denial sends nothing", async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { code: "BG001", message: "private" } });
    expect(await deliverDecision(employees[1].id, approved.id)).toBe("FORBIDDEN"); expect(http).not.toHaveBeenCalled();
  });
  it.each(["", "MANAGER", "null"])("invalid actor %s cannot claim", async actor => {
    expect(await deliverDecision(actor, approved.id)).toBe("FORBIDDEN"); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ target_chat_id: 123 }, { target_chat_id: "0" }, { transaction: { ...saleDecision, amount_cents: 12345 } },
    { transaction: { ...saleDecision, commission_pool_cents: 1235 } }, { transaction: { ...saleDecision, id: expense.id } }])("malformed exact receipt never sends: %j", async override => {
    rpc.mockReset().mockResolvedValueOnce(ok({ ...claim(), ...override })).mockResolvedValueOnce(ok({ outcome: "FAILED" }));
    expect(await deliverDecision(manager, approved.id)).toBe("FAILED"); expect(http).not.toHaveBeenCalled();
  });
  it("unrecognized finish outcome is never reported SENT", async () => {
    rpc.mockReset().mockResolvedValueOnce(ok(claim())).mockResolvedValueOnce(ok({ outcome: "UNKNOWN" }));
    expect(await deliverDecision(manager, approved.id)).toBe("PENDING");
  });
});
