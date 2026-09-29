import { beforeEach, expect, it, vi } from "vitest";
import { processUpdate } from "./controller";
import { applyUpdate, markConfirmation } from "./persistence";
import { sendMessage } from "./client";
import { syncTransactionToSheets } from "../sheets/sync";
import type { UpdateResult } from "./types";
vi.mock("server-only", () => ({}));
vi.mock("./persistence", () => ({ applyUpdate: vi.fn(), markConfirmation: vi.fn(), readSession: vi.fn() }));
vi.mock("./client", () => ({ sendMessage: vi.fn() }));
vi.mock("../sheets/sync", () => ({ syncTransactionToSheets: vi.fn() }));
const update = { update_id: "1", message: { from: { id: "123" }, chat: { id: "456", type: "private" as const }, text: "/sale" } };
const saved: UpdateResult = { outcome: "SAVED", transaction: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reference: "practice",
  amount_cents: "100", transaction_type: "SALE", status: "PENDING_APPROVAL", destination: "A", target_chat_id: "789" } };
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(applyUpdate).mockResolvedValue(saved); vi.mocked(syncTransactionToSheets).mockResolvedValue("SYNCED");
});
it("awaits committed SAVED receipt before either external side effect", async () => {
  let commit!: (result: UpdateResult) => void;
  vi.mocked(applyUpdate).mockImplementation(() => new Promise(resolve => { commit = resolve; }));
  const task = processUpdate(update);
  expect(syncTransactionToSheets).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
  commit(saved); await task;
  expect(syncTransactionToSheets).toHaveBeenCalledExactlyOnceWith(saved.transaction.id);
  expect(markConfirmation).toHaveBeenCalledExactlyOnceWith(saved.transaction.id, true);
});
it("Sheets rejection does not prevent a successful confirmation", async () => {
  vi.mocked(syncTransactionToSheets).mockRejectedValue(new Error("external failure")); await processUpdate(update);
  expect(markConfirmation).toHaveBeenCalledWith(saved.transaction.id, true);
});
it("confirmation failure does not downgrade successful Sheets delivery", async () => {
  vi.mocked(sendMessage).mockRejectedValue(new Error("delivery failed")); await processUpdate(update);
  expect(syncTransactionToSheets).toHaveBeenCalledTimes(1); expect(markConfirmation).toHaveBeenCalledWith(saved.transaction.id, false);
});
it("confirmation tracking error waits for the independent Sheets attempt", async () => {
  vi.mocked(markConfirmation).mockRejectedValue(new Error("DB unavailable"));
  await expect(processUpdate(update)).rejects.toThrow(); expect(syncTransactionToSheets).toHaveBeenCalledTimes(1);
});
it.each(["DUPLICATE", "FORBIDDEN", "INVALID", "DUPLICATE_REFERENCE"] as const)("does not sync unsaved outcome %s", async outcome => {
  vi.mocked(applyUpdate).mockResolvedValue({ outcome }); await processUpdate(update); expect(syncTransactionToSheets).not.toHaveBeenCalled();
});
it("failed financial save attempts no side effects", async () => {
  vi.mocked(applyUpdate).mockRejectedValue(new Error("DB failure"));
  await expect(processUpdate(update)).rejects.toThrow(); expect(syncTransactionToSheets).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
});
