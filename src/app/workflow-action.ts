"use server";
import { revalidatePath } from "next/cache";
import { executeWebsiteForm, type FormResult } from "../server/website/execute";

export async function workflowAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const result = await executeWebsiteForm(form);
  // Also refresh failed delivery attempts: their metadata may have changed.
  revalidatePath("/");
  return result;
}
