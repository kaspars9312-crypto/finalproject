import "server-only";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { canViewTransaction } from "../../domain/roles";
import { EMPLOYEE_ORDER, ReadError } from "../records/read";
import { isUuid, parseTransaction, type Employee, type TransactionView } from "../records/types";
import { telegramId } from "../telegram/types";

export type NotificationStatus = "NOT_REQUIRED" | "PENDING" | "FAILED" | "SENT" | "NO_RECIPIENT";
export interface WorkflowTransaction extends TransactionView {
  original_submission: Record<string, string>;
  decision_notification_status: NotificationStatus;
  decision_delivery_busy: boolean;
}
export interface EmployeeLink { telegram_user_id: string; employee_id: string | null; private_chat_known: boolean }
export interface WorkflowData { actor: Employee; transactions: WorkflowTransaction[]; links: EmployeeLink[] }

export async function readWorkflow(employeeId: string): Promise<WorkflowData> {
  try {
    if (!isUuid(employeeId)) throw new ReadError();
    const { data, error } = await createSupabaseAdminClient().rpc("read_website_workflow", { p_actor_employee_id: employeeId });
    const actor = data?.actor as Employee;
    if (error || !actor || actor.id !== employeeId || !actor.active || !EMPLOYEE_ORDER.includes(actor.code) ||
      !["MANAGER", "SALESPERSON", "EXPENSE_REPORTER"].includes(actor.role) || !Array.isArray(data.transactions) || !Array.isArray(data.links)) throw new ReadError();
    const transactions = data.transactions.map((value: unknown) => {
      const t = parseTransaction(value) as WorkflowTransaction;
      if (!["NOT_REQUIRED", "PENDING", "FAILED", "SENT", "NO_RECIPIENT"].includes(t.decision_notification_status) ||
        typeof t.decision_delivery_busy !== "boolean" || !t.original_submission ||
        typeof t.original_submission !== "object" || Array.isArray(t.original_submission) ||
        Object.values(t.original_submission).some(v => typeof v !== "string")) throw new ReadError();
      return t;
    }).filter((t: WorkflowTransaction) => canViewTransaction(actor.role, actor.id, t.submitter_employee_id));
    const links = actor.role === "MANAGER" ? data.links.map((l: EmployeeLink) => {
      if (typeof l.telegram_user_id !== "string" || BigInt(telegramId(l.telegram_user_id)) <= BigInt(0) ||
        (l.employee_id !== null && !isUuid(l.employee_id)) || typeof l.private_chat_known !== "boolean") throw new ReadError();
      return { telegram_user_id: l.telegram_user_id, employee_id: l.employee_id, private_chat_known: l.private_chat_known };
    }) : [];
    return { actor, transactions, links };
  } catch { throw new ReadError(); }
}
