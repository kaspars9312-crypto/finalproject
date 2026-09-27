# Codex Block A — Project Foundation

You are implementing ONLY Block A of the Friends Included / Wedding Guests for Hire project.

## Source hierarchy

Read these files completely before making changes:

1. `docs/ORIGINAL_ASSIGNMENT.md` — authoritative source. If anything conflicts with it, this file wins.
2. `docs/PROJECT_SPEC.md` — frozen implementation architecture after three independent audits.

Do not reinterpret or expand the assignment. Do not implement later blocks early.

## First action: inspect, then plan

Before changing any file:

1. Inspect the complete repository.
2. Determine whether a Next.js/TypeScript project already exists.
3. Identify the current package manager and existing conventions if any.
4. Report any conflict between the repository and the two source documents.
5. If a conflict would affect this block, STOP and explain it instead of silently choosing a different design.

If the repository is empty, create the minimum clean foundation described below.
If it already contains a compatible foundation, preserve it and make only the minimum changes necessary.

## Scope of Block A

Create ONLY the technical project foundation needed for later blocks.

Required outcome:

- Next.js application using TypeScript and the App Router.
- Project can run locally and build successfully for Vercel.
- Clear server/client boundary for Supabase access.
- Supabase dependency installed and server-side client scaffolding prepared.
- Environment-variable contract documented without real secrets.
- Repository hygiene and basic developer scripts are in place.
- A minimal landing page proves the app runs, but contains NO simulated business functionality.
- Source documents remain in `docs/` and are not rewritten by Codex.

## Required implementation details

### 1. Next.js / TypeScript

Use a standard, minimal Next.js + TypeScript application.

Prefer existing repo conventions if already initialized.
If initializing from scratch, use the App Router and a `src/` layout.
Do not add a UI framework or component library unless already present.
Do not add Redux, Zustand, Prisma, Redis, Docker, authentication libraries, queues, workers, or other infrastructure.

### 2. Supabase boundary

Install the official Supabase JavaScript client package if it is not already present.

Create a clearly server-only Supabase module for privileged application access.

Requirements:

- privileged Supabase credentials must never be imported into client components;
- no `NEXT_PUBLIC_*` service-role/private secret;
- server-only modules must be clearly separated from browser code;
- do NOT create database tables or migrations in Block A;
- do NOT implement RLS policies yet;
- do NOT implement business transactions yet.

Use placeholders only through environment variables.

### 3. Environment contract

Create `.env.example` containing variable NAMES only, never real values.

At minimum reserve names for the server-side Supabase connection required by later blocks.
Use sensible names and document them in README.

Do not invent Telegram or Google credentials in source code. It is acceptable to list future variable names in `.env.example` only if clearly marked as not used in Block A.

Ensure actual `.env*` secret files are gitignored while `.env.example` remains trackable.

### 4. Minimal application page

Create a simple landing page that shows only something equivalent to:

- Friends Included / Wedding Guests for Hire
- Foundation ready
- No production/business data yet

Do NOT create fake dashboard totals, fake transactions, role selectors, approval buttons, Telegram simulation, or Google Sheets simulation.

### 5. Repository structure

Keep the structure simple and future-friendly. A reasonable target is conceptually:

- `src/app/`
- `src/lib/`
- `src/lib/supabase/`
- `docs/`

Do not create empty speculative directories for every future feature.

### 6. Developer quality gates

Ensure the project has working commands for:

- development;
- production build;
- TypeScript typecheck;
- linting if the chosen/current Next.js setup supports it.

Do not add a large test framework merely for Block A unless one already exists.

Run the applicable checks before finishing.

### 7. README

Add/update a concise README that explains:

- what this project is;
- authoritative spec files in `docs/`;
- local install/run commands;
- environment setup from `.env.example`;
- that Block A intentionally contains no business functionality;
- next planned block is the Supabase schema/database contract.

## Explicit non-goals — DO NOT IMPLEMENT YET

Do NOT implement any of the following in Block A:

- Supabase schema/tables/migrations;
- seeded employees;
- sales or expense logic;
- commission calculation;
- financial dashboard;
- Telegram bot/webhook/session flow;
- Telegram manager linking;
- Google Sheets API integration;
- manager approval/allocation UI;
- Demonstration role selector;
- Test 1/Test 2 fixture data;
- retry logic;
- business permissions;
- hard-coded assignment totals.

If you notice something from a later block that would be useful, mention it in the final report but do not implement it.

## Security constraints

- Never commit real tokens, passwords, service-role keys, Google credentials, or Telegram bot tokens.
- Never expose privileged Supabase credentials to browser code.
- Do not use `NEXT_PUBLIC_*` for any private credential.
- Do not modify or delete the source documents in `docs/`.

## Acceptance criteria

Block A passes only if all of these are true:

1. Project starts as a Next.js + TypeScript application.
2. Production build succeeds.
3. Typecheck succeeds.
4. Lint succeeds if configured/applicable.
5. Minimal landing page renders.
6. Supabase package/server-only boundary is present but no DB schema/business feature exists yet.
7. `.env.example` contains no secrets.
8. Secret env files are ignored.
9. `docs/ORIGINAL_ASSIGNMENT.md` and `docs/PROJECT_SPEC.md` remain present and unchanged.
10. No later-block business functionality was implemented.

## Required final response

When finished, do NOT continue to Block B.

Report exactly:

1. Repository state found before changes.
2. Files created/modified.
3. Dependencies added/removed.
4. Commands executed.
5. Results of build/typecheck/lint.
6. Any warnings or unresolved issues.
7. Explicit statement whether all Block A acceptance criteria pass.
8. `BLOCK A READY FOR REVIEW` or `BLOCK A NOT READY`.
