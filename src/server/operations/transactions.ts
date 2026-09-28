import "server-only";

import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { calculateCommission, validateCommissionSplit } from "../../domain/commission";
import { ALLOCATIONS, EXPENSE_CATEGORIES, PROJECTS, type Allocation, type CommissionSplit,
  type ExpenseCategory, type ExpenseStatus, type Project, type SaleStatus } from "../../domain/types";
import { assertCents, DomainError, normalizeReference, requiredText } from "../../domain/validation";

export type OperationErrorCode = "VALIDATION" | "FORBIDDEN" | "DUPLICATE_REFERENCE" |
  "NOT_FOUND" | "STALE_CONFLICT" | "INVALID_STATE" | "DATABASE_ERROR";
export type OperationResult =
  | { ok: true; transaction: TransactionReceipt }
  | { ok: false; error: { code: OperationErrorCode; message: string; field?: string } };
export interface TransactionReceipt {
  id: string;
  reference: string;
  status: SaleStatus | ExpenseStatus;
  revision: number;
}
interface Actor { actorEmployeeId: string }
interface Decision extends Actor { transactionId: string; expectedRevision: number }
interface SaleValues { customer: string; project: Project; description: string; amountCents: number }
export interface CreateWebsiteSaleInput extends Actor, SaleValues {
  reference: string;
  proposedSplit: CommissionSplit;
}
export interface CreateWebsiteExpenseInput extends Actor {
  reference: string;
  description: string;
  amountCents: number;
  category: ExpenseCategory;
  proposedAllocation: Allocation;
}
export interface CorrectPendingSaleInput extends Decision, SaleValues {}
export interface ApproveSaleInput extends Decision { finalSplit?: CommissionSplit }
export interface AllocateExpenseInput extends Decision { finalAllocation: Allocation }

const messages: Record<OperationErrorCode, string> = {
  VALIDATION: "Check the supplied transaction values.",
  FORBIDDEN: "This employee cannot perform this operation.",
  DUPLICATE_REFERENCE: "That reference is already recorded.",
  NOT_FOUND: "The transaction was not found.",
  STALE_CONFLICT: "The transaction changed or was finalized. Reload before deciding.",
  INVALID_STATE: "This operation does not apply to this transaction type.",
  DATABASE_ERROR: "The database operation could not be confirmed. Reload before retrying.",
};
class OperationFailure extends Error {
  constructor(readonly code: OperationErrorCode) { super(messages[code]); }
}
const sqlErrors: Record<string, OperationErrorCode> = {
  BD001: "FORBIDDEN", BD002: "NOT_FOUND", BD003: "STALE_CONFLICT",
  BD004: "INVALID_STATE", BD005: "DUPLICATE_REFERENCE",
  "22023": "VALIDATION", "22P02": "VALIDATION", "22003": "VALIDATION",
  "23502": "VALIDATION", "23514": "VALIDATION",
  "40001": "STALE_CONFLICT", "40P01": "STALE_CONFLICT",
};

