import type { Employee } from "../server/records/types";
import type { WorkflowData, WorkflowTransaction } from "../server/website/read";
import { NO_RECIPIENT_TEXT } from "../server/telegram/decisions";
import { allocation, euro, sheetRow } from "../server/sheets/rows";
import { ActionForm } from "./action-form";

function Identity({ employee, command, transaction }: { employee: string; command: string; transaction?: WorkflowTransaction }) {
  return <><input type="hidden" name="employee" value={employee} /><input type="hidden" name="command" value={command} />
    {transaction && <><input type="hidden" name="transaction" value={transaction.id} />
      <input type="hidden" name="revision" value={transaction.revision} /></>}</>;
}
function TextField({ name, label, value, decimal = false }: { name: string; label: string; value?: string; decimal?: boolean }) {
  return <label>{label}<input name={name} defaultValue={value} required inputMode={decimal ? "decimal" : undefined} /></label>;
}
function AllocationField({ value = "A", label = "Proposed allocation" }: { value?: string; label?: string }) {
  return <label>{label}<select name="allocation" defaultValue={value} required>
    <option value="A">A</option><option value="B">B</option><option value="COMPANY_OVERHEAD">Company overhead</option>
  </select></label>;
}
function SaleFields({ t }: { t?: WorkflowTransaction }) {
  return <><TextField name="customer" label="Customer" value={t?.customer ?? undefined} />
    <label>Project<select name="project" defaultValue={t?.project ?? "A"} required><option>A</option><option>B</option></select></label>
    <TextField name="description" label="Description" value={t?.description} />
    <TextField name="amount" label="Amount (EUR, at most two decimals)" decimal value={t ? euro(t.amount_cents).slice(1) : undefined} /></>;
}
function SplitFields({ t, final = false }: { t?: WorkflowTransaction; final?: boolean }) {
  return <><p>Shares must total exactly 100%. {final && "The final split is saved only when approved."}</p>
    <div className="split-fields">
      <TextField name="richard" label={`${final ? "Final" : "Proposed"} Richard %`} decimal value={t?.proposed_richard_pct ?? undefined} />
      <TextField name="anastasia" label={`${final ? "Final" : "Proposed"} Anastasia %`} decimal value={t?.proposed_anastasia_pct ?? undefined} />
      <TextField name="jeanClaude" label={`${final ? "Final" : "Proposed"} Jean-Claude %`} decimal value={t?.proposed_jean_claude_pct ?? undefined} />
    </div></>;
}
function RecordDetails({ t }: { t: WorkflowTransaction }) {
  const row = sheetRow(t);
  return <><dl>{row.headers.map((label, i) => <div key={label}><dt>{label}</dt><dd>{row.values[i] || "Not decided"}</dd></div>)}</dl>
    <p>Sheets: {t.sheet_sync_status} · Telegram decision: {t.decision_notification_status}</p></>;
}
function OriginalSale({ t }: { t: WorkflowTransaction }) {
  const o = t.original_submission;
  return <details><summary>Original submitted proposal</summary><dl>
    {[["Reference", o.reference], ["Customer", o.customer], ["Project", o.project], ["Description", o.description],
      ["Amount", o.amount_cents && /^\d+$/.test(o.amount_cents) ? euro(o.amount_cents) : "Unavailable"],
      ["Proposed Richard %", o.proposed_richard_pct], ["Proposed Anastasia %", o.proposed_anastasia_pct],
      ["Proposed Jean-Claude %", o.proposed_jean_claude_pct]].map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl></details>;
}

export function WebsiteWorkflow({ data, employees }: { data: WorkflowData; employees: Employee[] }) {
  const { actor, transactions, links } = data;
  const pending = transactions.filter(t => t.status === "PENDING_APPROVAL");
  const awaiting = transactions.filter(t => t.status === "AWAITING_ALLOCATION");
  const decisions = transactions.filter(t => t.decision_notification_status !== "NOT_REQUIRED");
  return <>
    {actor.role === "SALESPERSON" && <section className="role-panel" aria-label="Submit sale">
      <h2>Submit sale</h2><p>The sale stays pending with €0.00 earned commission until Svetlana approves it.</p>
      <ActionForm label="Submit sale"><Identity employee={actor.id} command="sale" />
        <TextField name="reference" label="Unique reference" /><SaleFields /><SplitFields /><button type="submit">Submit sale</button>
      </ActionForm>
    </section>}
    {actor.role === "EXPENSE_REPORTER" && <section className="role-panel" aria-label="Submit expense">
      <h2>Submit expense</h2><p>The expense counts immediately. A/B awaits allocation; Company overhead is allocated automatically.</p>
      <ActionForm label="Submit expense"><Identity employee={actor.id} command="expense" />
        <TextField name="reference" label="Unique reference" /><TextField name="description" label="Description" />
        <TextField name="amount" label="Amount (EUR, at most two decimals)" decimal />
        <label>Category<select name="category" required><option value="MATERIALS">Materials</option><option value="TRAVEL">Travel</option><option value="OTHER">Other</option></select></label>
        <AllocationField /><button type="submit">Submit expense</button>
      </ActionForm>
    </section>}
    {actor.role === "MANAGER" && <section aria-label="Manager decisions">
      <h2>Manager decisions</h2><p>Review current values and the original proposal. Save field corrections first, then approve the saved sale. To leave a record pending, take no action.</p>
      <h3>Pending sales ({pending.length})</h3>
      {pending.length === 0 && <p>No sales await approval.</p>}
      <div className="records">{pending.map(t => <article key={`${t.id}-${t.revision}`} className="transaction">
        <h3>{t.reference}</h3><p>Current pending values</p><RecordDetails t={t} /><OriginalSale t={t} />
        <details><summary>Correct pending sale fields</summary>
          <ActionForm label={`Correct ${t.reference}`}><Identity employee={actor.id} command="correct" transaction={t} /><SaleFields t={t} />
            <button type="submit">Save correction without approval</button></ActionForm>
        </details>
        <ActionForm label={`Approve proposal ${t.reference}`}><Identity employee={actor.id} command="approveProposed" transaction={t} />
          <button type="submit">Approve proposed split unchanged</button></ActionForm>
        <details><summary>Change final commission split and approve</summary>
          <ActionForm label={`Approve final split ${t.reference}`}><Identity employee={actor.id} command="approveFinal" transaction={t} /><SplitFields t={t} final />
            <button type="submit">Approve with final split</button></ActionForm>
        </details>
      </article>)}</div>
      <h3>Awaiting expense allocations ({awaiting.length})</h3>
      {awaiting.length === 0 && <p>No expenses await allocation.</p>}
      <div className="records">{awaiting.map(t => <article key={`${t.id}-${t.revision}`} className="transaction">
        <h3>{t.reference}</h3><RecordDetails t={t} />
        <ActionForm label={`Allocate ${t.reference}`}><Identity employee={actor.id} command="allocate" transaction={t} />
          <AllocationField label="Final allocation" value={t.proposed_allocation!} /><button type="submit">Approve allocation</button></ActionForm>
      </article>)}</div>
      <section className="role-panel" aria-label="Telegram employee-link setup">
        <h3>Telegram employee-link setup</h3><p>The Telegram user must first send /start to the bot in a private chat. Linking replaces any previous assignment for that user or employee.</p>
        {links.length === 0 ? <p>No Telegram users have started the bot yet.</p> : <ul>{links.map(l => <li key={l.telegram_user_id}>
          Telegram user {l.telegram_user_id} — {employees.find(e => e.id === l.employee_id)?.display_name ?? "Unlinked"} — {l.private_chat_known ? "Private chat known" : "Private chat unavailable"}
        </li>)}</ul>}
        <ActionForm label="Link Telegram employee"><Identity employee={actor.id} command="link" />
          <TextField name="telegramUserId" label="Telegram user ID" />
          <label>Employee<select name="linkedEmployee" required>{employees.map(e => <option key={e.id} value={e.id} disabled={!e.active}>{e.display_name}</option>)}</select></label>
          <button type="submit">Save Telegram link</button></ActionForm>
      </section>
    </section>}
    {decisions.length > 0 && <section aria-label="Decision delivery"><h2>Telegram decision delivery</h2>
      <div className="records">{decisions.map(t => <article key={t.id} className="transaction"><h3>{t.reference}</h3>
        <p>Telegram decision: {t.decision_notification_status}</p>
        {t.decision_notification_status === "NO_RECIPIENT" && <p>{NO_RECIPIENT_TEXT}</p>}
        {t.transaction_type === "EXPENSE" && <p>Final allocation: {allocation(t.final_allocation)}</p>}
        {t.decision_notification_status === "FAILED" && <p>Delivery failed. The financial decision remains saved.</p>}
        {t.decision_delivery_busy && <p>A delivery attempt owns this record. Refresh shortly. If it remains pending, the operator must check the interrupted attempt.</p>}
        {actor.role === "MANAGER" && !t.decision_delivery_busy && ["PENDING", "FAILED"].includes(t.decision_notification_status) &&
          <ActionForm label={`Retry decision ${t.reference}`}><Identity employee={actor.id} command="retryDecision" transaction={t} />
            <button type="submit">Retry Telegram decision</button></ActionForm>}
      </article>)}</div>
    </section>}
  </>;
}
