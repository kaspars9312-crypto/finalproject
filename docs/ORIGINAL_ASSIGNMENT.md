Build a working system connecting Telegram, Supabase, Vercel, and Google
Sheets. Employees report transactions, the manager makes decisions, and
records and financial results update automatically.

Use Codex to plan, build, diagnose, and improve the application. The
finished system follows fixed rules and does not need an AI model or a
paid AI API. All people and transactions are fictional.

## Friends Included Ltd

*All friendships expire at checkout.*

You can buy the dress, rent the venue, and order the cake. But what if
you have nobody to invite? Friends Included supplies convincing wedding
guests who remember your childhood, love your partner, and know exactly
when to cry. Unfortunately, its financial records depend on Telegram
messages, somebody’s memory, and three salespeople who each believe they
deserve most of the commission.

## Project A Respectable Relatives

We provide well-dressed relatives who arrive on time, bring an empty
gift box, and tell your new in-laws how successful you are. Choose a
proud uncle, an emotional aunt, or a grandmother who approves of
absolutely everything. For an additional fee, the uncle is a surgeon.

## Project B Drunk University Friends

We provide loud friends who shout your name, start the dancing, and
claim that you were a legend at university—even if you never attended
one. The package includes embarrassing speeches, terrible singing, and
one woman who removes her shirt and insists that this was normal in your
student days. Actual alcohol is charged separately; falling into the
wedding cake requires manager approval.

## The staff

**Manager — Svetlana de Monte Carlo.** Born Svetlana Petrova; changed
her name after one weekend in Monaco. Will approve a €400 stripping
performance but wants a written explanation for €6 of parking.

**Salesperson — Richard “Call Me Dick” Darling.** Introduces himself
this way on every international sales call and waits for a reaction.
Sells Respectable Relatives using photographs of himself in other
people’s family portraits.

**Salesperson — Anastasia Ferrari.** Neither Italian nor the owner of a
Ferrari. Calls every customer “darling,” including in overdue-payment
reminders. Claims the commission because “they bought the feeling, and
the feeling was me.”

**Salesperson — Jean-Claude Bērziņš.** From Jelgava. Uses a French
accent until a French customer calls. Regularly promises “a discreet
European atmosphere,” then books the stripping guest.

**Expense reporter — Kevin von Whatever.** Changed his surname because
the online form allowed it. Handles costumes, transport, and emergency
underwear. His expense descriptions sometimes raise more questions than
they answer.

# 1 Build the connections and user access

| **System**    | **Its job**                                                                        |
|---------------|------------------------------------------------------------------------------------|
| Telegram      | One bot for staff submissions, confirmations, and manager-decision notifications.  |
| Supabase      | Stores employees, transactions, commission proposals, and final manager decisions. |
| Vercel        | Hosts the website, entry forms, manager approval area, and financial dashboard.    |
| Google Sheets | Receives an automatically updated, readable copy of transactions.                  |

Supabase is the source of truth. Google Sheets is a copy for viewing and
checking; spreadsheet edits do not need to update the application.
Telegram and website entries must use the same transaction-processing
and calculation rules.

## Your first working milestone

**Submit one transaction through Telegram → save it in Supabase →
display it on Vercel → see it in Google Sheets.**

Once this works, add approvals, commissions, notifications, and the
dashboard. Then run the two tests. Clear temporary practice transactions
before starting Test 1.

## Roles and permissions

| **Role**                        | **Can submit**                       | **Can approve or correct**                        |
|---------------------------------|--------------------------------------|---------------------------------------------------|
| Richard, Anastasia, Jean-Claude | Sales and proposed commission splits | Nothing                                           |
| Kevin                           | Expenses and proposed allocations    | Nothing                                           |
| Svetlana                        | No routine entry required            | Sales, commission splits, and expense allocations |

Salespeople and Kevin see their own submissions and statuses. Svetlana
sees all transactions and financial results. Once a role is selected,
enforce its permissions when processing actions; hiding a button alone
is insufficient.

## Simple demonstration access

Provide a website selector labelled “Demonstration role” containing the
five employees. This lets you and your instructor test the fictional
system without creating five accounts. A full website login system and a
separate assessment environment are not required. Use fictional data
only.