function uuid(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new DomainError("INVALID_STATE", field, `${field} must be a UUID.`);
  }
  return text;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new DomainError("INVALID_STATE", field, `${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
function decisionArgs(input: Decision) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2147483647) {
    throw new DomainError("INVALID_STATE", "expectedRevision", "Expected revision must be a positive PostgreSQL integer.");
  }
  return { p_actor_employee_id: uuid(input.actorEmployeeId, "actorEmployeeId"),
    p_transaction_id: uuid(input.transactionId, "transactionId"), p_expected_revision: input.expectedRevision };
}
function saleArgs(input: SaleValues) {
  assertCents(input.amountCents, "amountCents");
  return { p_customer: requiredText(input.customer, "customer"),
    p_project: choice(input.project, PROJECTS, "project"),
    p_description: requiredText(input.description, "description"), p_amount_cents: String(input.amountCents) };
}
function splitArgs(split: CommissionSplit) {
  return { p_richard_pct: split.RICHARD, p_anastasia_pct: split.ANASTASIA, p_jean_claude_pct: split.JEAN_CLAUDE };
}

type Client = ReturnType<typeof createSupabaseAdminClient>;
async function rpc(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new OperationFailure(sqlErrors[error.code] ?? "DATABASE_ERROR");
  return data;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationFailure("DATABASE_ERROR");
  return value as Record<string, unknown>;
}
function receipt(value: unknown): TransactionReceipt {
  const row = record(value);
  if (typeof row.id !== "string" || typeof row.reference !== "string" ||
      typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1 ||
      !["PENDING_APPROVAL", "APPROVED", "AWAITING_ALLOCATION", "ALLOCATED"].includes(String(row.status))) {
    throw new OperationFailure("DATABASE_ERROR");
  }
  return { id: row.id, reference: row.reference, revision: row.revision, status: row.status as TransactionReceipt["status"] };
}
function storedCents(value: unknown): number {
  // The RPC casts BIGINT to text before JSON serialization. Check BEFORE Number().
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new OperationFailure("DATABASE_ERROR");
  const cents = BigInt(value);
  if (cents < BigInt(1) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new OperationFailure("DATABASE_ERROR");
  return Number(cents);
}
async function operation(run: () => Promise<unknown>): Promise<OperationResult> {
  try {
    return { ok: true, transaction: receipt(await run()) };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: { code: "VALIDATION", message: error.message, field: error.field } };
    }
    const code = error instanceof OperationFailure ? error.code : "DATABASE_ERROR";
    return { ok: false, error: { code, message: messages[code] } };
  }
}

export function createWebsiteSale(input: CreateWebsiteSaleInput): Promise<OperationResult> {
  return operation(async () => {
    const args = { p_actor_employee_id: uuid(input.actorEmployeeId, "actorEmployeeId"),
      p_reference: normalizeReference(input.reference), ...saleArgs(input),
      ...splitArgs(validateCommissionSplit(input.proposedSplit)) };
    return rpc(createSupabaseAdminClient(), "create_website_sale", args);
  });
}
export function createWebsiteExpense(input: CreateWebsiteExpenseInput): Promise<OperationResult> {
  return operation(async () => {
    assertCents(input.amountCents, "amountCents");
    const args = { p_actor_employee_id: uuid(input.actorEmployeeId, "actorEmployeeId"),
      p_reference: normalizeReference(input.reference), p_description: requiredText(input.description, "description"),
      p_amount_cents: String(input.amountCents), p_category: choice(input.category, EXPENSE_CATEGORIES, "category"),
      p_proposed_allocation: choice(input.proposedAllocation, ALLOCATIONS, "proposedAllocation") };
    return rpc(createSupabaseAdminClient(), "create_website_expense", args);
  });
}
export function correctPendingSale(input: CorrectPendingSaleInput): Promise<OperationResult> {
  return operation(async () => {
    const args = { ...decisionArgs(input), ...saleArgs(input) };
    return rpc(createSupabaseAdminClient(), "correct_pending_sale", args);
  });
}
export function approveSale(input: ApproveSaleInput): Promise<OperationResult> {
  return operation(async () => {
    const args = decisionArgs(input);
    const override = input.finalSplit === undefined ? undefined : validateCommissionSplit(input.finalSplit);
    const client = createSupabaseAdminClient();
    const row = record(await rpc(client, "read_sale_for_approval", {
      p_actor_employee_id: args.p_actor_employee_id, p_transaction_id: args.p_transaction_id,
    }));
    if (row.status !== "PENDING_APPROVAL" || row.revision !== input.expectedRevision) {
      throw new OperationFailure("STALE_CONFLICT");
    }
    // Invalid stored data is a database failure, not a user-input correction.
    let proposed: CommissionSplit;
    try {
      proposed = validateCommissionSplit({ RICHARD: row.proposed_richard_pct,
        ANASTASIA: row.proposed_anastasia_pct, JEAN_CLAUDE: row.proposed_jean_claude_pct });
    } catch { throw new OperationFailure("DATABASE_ERROR"); }
    const split = override ?? proposed;
    const commission = calculateCommission(storedCents(row.amount_cents), split);
    // The mutation rechecks the stored actor and CAS. This read is never authority
    // to overwrite a correction/approval that commits before the mutation.
    return rpc(client, "approve_sale", { ...args, ...splitArgs(split),
      p_pool_cents: String(commission.pool_cents), p_richard_cents: String(commission.earned_cents.RICHARD),
      p_anastasia_cents: String(commission.earned_cents.ANASTASIA),
      p_jean_claude_cents: String(commission.earned_cents.JEAN_CLAUDE) });
  });
}
export function allocateExpense(input: AllocateExpenseInput): Promise<OperationResult> {
  return operation(async () => {
    const args = { ...decisionArgs(input), p_final_allocation: choice(input.finalAllocation, ALLOCATIONS, "finalAllocation") };
    return rpc(createSupabaseAdminClient(), "allocate_expense", args);
  });
}
