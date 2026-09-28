import { expect, it } from "vitest";
import { assertCents, DomainError, normalizeReference, requiredText, sumCents } from "./validation";

it.each(["S01", "E07", "s01", "Instructor Ref / 2026: A-b", "任意 Reference"])("preserves arbitrary reference %s", (reference) => {
  expect(normalizeReference(` \t${reference}\r\n`)).toBe(reference);
});
it.each(["", " \n\t ", undefined, null, 42])("rejects empty or nontext reference %j", (reference) => {
  expect(() => normalizeReference(reference)).toThrowError(expect.objectContaining({ code: "REQUIRED", field: "reference" }));
});
it("keeps case-sensitive reference identity", () => {
  expect(normalizeReference("s01")).not.toBe(normalizeReference("S01"));
});
it("trims required customer and description text", () => {
  expect(requiredText(" Olivia Rose ", "customer")).toBe("Olivia Rose");
  expect(requiredText("  Wedding guests  ", "description")).toBe("Wedding guests");
  expect(() => requiredText(" \n", "customer")).toThrowError(DomainError);
});
it.each([undefined, null, "100", 0, -1, 0.01, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid cents %j", (value) => {
  expect(() => assertCents(value, "amount_cents")).toThrowError(DomainError);
});
it("supports safe cents and explicitly allowed zero", () => {
  expect(() => assertCents(Number.MAX_SAFE_INTEGER, "amount_cents")).not.toThrow();
  expect(() => assertCents(0, "pool_cents", true)).not.toThrow();
});
it("uses exact intermediate integer arithmetic and rejects unsafe final totals", () => {
  expect(sumCents([Number.MAX_SAFE_INTEGER, 1, -1], "total")).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1], "total")).toThrowError(expect.objectContaining({ code: "UNSAFE_CENTS" }));
  expect(() => sumCents([-Number.MAX_SAFE_INTEGER, -1], "total")).toThrowError(DomainError);
  expect(() => sumCents([1.1], "total")).toThrowError(DomainError);
});