In Telegram, identify the sender by Telegram user ID. Provide a manager
setup screen linking that ID to a fictional employee. An unlinked
Telegram user cannot submit transactions, and a user cannot assign
themselves a role through the bot.

Store the originating Telegram chat ID on each bot submission. It is the
destination for later notifications, even if you subsequently change the
employee linked to that Telegram account. For website entries, use the
employee’s linked Telegram chat if available.

## Required transaction information

Sales: unique reference, automatically identified salesperson, customer,
project A or B, description, amount, and proposed commission percentages
for Richard, Anastasia, and Jean-Claude.

Expenses: unique reference, automatically identified reporter,
description, amount, category (Materials, Travel, Other), and proposed
allocation (A, B, Company overhead).

Record submission time automatically. Refuse missing required
information and duplicate references. Allow the supplied references
S01–S05 and E01–E07 in the tests.

# 2 Apply the business rules

## Financial assumptions

- All amounts are euros. Do not calculate VAT or other taxes. Display
  money to two decimal places.

- All reported sales concern services already delivered and paid for.
  “Pending” means awaiting internal approval, not awaiting customer
  payment.

- All reported expenses have already been paid. Sale and expense amounts
  must be greater than zero.

- Calculate commission earned; tracking commission payments is not
  required.

## Sales and commissions

Save each sale as Pending approval. Show it in the records but exclude
it from income and commission totals. Svetlana can approve the proposed
commission split or change it before approving the sale. Approval
includes both the sale and its final commissions in the results.

The commission pool is 10% of the sale amount. Proposed shares divide
this pool among Richard, Anastasia, and Jean-Claude. Each share can be
0% to 100%; together they must equal 100%.

Example: a €1,000 sale creates a €100 pool. A 50% / 30% / 20% split
gives commissions of €50 / €30 / €20.

Commission is an expense of the same project as the sale. Calculate it
automatically; never enter it again as a separate expense. Round the
pool and individual commissions to cents. Give any rounding difference
to the person with the largest percentage share; for equal largest
shares, use Richard, then Anastasia, then Jean-Claude.

## Expenses and allocation

Every saved expense immediately reduces company result. Expenses
proposed as Company overhead are allocated automatically. Expenses
proposed for A or B are saved as Awaiting allocation until Svetlana
decides.

Svetlana can confirm the proposed project or move the expense to the
other project or company overhead. While awaiting allocation, the
expense reduces company result but neither project’s result. Approval
assigns the expense; it must not deduct it from company result again.

## Record updates

- Preserve the original proposal and the manager’s final decision.
  Approval updates the existing record, including its Google Sheets row.

- Approving the same transaction twice must not duplicate the
  transaction, commission, or expense.

- Corrections happen before approval. Editing approved transactions is
  not required. A manager may leave a transaction pending.

## Calculations

**Project result = Approved project sales − Project sales commissions −
Expenses allocated to that project.**

**Company result = All approved sales − All sales commissions − All
recorded expenses.**

Company overhead and expenses awaiting allocation explain the difference
between combined project results and company result.

# 3 Show results and notify employees

## The website

- Show approved income, commissions, allocated expenses, and result for
  each project.

- Show company overhead, expenses awaiting allocation, total company
  result, and commission earned by each salesperson.

- Show pending sales and expense allocations. Let Svetlana inspect
  original proposals and approve or correct them.

## Telegram confirmations and decisions

After a successful submission, confirm the reference, amount, project or
proposed allocation, and current status. If submission fails, explain
what needs correcting. Confirm recording only after the transaction is
saved.

After sale approval, automatically notify the submitting salesperson.
Include reference, sale amount, total commission, each person’s final
percentage and euro amount, and whether the manager changed the split.

After expense allocation is confirmed, automatically notify the
reporter. Include reference, amount, description, and final allocation.
Highlight any change from the proposal. Automatically allocated overhead
needs only its initial submission confirmation.

Send these decisions to the original submitting Telegram chat. For
website entries, notify the employee’s linked chat if one exists;
otherwise show “No Telegram recipient linked” on the record. Each
recipient must first start the bot. Do not require all three commission
recipients to receive notifications.

