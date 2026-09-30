export function SubmissionInfo() {
  return <section className="role-panel submission-info" aria-label="Submission and instructions">
    <p><strong>Student:</strong> Kaspars Bickovs</p>
    <nav aria-label="Project links">
      <a href="https://t.me/friends_included_final_bot" target="_blank" rel="noopener noreferrer">Telegram bot</a>
      <a href="https://docs.google.com/spreadsheets/d/1Q8_NLiBBNTiDLmSAhnhs7ddAKkJU8xiHbRyN-CNdTMk/edit" target="_blank" rel="noopener noreferrer">Google Sheets transactions</a>
      <a href="https://github.com/kaspars9312-crypto/finalproject" target="_blank" rel="noopener noreferrer">GitHub repository</a>
    </nav>
    <details><summary>How to use the application</summary><ol>
      <li>Choose an employee under Demonstration role and select View records.</li>
      <li>Salespeople submit sales; Kevin submits expenses.</li>
      <li>Switch to Svetlana to review pending sales and expense allocations.</li>
      <li>Svetlana can save corrections before approving sales, choose final commission splits, and allocate expenses.</li>
      <li>Financial results update after saved decisions. Refresh to see submissions made elsewhere.</li>
      <li>Google Sheets receives the readable transaction copy; Telegram receives submission and decision notifications where applicable.</li>
    </ol></details>
  </section>;
}
