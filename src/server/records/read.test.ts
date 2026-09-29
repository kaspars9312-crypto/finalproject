import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../../app/page";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { listEmployees, readVisibleTransactions } from "./read";
import { employees, sale, expense } from "../sheets/fixtures.test-support";
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("../../app/actions", () => ({ retrySheetsAction: vi.fn() }));
const rpc = vi.fn(); const select = vi.fn(); const from = vi.fn(() => ({ select }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network allowed"); }));
  select.mockResolvedValue({ data: [...employees].reverse(), error: null });
  rpc.mockResolvedValue({ data: { actor: employees[1], transactions: [sale, expense] }, error: null });
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof createSupabaseAdminClient>);
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
it("renders the exact role label and all five employees from Supabase", async () => {
  const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Demonstration role");
  for (const person of employees) expect(html).toContain(person.display_name);
  expect((await listEmployees()).map(e => e.code)).toEqual(employees.map(e => e.code));
  expect(html).toContain(sale.reference); expect(html).not.toContain(expense.reference);
  expect(html).not.toContain("Retry Sheets sync");
});
it.each([1, 2, 3, 4])("employee %i only sees their own submissions even if the DB boundary returns extras", async index => {
  const actor = employees[index];
  rpc.mockResolvedValue({ data: { actor, transactions: [sale, expense] }, error: null });
  const result = await readVisibleTransactions(actor.id);
  expect(result.transactions.every(t => t.submitter_employee_id === actor.id)).toBe(true);
  expect(result.transactions.length).toBe(index === 1 || index === 4 ? 1 : 0);
});
it("Svetlana sees all rows and retry controls", async () => {
  rpc.mockResolvedValue({ data: { actor: employees[0], transactions: [sale, expense] }, error: null });
  const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ employee: employees[0].id }) }));
  expect(html).toContain(sale.reference); expect(html).toContain(expense.reference); expect(html).toContain("Retry Sheets sync");
});
it("ignores spoofed client role parameters", async () => {
  const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ employee: employees[1].id, role: "MANAGER" }) }));
  expect(html).not.toContain(expense.reference); expect(html).not.toContain("Retry Sheets sync");
  expect(rpc).toHaveBeenCalledWith("read_visible_transactions", { p_actor_employee_id: employees[1].id });
});
it.each([{ active: false }, { id: employees[0].id }, { role: "ADMIN" }])("fails closed for inactive/mismatched/invalid actor %j", async override => {
  rpc.mockResolvedValue({ data: { actor: { ...employees[1], ...override }, transactions: [sale, expense] }, error: null });
  await expect(readVisibleTransactions(employees[1].id)).rejects.toThrow("Records are unavailable");
});
it("denies unknown and malformed employee IDs", async () => {
  await expect(readVisibleTransactions("invalid")).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: null, error: { code: "BF001" } });
  await expect(readVisibleTransactions(employees[1].id)).rejects.toThrow();
});
it("renders an empty state and exact approved amounts", async () => {
  rpc.mockResolvedValue({ data: { actor: employees[1], transactions: [] }, error: null });
  expect(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))).toContain("No submissions");
});
it("database configuration failure yields a safe page without private errors", async () => {
  select.mockRejectedValue(new Error("secret token private URL"));
  const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Records are unavailable"); expect(html).not.toContain("secret token");
});
