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

// Google errors can contain request headers, credentials and credential-bearing
// URLs. Emit only known diagnostic vocabulary, never arbitrary remote text.
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function known(value: unknown, allowed: string[]): string | undefined {
  return typeof value === "string" && allowed.includes(value) ? value : undefined;
}
function httpStatus(value: unknown): number | undefined {
  const status = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}
function safeMessage(value: unknown): string {
  const message = typeof value === "string" ? value : "";
  const causes: [RegExp, string][] = [
    [/invalid jwt signature/i, "Invalid JWT signature."],
    [/reasonable timeframe|short-lived token|token used too early/i, "JWT lifetime or server clock is invalid."],
    [/account not found|account has been deleted|account is disabled/i, "Service account is missing or disabled."],
    [/invalid_scope|invalid.*scope/i, "Invalid OAuth scope."],
    [/invalid_grant/i, "Google rejected the JWT grant."],
    [/invalid_client|unauthorized_client/i, "Google rejected the service-account client."],
    [/DECODER routines|PEM routines|no start line|secretOrPrivateKey|private key|key must be/i, "Private key could not be parsed or used for signing."],
    [/has not been used|api.*disabled|service_disabled/i, "Google Sheets API is disabled or has not been enabled."],
    [/insufficient authentication scopes/i, "Access token lacks the required Sheets scope."],
    [/caller does not have permission|permission denied|forbidden/i, "Google denied access to the spreadsheet."],
    [/not found|requested entity was not found/i, "Requested spreadsheet or resource was not found."],
    [/unable to parse range|invalid range/i, "Google could not parse the requested tab/range."],
    [/quota|rate limit|too many requests/i, "Google quota or rate limit exceeded."],
    [/invalid authentication credentials|unauthenticated/i, "Google rejected the authentication credentials."],
    [/did not return an access token/i, "Google did not return an access token."],
    [/timeout|timed out|ETIMEDOUT/i, "Google authentication request timed out."],
    [/ENOTFOUND|EAI_AGAIN/i, "Google authentication hostname could not be resolved."],
  ];
  return causes.find(([pattern]) => pattern.test(message))?.[1] ?? "Unrecognized Google error; message withheld for credential safety.";
}
function diagnostic(fields: Record<string, string | number | undefined>): void {
  try { console.error(fields); } catch { /* Logging must not affect delivery state. */ }
}
function authDiagnostic(error: unknown): void {
  const e = record(error); const response = record(e.response); const data = record(response.data);
  diagnostic({ stage: "google-auth", name: known(e.name, ["Error", "TypeError", "RangeError", "GaxiosError", "FetchError", "AbortError"]) ?? "Error",
    message: safeMessage(typeof data.error_description === "string" ? data.error_description : e.message),
    code: httpStatus(e.code) ?? known(e.code, ["ERR_OSSL_UNSUPPORTED", "ERR_OSSL_PEM_NO_START_LINE", "ERR_OSSL_ASN1_TOO_LONG",
      "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"])
      ?? known(data.error, ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_scope", "invalid_request"]),
    status: httpStatus(response.status) ?? httpStatus(e.status),
  });
}

export function createSheetsClient(): SheetsClient {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheet = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!email || !key || !spreadsheet) throw new SheetsError("CONFIGURATION");
  let auth: JWT;
  try {
    auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    // Bound token exchange too. No transparent retries of ambiguous append writes.
    auth.transporter.defaults = { ...auth.transporter.defaults, timeout: 5000, retry: false };
  } catch (error) { authDiagnostic(error); throw new SheetsError("DELIVERY"); }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet)}/values/`;
  async function request(range: string, method: string, values?: string[][], append = false): Promise<unknown> {
    try {
      let token: string;
      try {
        const result = await auth.getAccessToken();
        if (!result.token) throw new Error("Google did not return an access token.");
        token = result.token;
      } catch (error) { authDiagnostic(error); throw new SheetsError("DELIVERY"); }
      const url = base + encodeURIComponent(range) + (append ? ":append" : "") +
        (method === "GET" ? "?valueRenderOption=FORMATTED_VALUE" : "?valueInputOption=RAW" + (append ? "&insertDataOption=INSERT_ROWS" : ""));
      const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: values ? JSON.stringify({ majorDimension: "ROWS", values }) : undefined,
        signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch { /* Do not log non-JSON bodies. */ }
        const error = record(record(body).error);
        const firstError = record(Array.isArray(error.errors) ? error.errors[0] : undefined);
        const detail = Array.isArray(error.details) ? error.details.map(record).find(item => item.reason) : undefined;
        diagnostic({ stage: "google-sheets-api", status: response.status, method,
          range: /^'(Sales|Expenses)'!A\d*:(Q|I)\d*$/.test(range) ? range : "[nonstandard range withheld]",
          googleStatus: known(error.status, ["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
            "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "OUT_OF_RANGE", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"]),
          reason: known(firstError.reason ?? detail?.reason, ["accessNotConfigured", "forbidden", "notFound", "badRequest", "authError",
            "insufficientPermissions", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError",
            "SERVICE_DISABLED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "IAM_PERMISSION_DENIED", "CONSUMER_INVALID", "RATE_LIMIT_EXCEEDED"]),
          message: safeMessage(error.message),
        });
        throw new SheetsError("DELIVERY");
      }
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
