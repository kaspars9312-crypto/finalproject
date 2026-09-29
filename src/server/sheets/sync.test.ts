import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { createSheetsClient } from "./client";
import { retrySheetsSync, syncTransactionToSheets } from "./sync";
import { employees, sale, approved } from "./fixtures.test-support";
import { SALES_HEADERS, sheetRow } from "./rows";
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("./client", async importOriginal => ({ ...await importOriginal<typeof import("./client")>(), createSheetsClient: vi.fn() }));
const rpc = vi.fn(); const read = vi.fn(); const write = vi.fn(); const append = vi.fn();
const token = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  vi.clearAllMocks(); rpc.mockReset(); read.mockReset().mockResolvedValue([]); write.mockReset().mockResolvedValue(undefined); append.mockReset().mockResolvedValue(undefined);
  vi.mocked(createSheetsClient).mockReturnValue({ read, write, append });
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>);
  rpc.mockResolvedValueOnce(ok({ outcome: "STARTED", token, transaction: sale })).mockResolvedValue(ok({ outcome: "SYNCED" }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
it("marks only the exact written revision synced and uses only sync RPCs", async () => {
  expect(await syncTransactionToSheets(sale.id)).toBe("SYNCED");
  expect(rpc.mock.calls).toEqual([["begin_sheet_sync", { p_transaction_id: sale.id, p_actor_employee_id: null }],
    ["finish_sheet_sync", { p_transaction_id: sale.id, p_token: token, p_written_revision: 1, p_outcome: "SUCCESS" }]]);
});
it("failure updates delivery state only and uses a fresh reference lookup on retry", async () => {
  append.mockRejectedValueOnce(new Error("private token")); rpc.mockResolvedValue(ok({ outcome: "FAILED" }));
  expect(await syncTransactionToSheets(sale.id)).toBe("FAILED");
  expect(rpc.mock.calls[1]).toEqual(["finish_sheet_sync", { p_transaction_id: sale.id, p_token: token, p_written_revision: 1, p_outcome: "FAILED" }]);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain("private token");
  expect(sale.revision).toBe(1); expect(sale.status).toBe("PENDING_APPROVAL");
});
it("stale success sends newest approved revision while retaining ownership", async () => {
  read.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([SALES_HEADERS, sheetRow(sale).values]);
  rpc.mockReset().mockResolvedValueOnce(ok({ outcome: "STARTED", token, transaction: sale }))
    .mockResolvedValueOnce(ok({ outcome: "STALE", transaction: approved })).mockResolvedValueOnce(ok({ outcome: "SYNCED" }));
  expect(await syncTransactionToSheets(sale.id)).toBe("SYNCED");
  expect(append.mock.calls[0][1][0][16]).toBe("Pending approval"); expect(append).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenLastCalledWith("'Sales'!A2:Q2", [sheetRow(approved).values]);
  expect(rpc.mock.calls[2][1]).toMatchObject({ p_token: token, p_written_revision: 2, p_outcome: "SUCCESS" });
});
it("bounded revision churn leaves pending for retry", async () => {
  rpc.mockReset().mockResolvedValueOnce(ok({ outcome: "STARTED", token, transaction: sale }))
    .mockResolvedValueOnce(ok({ outcome: "STALE", transaction: { ...sale, revision: 2 } }))
    .mockResolvedValueOnce(ok({ outcome: "STALE", transaction: { ...sale, revision: 3 } }))
    .mockResolvedValueOnce(ok({ outcome: "STALE", transaction: { ...sale, revision: 4 } }))
    .mockResolvedValueOnce(ok({ outcome: "PENDING" }));
  expect(await syncTransactionToSheets(sale.id)).toBe("PENDING"); expect(append).toHaveBeenCalledTimes(3);
  expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_outcome: "PENDING" });
});
it.each(["BUSY", "SYNCED"])("%s attempts do not write externally", async outcome => {
  rpc.mockReset().mockResolvedValue(ok({ outcome })); expect(await syncTransactionToSheets(sale.id)).toBe(outcome); expect(createSheetsClient).not.toHaveBeenCalled();
});
it("manager retry never calls financial creation or decisions", async () => {
  expect(await retrySheetsSync(employees[0].id, sale.id)).toBe("SYNCED");
  expect(rpc.mock.calls[0][1].p_actor_employee_id).toBe(employees[0].id);
  expect(rpc.mock.calls.map(call => call[0])).toEqual(["begin_sheet_sync", "finish_sheet_sync"]);
});
it("non-manager or inactive actor denial reaches no Google call", async () => {
  rpc.mockReset().mockResolvedValue({ data: null, error: { code: "BF001", message: "private" } });
  expect(await retrySheetsSync(employees[1].id, sale.id)).toBe("FORBIDDEN"); expect(createSheetsClient).not.toHaveBeenCalled();
});
it.each(["", "null", "MANAGER"])("invalid actor %s cannot select trusted post-commit mode", async actor => {
  expect(await retrySheetsSync(actor, sale.id)).toBe("FORBIDDEN"); expect(rpc).not.toHaveBeenCalled();
});
it("configuration failure is persisted as sanitized FAILED", async () => {
  vi.mocked(createSheetsClient).mockImplementationOnce(() => { throw new Error("private key"); });
  expect(await syncTransactionToSheets(sale.id)).toBe("FAILED"); expect(rpc.mock.calls.at(-1)?.[1].p_outcome).toBe("FAILED");
});
it("uncertain finish does not falsely report success or blindly release ownership", async () => {
  rpc.mockReset().mockResolvedValueOnce(ok({ outcome: "STARTED", token, transaction: sale })).mockRejectedValueOnce(new Error("DB unavailable"));
  expect(await syncTransactionToSheets(sale.id)).toBe("PENDING"); expect(rpc).toHaveBeenCalledTimes(2);
});
it("failed state tracking retains pending intent without financial replay", async () => {
  append.mockRejectedValueOnce(new Error("external down"));
  rpc.mockReset().mockResolvedValueOnce(ok({ outcome: "STARTED", token, transaction: sale })).mockRejectedValueOnce(new Error("DB down"));
  expect(await syncTransactionToSheets(sale.id)).toBe("PENDING"); expect(rpc).toHaveBeenCalledTimes(2);
});
