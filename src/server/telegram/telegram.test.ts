import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { POST, runtime } from "../../app/api/telegram/webhook/route";
import { sendMessage, TelegramApiError } from "./client";
import { processUpdate } from "./controller";
import { setManagerTelegramLink } from "./persistence";
import { euroCents, validateAnswer } from "./wizard";
import { parseUpdate, telegramId, type Session } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("../sheets/sync", () => ({ syncTransactionToSheets: vi.fn().mockResolvedValue("PENDING") }));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
const rpc = vi.fn();
const http = vi.fn();
const employee = "11111111-1111-4111-8111-111111111111";
const transaction = "22222222-2222-4222-8222-222222222222";
const session: Session = { telegram_user_id: "123", chat_id: "456", employee_id_at_start: employee,
  flow_type: "SALE", step: "project", draft_payload: { reference: "Case / Ref", customer: "Customer" }, updated_at: "2026-09-28T00:00:00.123456+00:00" };
const saved = { outcome: "SAVED", transaction: { id: transaction, reference: "Case / Ref", amount_cents: "12345",
  transaction_type: "SALE", status: "PENDING_APPROVAL", destination: "A", target_chat_id: "789" } };
const ok = (data: unknown) => ({ data, error: null });
const update = (text: string, id = "1") => ({ update_id: id,
  message: { from: { id: "123" }, chat: { id: "456", type: "private" as const }, text } });
