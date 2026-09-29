import "server-only";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { canViewTransaction } from "../../domain/roles";
import { isUuid, parseTransaction, type Employee, type TransactionView } from "./types";

export const EMPLOYEE_ORDER = ["SVETLANA", "RICHARD", "ANASTASIA", "JEAN_CLAUDE", "KEVIN"] as const;
export class ReadError extends Error {
  constructor() { super("Records are unavailable. Select an active employee, or check the server setup and try again."); }
}
export async function listEmployees(): Promise<Employee[]> {
  try {
    const { data, error } = await createSupabaseAdminClient().from("employees").select("id,code,display_name,role,active");
    if (error || !data) throw new ReadError();
    return EMPLOYEE_ORDER.flatMap(code => data.filter(e => e.code === code)) as Employee[];
  } catch { throw new ReadError(); }
}
export async function readVisibleTransactions(employeeId: string): Promise<{ actor: Employee; transactions: TransactionView[] }> {
  try {
    if (!isUuid(employeeId)) throw new ReadError();
    const { data, error } = await createSupabaseAdminClient().rpc("read_visible_transactions", { p_actor_employee_id: employeeId });
    if (error || !data?.actor || !Array.isArray(data.transactions)) throw new ReadError();
    const actor = data.actor as Employee;
    if (actor.id !== employeeId || !actor.active || !EMPLOYEE_ORDER.includes(actor.code) ||
      !["MANAGER", "SALESPERSON", "EXPENSE_REPORTER"].includes(actor.role)) throw new ReadError();
    // SQL enforces visibility before returning rows; this is a second boundary check.
    const transactions = data.transactions.map(parseTransaction).filter((row: TransactionView) =>
      canViewTransaction(actor.role, actor.id, row.submitter_employee_id));
    return { actor, transactions };
  } catch { throw new ReadError(); }
}
