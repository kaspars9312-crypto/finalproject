import { listEmployees, readVisibleTransactions, ReadError } from "../server/records/read";
import type { Employee, TransactionView } from "../server/records/types";
import { sheetRow } from "../server/sheets/rows";
import { retrySheetsAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const roleLabels = { MANAGER: "Manager", SALESPERSON: "Salesperson", EXPENSE_REPORTER: "Expense reporter" };
const syncMessages: Record<string, string> = {
  SYNCED: "Sheets sync completed.", FAILED: "Sheets sync failed. Your transaction remains saved. You can retry below.",
  PENDING: "Sheets sync is pending. Refresh to check its status, then retry if needed.",
  BUSY: "A sync attempt already owns this transaction. Refresh shortly. If it stays pending, the operator must check the interrupted attempt.",
  FORBIDDEN: "Only an active manager can retry Sheets sync.",
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  let employees: Employee[] = [];
  let actor: Employee | undefined;
  let transactions: TransactionView[] = [];
  let error = "";
  let selected = typeof query.employee === "string" ? query.employee : "";
  try {
    employees = await listEmployees();
    if (query.employee === undefined) selected = employees.find(e => e.code === "RICHARD")?.id ?? "";
    ({ actor, transactions } = await readVisibleTransactions(selected));
  } catch { error = new ReadError().message; }
  return (
    <main>
      <header>
        <p className="subtitle">Wedding Guests for Hire</p>
        <h1>Friends Included</h1>
        <p>All friendships expire at checkout.</p>
      </header>
      <section className="role-panel" aria-label="Demonstration access">
        <form method="get">
          <label htmlFor="employee">Demonstration role</label>
          <div className="selector">
            <select id="employee" name="employee" defaultValue={selected} required>
              <option value="" disabled>Select an employee</option>
              {employees.map(e => <option key={e.id} value={e.id} disabled={!e.active}>{e.display_name}{e.active ? "" : " (inactive)"}</option>)}
            </select>
            <button type="submit">View records</button>
          </div>
        </form>
        {actor && <p>Viewing as <strong>{actor.display_name}</strong> · {roleLabels[actor.role]}<br />
          {actor.role === "MANAGER" ? "All employee submissions." : "Your submissions and their current statuses."}</p>}
      </section>
      {error && <p role="alert" className="notice">{error}</p>}
      {typeof query.sync === "string" && syncMessages[query.sync] && <p role="status" className="notice">{syncMessages[query.sync]}</p>}
      {actor && <section aria-label="Transactions">
        <h2>Transactions <span className="count">{transactions.length}</span></h2>
        {transactions.length === 0 ? <p className="empty">No submissions are visible for this employee yet.</p> :
          <div className="records">{transactions.map(t => {
            const row = sheetRow(t);
            return <article key={t.id} className="transaction">
              <div className="record-heading"><h3>{t.reference}</h3><span className="badge">{t.transaction_type === "SALE" ? "Sale" : "Expense"}</span></div>
              <dl>{row.headers.map((label, i) => <div key={label}><dt>{label}</dt><dd>{row.values[i] || "Not decided"}</dd></div>)}</dl>
              <div className="sync-panel">
                <p><strong>Sheets sync status:</strong> {t.sheet_sync_status === "SYNCED" ? "SYNCED" : t.sheet_sync_status === "FAILED" ? "Sync failed (FAILED)" : "Sync pending (PENDING)"}</p>
                {actor.role === "MANAGER" && <>
                  {t.sheet_last_error && <p className="sync-error">Sheets sync failed. Retry to synchronize the saved transaction.</p>}
                  {t.sheet_sync_status !== "SYNCED" && <form action={retrySheetsAction}>
                    <input type="hidden" name="employee" value={actor.id} />
                    <input type="hidden" name="transaction" value={t.id} />
                    <button type="submit">Retry Sheets sync</button>
                  </form>}
                </>}
              </div>
            </article>;
          })}</div>}
      </section>}
      <footer>Supabase holds the saved records. Google Sheets receives a readable copy. Refresh this page to see new submissions and sync results.</footer>
    </main>
  );
}