const request = (body: unknown, secret: string | null = "test-secret") => new Request("http://localhost/api/telegram/webhook", {
  method: "POST", headers: secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(body),
});
const sentText = () => JSON.parse(http.mock.calls.at(-1)?.[1].body ?? "{}").text as string;
beforeEach(() => {
  vi.clearAllMocks(); rpc.mockReset(); http.mockReset();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token"); vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  rpc.mockResolvedValue(ok({ outcome: "HELP" }));
  http.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("webhook and identity", () => {
  it.each([null, "wrong", "same-length"])("rejects unauthorized secret %s before parsing or DB", async secret => {
    expect((await POST(request(update("/start"), secret))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it("fails closed without configuration and uses node runtime", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await POST(request({}))).status).toBe(503); expect(runtime).toBe("nodejs");
  });
  it("rejects malformed JSON safely", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" }, body: "{" }));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{}, null, { update_id: 1, callback_query: {} }, { update_id: 1, edited_message: {} },
    { update_id: 1, message: { ...update("/start").message, chat: { id: -1, type: "group" } } },
    { update_id: 1, message: { ...update("/start").message, text: undefined } }])("ignores unsupported update %j", async body => {
    expect((await POST(request(body))).status).toBe(200); expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps sender/chat IDs distinct and ignores usernames and self-assignment data", async () => {
    rpc.mockResolvedValueOnce(ok({ outcome: "START", employee_name: null, role: null }));
    await POST(request({ update_id: 1, message: { ...update("/start Richard").message,
      from: { id: 123, username: "SVETLANA", first_name: "Manager" }, employee_id: employee, role: "MANAGER" } }));
    expect(rpc).toHaveBeenCalledExactlyOnceWith("telegram_apply_update", { p_update_id: "1", p_user_id: "123",
      p_chat_id: "456", p_command: "START", p_expected_session: null, p_value: null });
    expect(sentText()).toMatch(/not linked.*manager/i);
  });
  it("identifies linked employee and available commands", async () => {
    rpc.mockResolvedValueOnce(ok({ outcome: "START", employee_name: "Richard Darling", role: "SALESPERSON" }));
    await processUpdate(update("/start")); expect(sentText()).toMatch(/Richard Darling.*SALESPERSON.*\/sale/);
  });
  it("preserves bigint string IDs but rejects unsafe JSON numbers", () => {
    expect(telegramId("900000000000000001")).toBe("900000000000000001");
    expect(() => telegramId(900000000000000001)).toThrow();
    expect(() => telegramId("9223372036854775808")).toThrow();
    expect(parseUpdate({ ...update("/start"), update_id: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });
  it("sanitizes database errors with retryable HTTP status and no recorded message", async () => {
    rpc.mockRejectedValueOnce(new Error("SQL internals test-token"));
    const response = await POST(request(update("/sale")));
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/SQL|test-token/);
    expect(http).not.toHaveBeenCalled();
  });
});

describe("commands and persistent wizard boundary", () => {
  it.each([["salesperson sale", "/sale", "PROMPT"], ["Kevin sale", "/sale", "FORBIDDEN"],
    ["Kevin expense", "/expense", "PROMPT"], ["salesperson expense", "/expense", "FORBIDDEN"],
    ["manager sale", "/sale", "FORBIDDEN"], ["unlinked sale", "/sale", "UNLINKED"]])("handles DB-authorized %s", async (_label, command, outcome) => {
    rpc.mockResolvedValueOnce(ok({ outcome, step: "reference" }));
    await processUpdate(update(command));
    expect(rpc.mock.calls[0][1].p_command).toBe(command.slice(1).toUpperCase());
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("role");
    expect(sentText()).toMatch(outcome === "PROMPT" ? /reference/ : outcome === "FORBIDDEN" ? /role cannot/ : /not linked/);
  });
  it("cancels through the atomic claim RPC even for unlinked users", async () => {
    rpc.mockResolvedValueOnce(ok({ outcome: "CANCELLED" })); await processUpdate(update("/cancel"));
    expect(rpc.mock.calls[0][1].p_command).toBe("CANCEL"); expect(sentText()).toContain("cancelled");
  });
  it("does not provide a bot mapping command", async () => {
    await processUpdate(update("/link Richard")); expect(rpc.mock.calls[0][1].p_command).toBe("HELP");
  });
  it("claims an invalid answer with null value and exact snapshot, without advancing", async () => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok({ outcome: "INVALID" }));
    await processUpdate(update("C"));
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_value: null, p_expected_session: session });
    expect(sentText()).toContain("Project must be A or B");
    expect(session.step).toBe("project");
  });
  it("re-reads persistent session on each request and sends only normalized answer", async () => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok({ outcome: "PROMPT", step: "description" }));
    await processUpdate(update(" b "));
    expect(rpc.mock.calls[0]).toEqual(["telegram_read_session", { p_user_id: "123" }]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_value: "B", p_expected_session: session });
  });
  it("duplicate final delivery is silent, never a duplicate-reference error", async () => {
    rpc.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce(ok({ outcome: "DUPLICATE" }));
    expect((await POST(request(update("20")))).status).toBe(200);
    expect(http).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([["DUPLICATE_REFERENCE", /reference is already recorded/], ["STALE_SESSION", /link or role changed/],
    ["SESSION_CHANGED", /answer was not applied/]])("explains %s without claiming success", async (outcome, pattern) => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok({ outcome }));
    await processUpdate(update("A")); expect(sentText()).toMatch(pattern);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("money and exact decimal validation", () => {
  it.each([["0.01", "1"], ["12.50", "1250"], ["90071992547409.91", "9007199254740991"]])("converts %s safely", (value, cents) => {
    expect(euroCents(value)).toBe(cents);
  });
  it.each([["0", /positive/], ["-1", /positive/], ["1.234", /2 decimal/], ["1e2", /decimal amount/],
    ["90071992547409.92", /safe cents/], ["", /required/]])("rejects amount %s", (value, pattern) => expect(() => euroCents(value)).toThrow(pattern));
  it.each([["", /required/], ["20%", /plain decimal/], ["101", /between 0 and 100/], ["-1", /between 0 and 100/]])("rejects percentage %s", (value, pattern) => {
    expect(validateAnswer({ ...session, step: "proposed_richard_pct" }, value)).toMatchObject({ value: null, error: expect.stringMatching(pattern) });
  });
  it("uses Block C exact split validation including arbitrary decimal precision", () => {
    expect(validateAnswer({ ...session, step: "proposed_jean_claude_pct", draft_payload: { proposed_richard_pct: "12.5", proposed_anastasia_pct: "37.5" } }, "50")).toEqual({ value: "50" });
    expect(validateAnswer({ ...session, step: "proposed_jean_claude_pct", draft_payload: { proposed_richard_pct: "60", proposed_anastasia_pct: "30" } }, "20"))
      .toMatchObject({ value: null, error: expect.stringContaining("exactly 100") });
  });
  it.each([["reference", " Ref Ab ", "Ref Ab"], ["expense_category", " Travel ", "TRAVEL"],
    ["proposed_allocation", "Company overhead", "COMPANY_OVERHEAD"]])("normalizes %s", (step, text, value) => {
    expect(validateAnswer({ ...session, step }, text)).toEqual({ value });
  });
  it.each([["customer", ""], ["description", " "], ["expense_category", "Food"], ["proposed_allocation", "C"]])("rejects invalid %s", (step, text) => {
    expect(validateAnswer({ ...session, step }, text).value).toBeNull();
  });
});

describe("post-commit confirmation", () => {
  it("waits for DB success and delivers to persisted origin before marking SENT", async () => {
    let commit!: (value: unknown) => void;
    rpc.mockResolvedValueOnce(ok(session)).mockImplementationOnce(() => new Promise(resolve => { commit = resolve; })).mockResolvedValueOnce(ok(null));
    const pending = processUpdate(update("A"));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(http).not.toHaveBeenCalled(); commit(ok(saved)); await pending;
    expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({ chat_id: "789", text: expect.stringMatching(/Case \/ Ref recorded.*€123.45.*Project: A.*Pending approval/) });
    expect(rpc).toHaveBeenLastCalledWith("telegram_mark_confirmation", { p_transaction_id: transaction, p_sent: true });
  });
  it("failed send keeps saved transaction and marks FAILED with no financial retry", async () => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok(saved)).mockResolvedValueOnce(ok(null));
    http.mockRejectedValueOnce(new Error("https://bot-test-token private"));
    await processUpdate(update("A"));
    expect(rpc).toHaveBeenLastCalledWith("telegram_mark_confirmation", { p_transaction_id: transaction, p_sent: false });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it.each([["COMPANY_OVERHEAD", "ALLOCATED", "Company overhead", "Allocated"], ["B", "AWAITING_ALLOCATION", "B", "Awaiting allocation"]])("confirms expense %s", async (destination, status, label, statusLabel) => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok({ ...saved, transaction: {
      ...saved.transaction, transaction_type: "EXPENSE", destination, status } })).mockResolvedValueOnce(ok(null));
    await processUpdate(update("A")); expect(sentText()).toContain(`Proposed allocation: ${label}. Status: ${statusLabel}`);
  });
  it("does not mislabel successful delivery FAILED if status persistence fails", async () => {
    rpc.mockResolvedValueOnce(ok(session)).mockResolvedValueOnce(ok(saved)).mockRejectedValueOnce(new Error("DB down"));
    expect((await POST(request(update("A")))).status).toBe(503);
    expect(rpc.mock.calls.filter(call => call[0] === "telegram_mark_confirmation")).toEqual([
      ["telegram_mark_confirmation", { p_transaction_id: transaction, p_sent: true }],
    ]);
  });
});

