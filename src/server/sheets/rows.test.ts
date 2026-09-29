import { expect, it, vi } from "vitest";
import { sheetRow, euro } from "./rows";
import { parseTransaction } from "../records/types";
import { sale, expense, approved } from "./fixtures.test-support";
vi.mock("server-only", () => ({}));
it("maps SALE to the exact 17 columns with separate proposed/final splits", () => {
  expect(sheetRow(approved)).toEqual({ tab: "Sales", headers: ["Reference", "Submission time", "Salesperson", "Customer", "Project", "Description", "Amount",
    "Proposed Richard %", "Proposed Anastasia %", "Proposed Jean-Claude %", "Approved Richard %", "Approved Anastasia %", "Approved Jean-Claude %",
    "Richard earned commission", "Anastasia earned commission", "Jean-Claude earned commission", "Status"],
  values: ["Practice / sale", sale.submitted_at, "Richard Darling", "Customer", "A", "Wedding guests", "€123.45", "12.5", "37.5", "50",
    "20", "40", "40", "€2.47", "€4.94", "€4.94", "Approved"] });
});
it("maps EXPENSE to the exact 9 columns", () => {
  expect(sheetRow({ ...expense, status: "ALLOCATED", final_allocation: "COMPANY_OVERHEAD" })).toEqual({ tab: "Expenses",
    headers: ["Reference", "Submission time", "Reporter", "Description", "Category", "Amount", "Proposed allocation", "Final allocation", "Status"],
    values: [expense.reference, expense.submitted_at, "Kevin von Whatever", "Wedding guests", "Travel", "€123.45", "B", "Company overhead", "Allocated"] });
});
it("pending sale has blank final shares and explicitly zero earned commissions", () => {
  expect(sheetRow(sale).values.slice(10, 16)).toEqual(["", "", "", "€0.00", "€0.00", "€0.00"]);
});
it("awaiting expense has a proposal and blank final allocation", () => expect(sheetRow(expense).values.slice(6, 8)).toEqual(["B", ""]));
it.each([["0", "€0.00"], ["1", "€0.01"], ["105", "€1.05"], ["9007199254740991", "€90071992547409.91"],
  ["9223372036854775807", "€92233720368547758.07"]])("formats exact cents %s", (cents, result) => expect(euro(cents)).toBe(result));
it("preserves arbitrary NUMERIC precision as text", () => {
  const pct = "49.999999999999999999999999999999";
  expect(sheetRow(parseTransaction({ ...sale, proposed_richard_pct: pct })).values[7]).toBe(pct);
});
it.each([{ amount_cents: 12345 }, { proposed_richard_pct: 12.5 }, { final_richard_pct: "50" }, { transaction_type: "OTHER" }])(
  "rejects broken exact projection %j", override => expect(() => parseTransaction({ ...sale, ...override })).toThrow());
