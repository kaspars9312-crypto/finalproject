export type DomainErrorCode =
  | "REQUIRED" | "INVALID_DECIMAL" | "PERCENTAGE_RANGE" | "SPLIT_TOTAL"
  | "INVALID_CENTS" | "UNSAFE_CENTS" | "INVALID_STATE" | "COMMISSION_MISMATCH";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("REQUIRED", field, `${field} is required.`);
  }
  return value.trim();
}

export function normalizeReference(value: unknown): string {
  return requiredText(value, "reference");
}

export function assertCents(value: unknown, field: string, allowZero = false): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new DomainError("INVALID_CENTS", field, `${field} must be a ${allowZero ? "nonnegative" : "positive"} safe integer in cents.`);
  }
}

// BigInt prevents intermediate addition/subtraction from losing integer precision.
export function sumCents(values: readonly number[], field: string): number {
  let total = BigInt(0);
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new DomainError("INVALID_CENTS", field, `${field} requires safe integer cents.`);
    }
    total += BigInt(value);
  }
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > limit || total < -limit) {
    throw new DomainError("UNSAFE_CENTS", field, `${field} exceeds the safe integer cents range.`);
  }
  return Number(total);
}