describe("Telegram HTTP boundary and manager backend", () => {
  it.each([new Response("{}", { status: 500 }), new Response('{"ok":false,"description":"test-token"}'), new Response("invalid")])("rejects HTTP/API/malformed failures with safe typed error", async response => {
    http.mockResolvedValueOnce(response);
    await expect(sendMessage("456", "Hello")).rejects.toEqual(new TelegramApiError("DELIVERY_FAILED"));
  });
  it("sends a plain JSON POST with timeout and exact ID", async () => {
    await sendMessage("900000000000000001", "Hello");
    expect(http).toHaveBeenCalledWith("https://api.telegram.org/bottest-token/sendMessage", expect.objectContaining({ method: "POST",
      body: '{"chat_id":"900000000000000001","text":"Hello"}', signal: expect.any(AbortSignal) }));
  });
  it("requires bot configuration only on use", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", ""); await expect(sendMessage("456", "Hello")).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(http).not.toHaveBeenCalled();
  });
  it("requires manager actor and respects DB stored-role denial", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "BE001", message: "private SQL" } });
    await expect(setManagerTelegramLink(employee, "123", transaction)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).toHaveBeenCalledWith("telegram_set_link", { p_actor_employee_id: employee, p_user_id: "123", p_employee_id: transaction });
    await expect(setManagerTelegramLink("", "123", transaction)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1); expect(http).not.toHaveBeenCalled();
  });
  it("keeps tokens and secret on server with blank env examples", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toMatch(/^TELEGRAM_BOT_TOKEN=\r?$/m); expect(env).toMatch(/^TELEGRAM_WEBHOOK_SECRET=\r?$/m);
    expect(env).not.toContain("NEXT_PUBLIC_");
    expect(readFileSync("src/server/telegram/client.ts", "utf8")).toContain('import "server-only"');
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toMatch(/TELEGRAM|telegram/);
  });
});
