import { describe, expect, it } from "vitest";
import { allocateCommission, calculateCommission, calculateCommissionPool, validateCommissionSplit } from "./commission";
import { SALESPERSON_CODES, type CommissionSplit } from "./types";
import { DomainError } from "./validation";

const split = (r: string, a: string, j: string): CommissionSplit => ({ RICHARD: r, ANASTASIA: a, JEAN_CLAUDE: j });

describe("exact split validation", () => {
  it.each([
    ["50", "30", "20"], ["0", "50", "50"], ["100", "0", "0"],
    ["33.33", "33.33", "33.34"], ["12.5", "37.5", "50"],
    ["0.1", "0.2", "99.7"],
    ["0.000000000000000000000000000001", "0", "99.999999999999999999999999999999"],
  ])("accepts %s / %s / %s", (r, a, j) => {
    expect(validateCommissionSplit(split(r, a, j))).toEqual(split(r, a, j));
  });
  it.each([
    ["60", "30", "20", "SPLIT_TOTAL"], ["33.33", "33.33", "33.33", "SPLIT_TOTAL"],
    ["-1", "51", "50", "PERCENTAGE_RANGE"], ["101", "0", "-1", "PERCENTAGE_RANGE"],
    ["50", "50", "0.000000000000000000000000000001", "SPLIT_TOTAL"],
    ["99.999999999999999999999999999999", "0", "0", "SPLIT_TOTAL"],
    ["100.000000000000000000000000000001", "0", "0", "PERCENTAGE_RANGE"],
  ])("rejects %s / %s / %s", (r, a, j, code) => {
    expect(() => validateCommissionSplit(split(r, a, j))).toThrowError(expect.objectContaining({ code }));
  });
  it.each(["", " ", "abc", "NaN", "Infinity", "1e2", "0xff", "5_0", "30%", "33,33", "1.2.3", 50, null, undefined, {}, []])(
    "rejects malformed or missing share %j cleanly", (value) => {
      expect(() => validateCommissionSplit({ RICHARD: value, ANASTASIA: "50", JEAN_CLAUDE: "0" }))
        .toThrowError(DomainError);
    },
  );
  it.each([null, undefined, [], "50/30/20", {}, { RICHARD: "100", ANASTASIA: "0" }])(
    "requires all three named percentages: %j", (value) => {
      expect(() => validateCommissionSplit(value)).toThrowError(expect.objectContaining({ code: "REQUIRED" }));
    },
  );
  it("returns field-specific corrections and trims input", () => {
    expect(() => validateCommissionSplit(split("-1", "51", "50"))).toThrowError(
      expect.objectContaining({ code: "PERCENTAGE_RANGE", field: "RICHARD" }),
    );
    expect(validateCommissionSplit(split(" 12.5 ", "37.5", "50"))).toEqual(split("12.5", "37.5", "50"));
  });
});

describe("commission pool", () => {
  it.each([[100000, 10000], [200000, 20000], [1, 0], [4, 0], [5, 1], [15, 2], [101, 10],
    [Number.MAX_SAFE_INTEGER, 900719925474099]])("rounds %i cents to %i cents", (amount, expected) => {
    expect(calculateCommissionPool(amount)).toBe(expected);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s", (amount) => {
    expect(() => calculateCommissionPool(amount)).toThrowError(DomainError);
  });
});

describe("individual commissions", () => {
  it.each([
    ["S01", 100000, split("50", "30", "20"), 10000, [5000, 3000, 2000]],
    ["S02 final", 200000, split("20", "40", "40"), 20000, [4000, 8000, 8000]],
    ["S03 final", 150000, split("20", "30", "50"), 15000, [3000, 4500, 7500]],
    ["S04", 80000, split("25", "25", "50"), 8000, [2000, 2000, 4000]],
  ] as const)("matches %s", (_name, amount, shares, pool, earned) => {
    expect(calculateCommission(amount, shares)).toEqual({ pool_cents: pool,
      earned_cents: { RICHARD: earned[0], ANASTASIA: earned[1], JEAN_CLAUDE: earned[2] } });
  });
  it.each([
    [1, split("33.33", "33.33", "33.34"), [0, 0, 1]], // Positive residual to Jean-Claude.
    [2, split("33.33", "33.33", "33.34"), [1, 1, 0]], // Negative residual to Jean-Claude.
    [1, split("50", "50", "0"), [0, 1, 0]], // Richard wins a tie with Anastasia.
    [1, split("50", "0", "50"), [0, 0, 1]], // Richard wins a tie with Jean-Claude.
    [1, split("0", "50", "50"), [0, 0, 1]], // Anastasia wins a tie with Jean-Claude.
    [1, split("40", "40", "20"), [1, 0, 0]],
    [0, split("100", "0", "0"), [0, 0, 0]],
    [1, split("49.999999999999999999999999999999", "50.000000000000000000000000000001", "0"), [0, 1, 0]],
  ] as const)("applies the signed residual at pool %i with %j", (pool, shares, earned) => {
    const result = allocateCommission(pool, shares);
    expect(result.earned_cents).toEqual({ RICHARD: earned[0], ANASTASIA: earned[1], JEAN_CLAUDE: earned[2] });
    expect(Object.values(result.earned_cents).reduce((a, b) => a + b, 0)).toBe(pool);
  });
  it("rounds the pool before dividing it", () => {
    expect(calculateCommission(5, split("50", "30", "20"))).toEqual({ pool_cents: 1,
      earned_cents: { RICHARD: 1, ANASTASIA: 0, JEAN_CLAUDE: 0 } });
  });
  it("preserves cents across a deterministic grid of pools and splits", () => {
    for (let r = 0; r <= 100; r += 5) {
      for (let a = 0; a <= 100 - r; a += 5) {
        for (const pool of [0, 1, 2, 3, 5, 7, 101, 999, Number.MAX_SAFE_INTEGER]) {
          const result = allocateCommission(pool, split(String(r), String(a), String(100 - r - a)));
          const amounts = SALESPERSON_CODES.map((person) => result.earned_cents[person]);
          expect(amounts.every((amount) => Number.isSafeInteger(amount) && amount >= 0)).toBe(true);
          expect(amounts.reduce((total, amount) => total + BigInt(amount), BigInt(0))).toBe(BigInt(pool));
        }
      }
    }
  });
  it.each([-1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid pool %s", (pool) => {
    expect(() => allocateCommission(pool, split("100", "0", "0"))).toThrowError(DomainError);
  });
  it("does not mutate the final split", () => {
    const shares = Object.freeze(split("50", "30", "20"));
    calculateCommission(100000, shares);
    expect(shares).toEqual(split("50", "30", "20"));
  });
});
