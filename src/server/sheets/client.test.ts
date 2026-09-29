import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JWT } from "google-auth-library";
import { createSheetsClient, upsertReference, type SheetsClient } from "./client";
import { SALES_HEADERS, sheetRow } from "./rows";
import { sale } from "./fixtures.test-support";
vi.mock("server-only", () => ({}));
vi.mock("google-auth-library", () => ({ JWT: vi.fn() }));
const token = vi.fn(); const http = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); token.mockReset().mockResolvedValue({ token: "fake-access-token" });
  vi.mocked(JWT).mockImplementation(function () { return { getAccessToken: token, transporter: { defaults: {} } } as unknown as JWT; });
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "fake@example.invalid");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "fake\\nkey");
  vi.stubEnv("GOOGLE_SHEETS_SPREADSHEET_ID", "fake-sheet");
  http.mockReset().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const fake = (rows: string[][]): SheetsClient => ({ read: vi.fn().mockResolvedValue(rows), write: vi.fn(), append: vi.fn() });
it("updates the matching reference at its current row number", async () => {
  const client = fake([SALES_HEADERS, ["Another"], [sale.reference]]);
  await upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values);
  expect(client.write).toHaveBeenCalledExactlyOnceWith("'Sales'!A3:Q3", [sheetRow(sale).values]); expect(client.append).not.toHaveBeenCalled();
});
it("appends an absent reference", async () => {
  const client = fake([SALES_HEADERS]); await upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values);
  expect(client.append).toHaveBeenCalledExactlyOnceWith("'Sales'!A:Q", [sheetRow(sale).values]); expect(client.write).not.toHaveBeenCalled();
});
it("creates a missing header before appending", async () => {
  const client = fake([]); await upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values);
  expect(client.write).toHaveBeenCalledWith("'Sales'!A1:Q1", [SALES_HEADERS]); expect(client.append).toHaveBeenCalledTimes(1);
});
it("rejects duplicate references without any write", async () => {
  const client = fake([SALES_HEADERS, [sale.reference], [sale.reference]]);
  await expect(upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values)).rejects.toMatchObject({ code: "DUPLICATE_REFERENCE" });
  expect(client.write).not.toHaveBeenCalled(); expect(client.append).not.toHaveBeenCalled();
});
it("refuses incompatible headers without overwriting data", async () => {
  const client = fake([[sale.reference]]);
  await expect(upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values)).rejects.toMatchObject({ code: "HEADERS" });
  expect(client.write).not.toHaveBeenCalled(); expect(client.append).not.toHaveBeenCalled();
});
it("keeps case-sensitive reference identity", async () => {
  const client = fake([SALES_HEADERS, [sale.reference.toUpperCase()]]);
  await upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values); expect(client.append).toHaveBeenCalledTimes(1);
});
it("retry after a committed write with a lost response finds and updates the same reference", async () => {
  const rows = [SALES_HEADERS];
  const client = { read: vi.fn(async () => rows), write: vi.fn(), append: vi.fn(async (_range: string, values: string[][]) => {
    rows.push(...values); throw new Error("Response lost after commit");
  }) };
  await expect(upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values)).rejects.toThrow();
  await upsertReference(client, "Sales", SALES_HEADERS, sheetRow(sale).values);
  expect(client.append).toHaveBeenCalledTimes(1); expect(client.write).toHaveBeenCalledExactlyOnceWith("'Sales'!A2:Q2", [sheetRow(sale).values]);
  expect(rows.filter(row => row[0] === sale.reference)).toHaveLength(1);
});
it("uses service-account JWT with escaped newlines and Sheets-only scope", () => {
  createSheetsClient(); expect(JWT).toHaveBeenCalledWith({ email: "fake@example.invalid", key: "fake\nkey", scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
});
it("uses RAW text writes preserving decimals and preventing formula execution", async () => {
  await createSheetsClient().write("'Sales'!A2:Q2", [["=not-a-formula", "49.999999999999999999999999"]]);
  expect(http).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("valueInputOption=RAW"), expect.objectContaining({ method: "PUT",
    body: JSON.stringify({ majorDimension: "ROWS", values: [["=not-a-formula", "49.999999999999999999999999"]] }), signal: expect.any(AbortSignal), cache: "no-store" }));
});
it("uses append endpoint once without automatic retries", async () => {
  await createSheetsClient().append("'Expenses'!A:I", [["ref"]]);
  expect(http).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS"), expect.objectContaining({ method: "POST" }));
});
it("reads formatted string rows", async () => {
  http.mockResolvedValueOnce(new Response(JSON.stringify({ values: [["Reference"], ["000123"]] })));
  expect(await createSheetsClient().read("'Sales'!A:Q")).toEqual([["Reference"], ["000123"]]);
});
it.each([new Response("private key", { status: 403 }), new Response("invalid JSON"), new Response('{"values":[[12.5]]}')])(
  "sanitizes HTTP and malformed read responses", async response => {
    http.mockResolvedValueOnce(response); await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toThrow("Sheets synchronization could not be completed.");
  });
it("sanitizes authentication and network errors", async () => {
  token.mockRejectedValueOnce(new Error("fake key private URL"));
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toThrow("Sheets synchronization could not be completed.");
  expect(http).not.toHaveBeenCalled();
  http.mockRejectedValueOnce(new Error("fake-access-token"));
  await expect(createSheetsClient().write("'Sales'!A1", [["Reference"]])).rejects.toThrow("Sheets synchronization could not be completed.");
});
it.each(["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SHEETS_SPREADSHEET_ID"])("requires %s only on use", name => {
  vi.stubEnv(name, ""); expect(() => createSheetsClient()).toThrow(); expect(http).not.toHaveBeenCalled();
});
