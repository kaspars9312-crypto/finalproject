"use server";
import { redirect } from "next/navigation";
import { retrySheetsSync } from "../server/sheets/sync";

export async function retrySheetsAction(form: FormData): Promise<void> {
  const employee = typeof form.get("employee") === "string" ? String(form.get("employee")) : "";
  const transaction = typeof form.get("transaction") === "string" ? String(form.get("transaction")) : "";
  const outcome = await retrySheetsSync(employee, transaction);
  redirect(`/?employee=${encodeURIComponent(employee)}&sync=${outcome}`);
}
