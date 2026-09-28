import Decimal from "decimal.js";
import { SALESPERSON_CODES, type Commission, type CommissionSplit, type SalespersonCode } from "./types";
import { assertCents, DomainError, sumCents } from "./validation";

// Plain decimal input only. No exponents, nonfinite values or binary-number inputs.
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseSplit(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainError("REQUIRED", "split", "All three commission percentages are required.");
  }
  const record = input as Record<string, unknown>;
  const split = {} as Record<SalespersonCode, string>;
  for (const person of SALESPERSON_CODES) {
    const value = record[person];
    if (value == null || (typeof value === "string" && !value.trim())) {
      throw new DomainError("REQUIRED", person, `${person} percentage is required.`);
    }
    if (typeof value !== "string" || !DECIMAL_TEXT.test(value.trim())) {
      throw new DomainError("INVALID_DECIMAL", person, `${person} percentage must be a decimal string.`);
    }
    split[person] = value.trim();
  }
  // Input length covers all fractional places; 32 extra digits cover safe-cent
  // multiplication (16 digits), carries and division by 100 without truncation.
  // A local clone avoids changing or depending on global Decimal configuration.
  const Exact = Decimal.clone({
    precision: Math.max(...SALESPERSON_CODES.map((person) => split[person].length)) + 32,
    rounding: Decimal.ROUND_HALF_UP,
  });
  let total = new Exact(0);
  for (const person of SALESPERSON_CODES) {
    const value = new Exact(split[person]);
    if (value.lt(0) || value.gt(100)) {
      throw new DomainError("PERCENTAGE_RANGE", person, `${person} percentage must be between 0 and 100.`);
    }
    total = total.plus(value);
  }
  if (!total.eq(100)) {
    throw new DomainError("SPLIT_TOTAL", "split", "Commission percentages must total exactly 100.");
  }
  return { split, Exact };
}

export function validateCommissionSplit(input: unknown): CommissionSplit {
  return parseSplit(input).split;
}

export function calculateCommissionPool(amountCents: number): number {
  assertCents(amountCents, "amount_cents");
  const Exact = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
  const pool = new Exact(amountCents).div(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  assertCents(pool, "pool_cents", true);
  return pool;
}

export function allocateCommission(poolCents: number, finalSplit: CommissionSplit): Commission {
  assertCents(poolCents, "pool_cents", true);
  const { split, Exact } = parseSplit(finalSplit);
  const earned = {} as Record<SalespersonCode, number>;
  let recipient: SalespersonCode = SALESPERSON_CODES[0];
  let roundedTotal = new Exact(0);
  for (const person of SALESPERSON_CODES) {
    const rounded = new Exact(poolCents).times(split[person]).div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    earned[person] = rounded.toNumber();
    roundedTotal = roundedTotal.plus(rounded);
    // Strict comparison preserves the first person when largest shares tie.
    if (new Exact(split[person]).gt(split[recipient])) recipient = person;
  }
  const residual = new Exact(poolCents).minus(roundedTotal);
  earned[recipient] = new Exact(earned[recipient]).plus(residual).toNumber();
  for (const person of SALESPERSON_CODES) assertCents(earned[person], person, true);
  if (sumCents(Object.values(earned), "earned_cents") !== poolCents) {
    throw new DomainError("COMMISSION_MISMATCH", "earned_cents", "Individual commissions must sum to the pool.");
  }
  return { pool_cents: poolCents, earned_cents: earned };
}

export function calculateCommission(amountCents: number, finalSplit: CommissionSplit): Commission {
  return allocateCommission(calculateCommissionPool(amountCents), finalSplit);
}
