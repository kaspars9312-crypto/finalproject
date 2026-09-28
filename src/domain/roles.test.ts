import { describe, expect, it } from "vitest";
import { canAllocateExpense, canApproveSale, canCorrectPendingSale, canManageTelegramLinks, canSubmitExpense, canSubmitSale, canViewFinancialResults, canViewTransaction } from "./roles";
import type { EmployeeRole } from "./types";

describe("stored role permission decisions", () => {
  it.each([
    ["SVETLANA", "MANAGER", false, false, true],
    ["RICHARD", "SALESPERSON", true, false, false],
    ["ANASTASIA", "SALESPERSON", true, false, false],
    ["JEAN_CLAUDE", "SALESPERSON", true, false, false],
    ["KEVIN", "EXPENSE_REPORTER", false, true, false],
  ] as const)("enforces permissions for %s", (_code, role, sale, expense, manager) => {
    expect(canSubmitSale(role)).toBe(sale);
    expect(canSubmitExpense(role)).toBe(expense);
    expect(canApproveSale(role, "PENDING_APPROVAL")).toBe(manager);
    expect(canCorrectPendingSale(role, "PENDING_APPROVAL")).toBe(manager);
    expect(canAllocateExpense(role, "AWAITING_ALLOCATION")).toBe(manager);
    expect(canManageTelegramLinks(role)).toBe(manager);
    expect(canViewFinancialResults(role)).toBe(manager);
    expect(canApproveSale(role, "APPROVED")).toBe(false);
    expect(canCorrectPendingSale(role, "APPROVED")).toBe(false);
    expect(canAllocateExpense(role, "ALLOCATED")).toBe(false);
  });
  it.each(["SALESPERSON", "EXPENSE_REPORTER"] as const)("limits %s to own transaction status", (role) => {
    expect(canViewTransaction(role, "employee-1", "employee-1")).toBe(true);
    expect(canViewTransaction(role, "employee-1", "employee-2")).toBe(false);
    expect(canViewTransaction(role, "", "")).toBe(false);
  });
  it("allows manager transaction visibility", () => {
    expect(canViewTransaction("MANAGER", "manager", "employee-1")).toBe(true);
  });
  it("denies unrecognized runtime roles", () => {
    const unknownRole = "ADMIN" as EmployeeRole;
    expect(canSubmitSale(unknownRole)).toBe(false);
    expect(canSubmitExpense(unknownRole)).toBe(false);
    expect(canApproveSale(unknownRole, "PENDING_APPROVAL")).toBe(false);
    expect(canAllocateExpense(unknownRole, "AWAITING_ALLOCATION")).toBe(false);
    expect(canManageTelegramLinks(unknownRole)).toBe(false);
    expect(canViewTransaction(unknownRole, "employee-1", "employee-1")).toBe(false);
  });
});