## Example notifications

Sale S02 approved — commission split changed. Sale €2,000; total
commission €200. Richard: 0% → 20% (€40). Anastasia: 50% → 40% (€80).
Jean-Claude: 50% → 40% (€80).

Expense E02 — allocation changed. €80: Taxi for the grandmother.
Proposed: Drunk University Friends. Approved: Respectable Relatives.

## Google Sheets

Use two tabs. Use separate columns for the three salespeople and for
proposed and approved percentages so a reviewer can read the records
easily.

| **Tab**  | **Required columns**                                                                                                                                                      |
|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Sales    | Reference, submission time, salesperson, customer, project, description, amount, original commission split, approved split, individual earned commission amounts, status. |
| Expenses | Reference, submission time, reporter, description, category, amount, proposed allocation, final allocation, status.                                                       |

Pending sales have zero earned commission and no approved split yet.
Keep proposed project allocations separate from final allocations. Both
new submissions and later decisions must synchronize automatically;
manual copying is insufficient.

## Failed delivery or synchronization

If a transaction is saved but Google Sheets does not update, show “Sync
pending” or “Sync failed” and provide a retry. Retry using the same
reference without creating another transaction. If a Telegram
notification fails, retain the saved decision and show the failure with
a retry; do not label it sent.

# 4 Test 1 Normal operation

Start with no practice transactions. Use Telegram for S01 and E01, and
the website role selector for the remaining entries. Commission splits
throughout both tests are Richard / Anastasia / Jean-Claude.

To test alone: start the bot, link your Telegram user ID to Richard in
manager setup, and submit S01. Change the link to Kevin and submit E01.
S01 must retain Richard as its submitter and your original chat as its
notification destination.

## Sales

<table>
<colgroup>
<col style="width: 5%" />
<col style="width: 19%" />
<col style="width: 33%" />
<col style="width: 7%" />
<col style="width: 11%" />
<col style="width: 22%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Ref</strong></th>
<th><strong>Salesperson and customer</strong></th>
<th><strong>Description</strong></th>
<th><strong>Project</strong></th>
<th><strong>Amount</strong></th>
<th><strong>Proposed split</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>S01</td>
<td>Richard<br />
Olivia Rose</td>
<td>One proud uncle and an emotional grandmother</td>
<td>A</td>
<td>€1,000</td>
<td>50 / 30 / 20%</td>
</tr>
<tr class="even">
<td>S02</td>
<td>Anastasia<br />
Daniel King</td>
<td>University friends, dancing, and the stripping performance</td>
<td>B</td>
<td>€2,000</td>
<td>0 / 50 / 50%</td>
</tr>
</tbody>
</table>

## Expenses submitted by Kevin

| **Ref** | **Description**                                            | **Category** | **Amount** | **Proposed allocation** |
|---------|------------------------------------------------------------|--------------|------------|-------------------------|
| E01     | Rented suit and fake pearl necklace for the relatives      | Materials    | €120       | A                       |
| E02     | Taxi for the grandmother; Kevin selected the wrong project | Travel       | €80        | B                       |
| E03     | Monthly company website subscription                       | Other        | €100       | Company overhead        |

## Before manager decisions

Both sales are pending. E01 and E02 await allocation; E03 is company
overhead. Approved income and commission expense are €0. Both project
results are €0. Company result is −€300.

## Manager actions

| **Ref** | **Svetlana’s action**                              |
|---------|----------------------------------------------------|
| S01     | Approve the proposed split.                        |
| S02     | Change the split to 20% / 40% / 40%, then approve. |
| E01     | Approve allocation to A.                           |
| E02     | Change allocation from B to A, then approve.       |

Check Telegram: receive the S01 approval and E01 allocation confirmation
on your account, even though its role changed. For S02 and E02, use a
linked recipient where available; otherwise the record must show that no
Telegram recipient is linked.

## Correct results

