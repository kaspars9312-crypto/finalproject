import "server-only";
import type { FinancialDashboard } from "../server/dashboard/read";
import { euro } from "../server/sheets/rows";

function money(value: number) { return `${value < 0 ? "−" : ""}${euro(String(Math.abs(value)))}`; }
function Measures({ rows }: { rows: [string, number][] }) {
  return <dl className="financial-measures">{rows.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>;
}
export function FinancialDashboardSection({ data }: { data: FinancialDashboard }) {
  const { totals, pendingSales, awaitingExpenses } = data;
  const company = totals.company;
  return <section aria-labelledby="financial-dashboard-title">
    <h2 id="financial-dashboard-title">Financial dashboard</h2>
    <p>Current saved results in EUR. Pending sales earn no commission. All saved expenses already count toward the company result.</p>
    <div className="financial-grid">
      {(["A", "B"] as const).map(code => {
        const project = totals.projects[code];
        return <article className="transaction" key={code} aria-label={`Project ${code} financial results`}>
          <h3>Project {code}</h3><p>{code === "A" ? "Respectable Relatives" : "Drunk University Friends"}</p>
          <Measures rows={[["Approved income", project.approved_income_cents], ["Commission expense", project.commission_expense_cents],
            ["Allocated project expenses", project.allocated_expenses_cents], ["Result", project.result_cents]]} />
        </article>;
      })}
      <article className="transaction" aria-label="Company financial results"><h3>Company</h3>
        <Measures rows={[["Total approved income", company.approved_income_cents], ["Total commission expense", company.total_commissions_cents],
          ["Total allocated project expenses", company.allocated_project_expenses_cents], ["Company overhead", company.company_overhead_cents],
          ["Expenses awaiting allocation", company.awaiting_allocation_cents], ["Total company result", company.result_cents]]} />
      </article>
    </div>
    <div className="commission-panel"><table><caption>Cumulative earned commission</caption><thead><tr><th scope="col">Salesperson</th><th scope="col">Earned commission</th></tr></thead>
      <tbody>{([["Richard", "RICHARD"], ["Anastasia", "ANASTASIA"], ["Jean-Claude", "JEAN_CLAUDE"]] as const).map(([name, code]) =>
        <tr key={code}><th scope="row">{name}</th><td>{money(totals.earned_commissions_cents[code])}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Total</th><td>{money(company.total_commissions_cents)}</td></tr></tfoot>
    </table></div>
    <p>Pending sales: {pendingSales.count} · {money(pendingSales.amount_cents)}. Expenses awaiting allocation: {awaitingExpenses.count} · {money(awaitingExpenses.amount_cents)}.</p>
    <p className="subtitle">Project results subtract approved commissions and finally allocated expenses. Combined project results less company overhead and awaiting allocations equal the company result.</p>
  </section>;
}
