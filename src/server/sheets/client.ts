import "server-only";
import { JWT } from "google-auth-library";

export class SheetsError extends Error {
  constructor(readonly code: "CONFIGURATION" | "DELIVERY" | "DUPLICATE_REFERENCE" | "HEADERS") {
    super("Sheets synchronization could not be completed.");
  }
}
export interface SheetsClient {
  read(range: string): Promise<string[][]>;
  write(range: string, values: string[][]): Promise<void>;
  append(range: string, values: string[][]): Promise<void>;
}

export function createSheetsClient(): SheetsClient {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheet = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!email || !key || !spreadsheet) throw new SheetsError("CONFIGURATION");
  const auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  // Bound token exchange too. No transparent retries of ambiguous append writes.
  auth.transporter.defaults = { ...auth.transporter.defaults, timeout: 5000, retry: false };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet)}/values/`;
  async function request(range: string, method: string, values?: string[][], append = false): Promise<unknown> {
    try {
      const { token } = await auth.getAccessToken();
      if (!token) throw new SheetsError("DELIVERY");
      const url = base + encodeURIComponent(range) + (append ? ":append" : "") +
        (method === "GET" ? "?valueRenderOption=FORMATTED_VALUE" : "?valueInputOption=RAW" + (append ? "&insertDataOption=INSERT_ROWS" : ""));
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: values ? JSON.stringify({ majorDimension: "ROWS", values }) : undefined,
        signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!response.ok) throw new SheetsError("DELIVERY");
      return await response.json();
    } catch { throw new SheetsError("DELIVERY"); }
  }
  return {
    async read(range) {
      const result = await request(range, "GET") as { values?: unknown };
      if (!result || (result.values !== undefined && (!Array.isArray(result.values) ||
        !result.values.every(row => Array.isArray(row) && row.every(cell => typeof cell === "string"))))) {
        throw new SheetsError("DELIVERY");
      }
      return (result.values ?? []) as string[][];
    },
    async write(range, values) { await request(range, "PUT", values); },
    async append(range, values) { await request(range, "POST", values, true); },
  };
}

/** References are exact, case-sensitive strings. Row numbers are never persisted. */
export async function upsertReference(client: SheetsClient, tab: "Sales" | "Expenses", headers: string[], values: string[]): Promise<void> {
  const end = tab === "Sales" ? "Q" : "I";
  const rows = await client.read(`'${tab}'!A:${end}`);
  const header = rows[0] ?? [];
  if (header.some(cell => cell !== "") && (header.length !== headers.length || headers.some((cell, i) => cell !== header[i]))) {
    throw new SheetsError("HEADERS");
  }
  const matches = rows.slice(1).flatMap((row, index) => row[0] === values[0] ? [index + 2] : []);
  if (matches.length > 1) throw new SheetsError("DUPLICATE_REFERENCE");
  if (header.length === 0 || header.every(cell => cell === "")) await client.write(`'${tab}'!A1:${end}1`, [headers]);
  if (matches.length === 1) await client.write(`'${tab}'!A${matches[0]}:${end}${matches[0]}`, [values]);
  else await client.append(`'${tab}'!A:${end}`, [values]);
}
