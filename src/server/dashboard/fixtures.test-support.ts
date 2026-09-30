// Official assignment data: test imports only. Never seed a database from here.
import type { TransactionView } from "../records/types";
import { employees, sale, expense } from "../sheets/fixtures.test-support";
type Split = [string, string, string];
function officialSale(ref: string, employee: number, customer: string, description: string, project: "A" | "B",
  amount: string, proposed: Split, final: Split | null, earned: Split = ["0", "0", "0"]): TransactionView {
  return { ...sale, id: `aaaaaaaa-aaaa-4aaa-8aaa-${ref.slice(1).padStart(12, "0")}`, reference: ref,
    submitter_employee_id: employees[employee].id, submitter_name: employees[employee].display_name,
    customer, description, project, amount_cents: amount, revision: final ? 2 : 1,
    status: final ? "APPROVED" : "PENDING_APPROVAL",
    proposed_richard_pct: proposed[0], proposed_anastasia_pct: proposed[1], proposed_jean_claude_pct: proposed[2],
    final_richard_pct: final?.[0] ?? null, final_anastasia_pct: final?.[1] ?? null, final_jean_claude_pct: final?.[2] ?? null,
    richard_commission_cents: earned[0], anastasia_commission_cents: earned[1], jean_claude_commission_cents: earned[2] };
}
function officialExpense(ref: string, description: string, category: TransactionView["expense_category"], amount: string,
  proposed: TransactionView["proposed_allocation"], final: TransactionView["final_allocation"]): TransactionView {
  return { ...expense, id: `bbbbbbbb-bbbb-4bbb-8bbb-${ref.slice(1).padStart(12, "0")}`, reference: ref,
    description, expense_category: category, amount_cents: amount, proposed_allocation: proposed, final_allocation: final,
    status: final ? "ALLOCATED" : "AWAITING_ALLOCATION", revision: final && proposed !== "COMPANY_OVERHEAD" ? 2 : 1 };
}
export function test1(beforeDecisions = false): TransactionView[] {
  return [
    officialSale("S01", 1, "Olivia Rose", "One proud uncle and an emotional grandmother", "A", "100000",
      ["50", "30", "20"], beforeDecisions ? null : ["50", "30", "20"], beforeDecisions ? undefined : ["5000", "3000", "2000"]),
    officialSale("S02", 2, "Daniel King", "University friends, dancing, and the stripping performance", "B", "200000",
      ["0", "50", "50"], beforeDecisions ? null : ["20", "40", "40"], beforeDecisions ? undefined : ["4000", "8000", "8000"]),
    officialExpense("E01", "Rented suit and fake pearl necklace for the relatives", "MATERIALS", "12000", "A", beforeDecisions ? null : "A"),
    officialExpense("E02", "Taxi for the grandmother; Kevin selected the wrong project", "TRAVEL", "8000", "B", beforeDecisions ? null : "A"),
    officialExpense("E03", "Monthly company website subscription", "OTHER", "10000", "COMPANY_OVERHEAD", "COMPANY_OVERHEAD"),
  ];
}
export function test2(): TransactionView[] {
  return [...test1(),
    officialSale("S03", 3, "Emma Stonebridge", "Premium relatives, including an uncle presented as a surgeon", "A", "150000",
      ["40", "40", "20"], ["20", "30", "50"], ["3000", "4500", "7500"]),
    officialSale("S04", 1, "Lucas Green", "Small group of loud university friends", "B", "80000",
      ["25", "25", "50"], ["25", "25", "50"], ["2000", "2000", "4000"]),
    officialSale("S05", 1, "Mia Brooks", "Extra guests and an embarrassing speech", "B", "60000", ["100", "0", "0"], null),
    officialExpense("E04", "Replacement costumes after an enthusiastic dance performance", "MATERIALS", "25000", "B", "B"),
    officialExpense("E05", "Minibus for university friends; Kevin selected the wrong project again", "TRAVEL", "9000", "A", "B"),
    officialExpense("E06", "Company telephone subscription", "OTHER", "6000", "COMPANY_OVERHEAD", "COMPANY_OVERHEAD"),
    officialExpense("E07", "Emergency replacement clothing; project allocation still needs checking", "MATERIALS", "14000", "A", null),
  ];
}
