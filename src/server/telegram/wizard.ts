import "server-only";
import Decimal from "decimal.js";
import { validateCommissionSplit } from "../../domain/commission";
import { assertCents, DomainError, normalizeReference, requiredText } from "../../domain/validation";
import type { Session } from "./types";

export const prompts: Record<string, string> = {
  reference: "Enter the transaction reference.", customer: "Enter the customer name.",
  project: "Enter the project: A or B.", description: "Enter the description.",
  amount_cents: "Enter the amount in euros, with at most 2 decimal places (for example 120.50).",
  proposed_richard_pct: "Enter Richard's commission percentage (0–100).",
  proposed_anastasia_pct: "Enter Anastasia's commission percentage (0–100).",
  proposed_jean_claude_pct: "Enter Jean-Claude's commission percentage. All three shares must total exactly 100.",
  expense_category: "Enter the category: Materials, Travel or Other.",
  proposed_allocation: "Enter the proposed allocation: A, B or Company overhead.",
};

export function euroCents(text: string): string {
  const value = requiredText(text, "amount");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error("Enter a decimal amount in euros, such as 120.50.");
  if ((value.split(".")[1]?.length ?? 0) > 2) throw new Error("Amount must have at most 2 decimal places.");
  const Exact = Decimal.clone({ precision: value.length + 32 });
  const cents = new Exact(value).times(100);
  if (cents.lte(0)) throw new Error("Amount must be positive.");
  if (cents.gt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds the supported safe cents range.");
  assertCents(cents.toNumber(), "amount");
  return cents.toFixed(0);
}

export function validateAnswer(session: Session, text: string): { value: string; error?: never } | { value: null; error: string } {
  try {
    let value = requiredText(text, session.step);
    if (session.step === "reference") value = normalizeReference(value);
    else if (session.step === "amount_cents") value = euroCents(value);
    else if (session.step === "project") {
      value = value.toUpperCase();
      if (!["A", "B"].includes(value)) throw new Error("Project must be A or B.");
    } else if (session.step === "expense_category") {
      value = value.toUpperCase();
      if (!["MATERIALS", "TRAVEL", "OTHER"].includes(value)) throw new Error("Category must be Materials, Travel or Other.");
    } else if (session.step === "proposed_allocation") {
      value = value.toUpperCase().replace(/\s+/g, "_");
      if (!["A", "B", "COMPANY_OVERHEAD"].includes(value)) throw new Error("Allocation must be A, B or Company overhead.");
    } else if (session.step.endsWith("_pct")) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error("Percentage must be a plain decimal number, without a % sign.");
      const share = new Decimal(value);
      if (share.lt(0) || share.gt(100)) throw new Error("Percentage must be between 0 and 100.");
      if (session.step === "proposed_jean_claude_pct") {
        validateCommissionSplit({ RICHARD: session.draft_payload.proposed_richard_pct,
          ANASTASIA: session.draft_payload.proposed_anastasia_pct, JEAN_CLAUDE: value });
      }
    } else if (!["customer", "description", "reference"].includes(session.step)) {
      throw new Error("This entry cannot continue. Start again with /sale or /expense.");
    }
    return { value };
  } catch (error) {
    return { value: null, error: error instanceof DomainError || error instanceof Error
      ? error.message : "Check your answer." };
  }
}