| **Measure**                  | **Project A** | **Project B** | **Company** |
|------------------------------|---------------|---------------|-------------|
| Approved income              | €1,000        | €2,000        | €3,000      |
| Commission expense           | €100          | €200          | €300        |
| Allocated project expenses   | €200          | €0            | €200        |
| Company overhead             | —             | —             | €100        |
| Expenses awaiting allocation | —             | —             | €0          |
| Result                       | €700          | €1,800        | €2,400      |

**Commission earned: Richard €90; Anastasia €110; Jean-Claude €100.
Total €300.**

Check the actual Sheets records, including the corrected split and
allocation. Refresh the website and confirm the data persists. Fix
problems before continuing.

# 5 Test 2 Add transactions and decisions

Keep all Test 1 records. Add the following entries through the website
using the appropriate demonstration roles. Splits remain Richard /
Anastasia / Jean-Claude.

## Sales

<table>
<colgroup>
<col style="width: 5%" />
<col style="width: 19%" />
<col style="width: 33%" />
<col style="width: 7%" />
<col style="width: 11%" />
<col style="width: 22%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Ref</strong></th>
<th><strong>Salesperson and customer</strong></th>
<th><strong>Description</strong></th>
<th><strong>Project</strong></th>
<th><strong>Amount</strong></th>
<th><strong>Proposed split</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>S03</td>
<td>Jean-Claude<br />
Emma Stonebridge</td>
<td>Premium relatives, including an uncle presented as a surgeon</td>
<td>A</td>
<td>€1,500</td>
<td>40 / 40 / 20%</td>
</tr>
<tr class="even">
<td>S04</td>
<td>Richard<br />
Lucas Green</td>
<td>Small group of loud university friends</td>
<td>B</td>
<td>€800</td>
<td>25 / 25 / 50%</td>
</tr>
<tr class="odd">
<td>S05</td>
<td>Richard<br />
Mia Brooks</td>
<td>Extra guests and an embarrassing speech</td>
<td>B</td>
<td>€600</td>
<td>100 / 0 / 0%</td>
</tr>
</tbody>
</table>

## Expenses submitted by Kevin

| **Ref** | **Description**                                                         | **Category** | **Amount** | **Proposed allocation** |
|---------|-------------------------------------------------------------------------|--------------|------------|-------------------------|
| E04     | Replacement costumes after an enthusiastic dance performance            | Materials    | €250       | B                       |
| E05     | Minibus for university friends; Kevin selected the wrong project again  | Travel       | €90        | A                       |
| E06     | Company telephone subscription                                          | Other        | €60        | Company overhead        |
| E07     | Emergency replacement clothing; project allocation still needs checking | Materials    | €140       | A                       |

## Manager actions

| **Ref** | **Svetlana’s action**                              |
|---------|----------------------------------------------------|
| S03     | Change the split to 20% / 30% / 50%, then approve. |
| S04     | Approve the proposed split.                        |
| S05     | Leave pending.                                     |
| E04     | Approve allocation to B.                           |
| E05     | Change allocation from A to B, then approve.       |
| E07     | Leave awaiting allocation.                         |

## Check changed decision notifications

Before these manager actions, link Jean-Claude to your Telegram account
to receive the S03 changed-split notification. Link Kevin before
approving E04 and E05 so you can also check the expense notifications.
Previously submitted bot transactions must keep their original
notification destinations.

S03 must report a final €150 pool: Richard €30, Anastasia €45,
Jean-Claude €75, and show that the split changed. E05 must report €90
moved from A to B. S05 and E07 are still pending, so no approval
notification is sent for either.

# 6 Check Test 2 results and permissions

## Correct cumulative results after both tests

| **Measure**                  | **Project A** | **Project B** | **Company** |
|------------------------------|---------------|---------------|-------------|
| Approved income              | €2,500        | €2,800        | €5,300      |
| Commission expense           | €250          | €280          | €530        |
| Allocated project expenses   | €200          | €340          | €540        |
| Company overhead             | —             | —             | €160        |
| Expenses awaiting allocation | —             | —             | €140        |
| Result                       | €2,050        | €2,180        | €3,930      |

| **Salesperson** | **Cumulative commission earned** |
|-----------------|----------------------------------|
| Richard         | €140                             |
| Anastasia       | €175                             |
| Jean-Claude     | €215                             |
| Total           | €530                             |

