import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JWT } from "google-auth-library";
import { createSheetsClient, SheetsError, upsertReference, type SheetsClient } from "./client";
import { SALES_HEADERS, sheetRow } from "./rows";
import { sale } from "./fixtures.test-support";
vi.mock("server-only", () => ({}));
vi.mock("google-auth-library", () => ({ JWT: vi.fn() }));
const token = vi.fn(); const http = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); token.mockReset().mockResolvedValue({ token: "fake-access-token" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(JWT).mockImplementation(function () { return { getAccessToken: token, transporter: { defaults: {} } } as unknown as JWT; });
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "fake@example.invalid");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "fake\\nkey");
  vi.stubEnv("GOOGLE_SHEETS_SPREADSHEET_ID", "fake-sheet");
  http.mockReset().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
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

it("logs only safe auth fields while retaining the public DELIVERY error", async () => {
  const error = Object.assign(new Error("invalid_grant: Invalid JWT Signature. fake\\nkey fake-access-token"), {
    name: "GaxiosError", code: "400", response: { status: 400, data: { error: "invalid_grant",
      error_description: "Invalid JWT Signature. fake@example.invalid" }, config: { headers: { Authorization: "Bearer fake-access-token" } } },
  });
  token.mockRejectedValueOnce(error);
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledExactlyOnceWith({ stage: "google-auth", name: "GaxiosError",
    message: "Invalid JWT signature.", code: 400, status: 400 });
  expect(http).not.toHaveBeenCalled();
});
it("reports private-key parsing errors without emitting private-key material", async () => {
  token.mockRejectedValueOnce(Object.assign(new Error("error:1E08010C:DECODER routines::unsupported fake\\nkey"), { code: "ERR_OSSL_UNSUPPORTED" }));
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledWith({ stage: "google-auth", name: "Error", code: "ERR_OSSL_UNSUPPORTED",
    message: "Private key could not be parsed or used for signing.", status: undefined });
});
it("diagnoses auth construction and missing tokens safely", async () => {
  vi.mocked(JWT).mockImplementationOnce(() => { throw new TypeError("secretOrPrivateKey must be an asymmetric key fake\\nkey"); });
  expect(() => createSheetsClient()).toThrow(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ stage: "google-auth", name: "TypeError" }));
  token.mockResolvedValueOnce({ token: null });
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Google did not return an access token." }));
});
it.each(["read", "write", "append"] as const)("logs HTTP status, method and range for API %s failures", async operation => {
  http.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED",
    message: "The caller does not have permission: fake@example.invalid fake-sheet fake-access-token",
    errors: [{ reason: "forbidden" }] } }), { status: 403 }));
  const client = createSheetsClient();
  await expect(operation === "read" ? client.read("'Sales'!A:Q") : client[operation]("'Sales'!A:Q", [["private row data"]]))
    .rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledExactlyOnceWith({ stage: "google-sheets-api", status: 403,
    method: { read: "GET", write: "PUT", append: "POST" }[operation], range: "'Sales'!A:Q",
    googleStatus: "PERMISSION_DENIED", reason: "forbidden", message: "Google denied access to the spreadsheet." });
});
it("recognizes service-disabled ErrorInfo without logging project metadata or activation URLs", async () => {
  http.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED",
    message: "Google Sheets API has not been used in project secret-project before or it is disabled.",
    details: [{ reason: "SERVICE_DISABLED", metadata: { consumer: "secret-project", activationUrl: "https://secret.invalid" } }] } }), { status: 403 }));
  await expect(createSheetsClient().read("'Expenses'!A:I")).rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledExactlyOnceWith({ stage: "google-sheets-api", status: 403, method: "GET", range: "'Expenses'!A:I",
    googleStatus: "PERMISSION_DENIED", reason: "SERVICE_DISABLED", message: "Google Sheets API is disabled or has not been enabled." });
});
it("never emits env values, tokens, headers, service-account JSON or unknown error fields", async () => {
  const secrets = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "diagnostic-account@example.invalid", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nSUPER-SECRET-KEY\n-----END PRIVATE KEY-----",
    GOOGLE_SHEETS_SPREADSHEET_ID: "secret-spreadsheet-id", SUPABASE_SERVICE_ROLE_KEY: "secret-supabase-key", TELEGRAM_BOT_TOKEN: "secret-telegram-token",
    CUSTOM_ENV: "secret-custom-environment-value",
  };
  for (const [name, value] of Object.entries(secrets)) vi.stubEnv(name, value);
  const sensitive = JSON.stringify({ ...secrets, access_token: "fake-access-token", Authorization: "Bearer fake-access-token",
    service_account: { private_key: secrets.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, client_email: secrets.GOOGLE_SERVICE_ACCOUNT_EMAIL } });
  token.mockRejectedValueOnce({ name: sensitive, message: sensitive, code: sensitive, status: sensitive, stack: sensitive,
    response: { status: sensitive, data: { error: sensitive, error_description: sensitive }, config: sensitive } });
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
  http.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: sensitive, message: sensitive,
    errors: [{ reason: sensitive }], details: [{ reason: sensitive, metadata: sensitive }] } }), { status: 400 }));
  await expect(createSheetsClient().write(sensitive, [[sensitive]])).rejects.toEqual(new SheetsError("DELIVERY"));
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
  for (const value of [...Object.values(secrets), "SUPER-SECRET-KEY", "fake-access-token", "Authorization", "private_key", "access_token", "service_account"])
    expect(logs).not.toContain(value);
  expect(console.error).toHaveBeenCalledTimes(2);
  expect(console.error).toHaveBeenLastCalledWith(expect.objectContaining({ range: "[nonstandard range withheld]", googleStatus: undefined, reason: undefined }));
});
it("does not log non-JSON response bodies and logging failure cannot change DELIVERY behavior", async () => {
  http.mockResolvedValueOnce(new Response("<html>fake-access-token fake\\nkey</html>", { status: 502 }));
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
  expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ status: 502, message: "Unrecognized Google error; message withheld for credential safety." }));
  vi.mocked(console.error).mockImplementationOnce(() => { throw new Error("Logger unavailable"); });
  token.mockRejectedValueOnce(new Error("invalid_grant"));
  await expect(createSheetsClient().read("'Sales'!A:Q")).rejects.toEqual(new SheetsError("DELIVERY"));
});
it("successful requests produce no diagnostics", async () => {
  await createSheetsClient().write("'Sales'!A2:Q2", [["ref"]]); expect(console.error).not.toHaveBeenCalled();
});
