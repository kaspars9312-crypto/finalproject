"use client";
import { useActionState, type ReactNode } from "react";
import { workflowAction } from "./workflow-action";

export function ActionForm({ children, label }: { children: ReactNode; label: string }) {
  const [state, action, pending] = useActionState(workflowAction, { ok: false, message: "" });
  return <form action={action} aria-label={label} className="workflow-form">
    <fieldset disabled={pending}>{children}</fieldset>
    {pending && <p role="status">Saving and checking delivery…</p>}
    {state.message && <p className="notice" role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}