S05 remains €600 pending sales, excluded from income and commissions.
E07 remains €140 awaiting allocation, already included in company
expenses.

**Reconciliation: €2,050 + €2,180 − €160 overhead − €140 awaiting
allocation = €3,930.**

## Check rule enforcement

| **Attempt**                                             | **Required behaviour**                     |
|---------------------------------------------------------|--------------------------------------------|
| Submit a split of 60% / 30% / 20%.                      | Refuse submission until shares total 100%. |
| Approve a sale while acting as Richard.                 | Deny approval.                             |
| Submit a sale while acting as Kevin.                    | Deny submission.                           |
| Submit an expense with a missing amount or zero amount. | Refuse submission.                         |
| Approve an already approved transaction again.          | Do not change totals or duplicate records. |
| Submit another transaction with an existing reference.  | Refuse the duplicate.                      |

These attempts must leave the control totals unchanged. Ask Codex to
verify denied actions at the processing layer as well as through the
interface.

## Check integration behaviour

Use Codex to help test an interrupted Sheets update. The transaction
must remain saved, the interface must report incomplete synchronization,
and retry must restore the same row without changing financial totals.
Also check that a failed Telegram notification is not reported as sent.

Submit the system showing the completed two-test results. Your
instructor may then enter additional transactions with different
amounts. Those transactions should legitimately change the results; do
not hard-code answers or automatically reset totals to the supplied
figures.

# 7 Submit one link

Save your project code in GitHub and connect the repository to Vercel to
publish the application. Submit one working Vercel URL in your own row
of the course spreadsheet, in the column designated for this Day 4
homework. Do not change anyone else’s name, link, or feedback.

[Open the course submission
spreadsheet](https://docs.google.com/spreadsheets/d/1AZ__P96ArJzLLTs6kGVPPIDS8229bhYcKgGu6I8O7wk/edit?usp=sharing)

https://docs.google.com/spreadsheets/d/1AZ\_\_P96ArJzLLTs6kGVPPIDS8229bhYcKgGu6I8O7wk/edit?usp=sharing

## Your Vercel page must include

- Your name and the working application with the completed two-test
  results.

- The demonstration role selector, transaction forms, manager controls,
  and financial dashboard.

- A Telegram bot link, a Google Sheets link the instructor can view, and
  a GitHub repository link accessible to the instructor.

- Brief instructions explaining where to enter transactions and approve
  decisions.

Your instructor may use AI to inspect records and enter additional
transactions through the website. Website tests must use the same
business logic as Telegram. A website simulation alone is insufficient:
S01 and E01 must have passed through the actual bot, including return
notifications.

No separate report, presentation, or assessment application is required.
Keep bot tokens, passwords, and private API keys out of the website,
spreadsheet, and GitHub repository.

## Technical appendix Google Sheets connection

Use the Google Sheets API with a Google service account. This is an
account for your application to write to your spreadsheet. Ask Codex to
guide you through setup and implementation.

1.  Create a Google Cloud project and enable the Google Sheets API.
    Create a service account and its credentials.

2.  Create your Sales and Expenses spreadsheet. Share it with the
    service account’s email address as Editor.

3.  Store credentials in server-side Vercel environment variables. Give
    the application the spreadsheet ID.

4.  Have the backend insert or update rows by transaction reference. Do
    not append a second row when approving or retrying.

5.  Give the instructor Viewer access to the spreadsheet. Do not give
    public editing access.

If your institution blocks service-account creation or key downloads,
ask Codex to identify the exact restriction and contact the instructor.
Do not replace the integration with manual copying.

[Google guidance on service accounts and file
access](https://developers.google.com/workspace/guides/create-credentials)

[Google Sheets guidance on reading and writing
values](https://developers.google.com/workspace/sheets/api/guides/values)

## Technical appendix Telegram notifications

Start your bot in a private chat before testing. Ask Codex to save the
submission’s chat ID and use Telegram sendMessage for confirmations and
manager decisions. Record notification delivery separately from
financial approval so a delivery failure does not undo the approved
transaction.

[Telegram Bot API
documentation](https://core.telegram.org/bots/api#sendmessage)
