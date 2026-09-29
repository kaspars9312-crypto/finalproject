import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps all Google environment examples empty and server-only", () => {
  const env = readFileSync(".env.example", "utf8");
  for (const name of ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SHEETS_SPREADSHEET_ID"]) {
    expect(env).toMatch(new RegExp(`^${name}=\\r?$`, "m"));
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toContain(name);
  }
  expect(env).not.toContain("NEXT_PUBLIC_");
  for (const file of ["client", "sync", "rows"]) expect(readFileSync(`src/server/sheets/${file}.ts`, "utf8")).toContain('import "server-only"');
  expect(readFileSync("src/server/records/read.ts", "utf8")).toContain('import "server-only"');
});
