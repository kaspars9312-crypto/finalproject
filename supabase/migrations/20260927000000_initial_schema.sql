-- Block B only: schema, structural integrity, access defaults, employee seed.
-- Apply once using Supabase migrations, as the database migration owner.
-- The employee INSERT at the end is independently safe to rerun.
BEGIN;

CREATE TABLE public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT employees_code_check CHECK (
        code IN ('SVETLANA', 'RICHARD', 'ANASTASIA', 'JEAN_CLAUDE', 'KEVIN')
    ),
    CONSTRAINT employees_role_check CHECK (
        role IN ('MANAGER', 'SALESPERSON', 'EXPENSE_REPORTER')
    ),
    CONSTRAINT employees_display_name_check CHECK (display_name ~ '[^[:space:]]')
);

CREATE TABLE public.telegram_links (
    telegram_user_id BIGINT PRIMARY KEY,
    employee_id UUID UNIQUE REFERENCES public.employees(id),
    last_private_chat_id BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.telegram_sessions (
    telegram_user_id BIGINT PRIMARY KEY
        REFERENCES public.telegram_links(telegram_user_id) ON DELETE CASCADE,
    chat_id BIGINT NOT NULL,
    employee_id_at_start UUID NOT NULL REFERENCES public.employees(id),
    flow_type TEXT NOT NULL,
    step TEXT NOT NULL,
    draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT telegram_sessions_flow_type_check CHECK (flow_type IN ('SALE', 'EXPENSE')),
    CONSTRAINT telegram_sessions_step_check CHECK (step ~ '[^[:space:]]')
);

-- Durable update claim only. Atomic claim + mutation belongs to a later block.
CREATE TABLE public.telegram_updates (
    update_id BIGINT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference TEXT COLLATE "C" NOT NULL UNIQUE,
    transaction_type TEXT NOT NULL,
    source TEXT NOT NULL,
    submitter_employee_id UUID NOT NULL REFERENCES public.employees(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    origin_telegram_chat_id BIGINT,
    original_submission JSONB NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL,
    amount_cents BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- SALE fields: intentionally nullable at column level for EXPENSE rows.
    customer TEXT,
    project TEXT,
    proposed_richard_pct NUMERIC,
    proposed_anastasia_pct NUMERIC,
    proposed_jean_claude_pct NUMERIC,
    final_richard_pct NUMERIC,
    final_anastasia_pct NUMERIC,
    final_jean_claude_pct NUMERIC,
    commission_pool_cents BIGINT,
    richard_commission_cents BIGINT,
    anastasia_commission_cents BIGINT,
    jean_claude_commission_cents BIGINT,
    approved_by_employee_id UUID REFERENCES public.employees(id),
    approved_at TIMESTAMPTZ,

    -- EXPENSE fields: intentionally nullable at column level for SALE rows.
    expense_category TEXT,
    proposed_allocation TEXT,
    final_allocation TEXT,
    allocated_by_employee_id UUID REFERENCES public.employees(id),
    allocated_at TIMESTAMPTZ,

    -- Delivery state only; no network calls, locks or retries are implemented.
    sheet_sync_status TEXT NOT NULL DEFAULT 'PENDING',
    sheet_last_error TEXT,
    sheet_sync_started_at TIMESTAMPTZ,
    submission_confirmation_status TEXT NOT NULL,
    submission_target_chat_id BIGINT,
    submission_last_error TEXT,
    submission_sent_at TIMESTAMPTZ,
    decision_notification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    decision_target_chat_id BIGINT,
    decision_last_error TEXT,
    decision_sent_at TIMESTAMPTZ,

    CONSTRAINT transactions_reference_check CHECK (
        reference <> '' AND reference !~ '(^[[:space:]]|[[:space:]]$)'
    ),
    CONSTRAINT transactions_type_check CHECK (transaction_type IN ('SALE', 'EXPENSE')),
    CONSTRAINT transactions_source_check CHECK (source IN ('TELEGRAM', 'WEBSITE')),
    CONSTRAINT transactions_status_check CHECK (
        status IN ('PENDING_APPROVAL', 'APPROVED', 'AWAITING_ALLOCATION', 'ALLOCATED')
    ),
    CONSTRAINT transactions_revision_check CHECK (revision >= 1),
    CONSTRAINT transactions_description_check CHECK (description ~ '[^[:space:]]'),
    CONSTRAINT transactions_amount_check CHECK (amount_cents > 0),

    -- Every nullable required field has an explicit IS NOT NULL guard.
    -- This prevents SQL CHECK's UNKNOWN result from accepting missing values.
    CONSTRAINT transactions_sale_fields_check CHECK (
        transaction_type <> 'SALE' OR (
            customer IS NOT NULL AND customer ~ '[^[:space:]]'
            AND project IS NOT NULL AND project IN ('A', 'B')
            AND proposed_richard_pct IS NOT NULL
            AND proposed_anastasia_pct IS NOT NULL
            AND proposed_jean_claude_pct IS NOT NULL
            AND proposed_richard_pct BETWEEN 0 AND 100
            AND proposed_anastasia_pct BETWEEN 0 AND 100
            AND proposed_jean_claude_pct BETWEEN 0 AND 100
            AND proposed_richard_pct + proposed_anastasia_pct + proposed_jean_claude_pct = 100
            AND commission_pool_cents IS NOT NULL AND commission_pool_cents >= 0
            AND richard_commission_cents IS NOT NULL AND richard_commission_cents >= 0
            AND anastasia_commission_cents IS NOT NULL AND anastasia_commission_cents >= 0
            AND jean_claude_commission_cents IS NOT NULL AND jean_claude_commission_cents >= 0
            AND expense_category IS NULL
            AND proposed_allocation IS NULL
            AND final_allocation IS NULL
            AND allocated_by_employee_id IS NULL
            AND allocated_at IS NULL
        )
    ),
    CONSTRAINT transactions_sale_state_check CHECK (
        transaction_type <> 'SALE' OR (
            (
                status = 'PENDING_APPROVAL'
                AND final_richard_pct IS NULL
                AND final_anastasia_pct IS NULL
                AND final_jean_claude_pct IS NULL
                AND commission_pool_cents = 0
                AND richard_commission_cents = 0
                AND anastasia_commission_cents = 0
                AND jean_claude_commission_cents = 0
                AND approved_by_employee_id IS NULL
                AND approved_at IS NULL
            ) OR (
                status = 'APPROVED'
                AND final_richard_pct IS NOT NULL
                AND final_anastasia_pct IS NOT NULL
                AND final_jean_claude_pct IS NOT NULL
                AND final_richard_pct BETWEEN 0 AND 100
                AND final_anastasia_pct BETWEEN 0 AND 100
                AND final_jean_claude_pct BETWEEN 0 AND 100
                AND final_richard_pct + final_anastasia_pct + final_jean_claude_pct = 100
                -- Cast before arithmetic to avoid BIGINT overflow during validation.
                AND richard_commission_cents::numeric
                    + anastasia_commission_cents::numeric
                    + jean_claude_commission_cents::numeric = commission_pool_cents
                -- Exact 10% of cents, rounded HALF-UP for positive amounts.
                AND commission_pool_cents = round(amount_cents::numeric / 10, 0)
                AND approved_by_employee_id IS NOT NULL
                AND approved_at IS NOT NULL
            )
        )
    ),
    CONSTRAINT transactions_expense_fields_check CHECK (
        transaction_type <> 'EXPENSE' OR (
            expense_category IS NOT NULL
            AND expense_category IN ('MATERIALS', 'TRAVEL', 'OTHER')
            AND proposed_allocation IS NOT NULL
            AND proposed_allocation IN ('A', 'B', 'COMPANY_OVERHEAD')
            AND customer IS NULL
            AND project IS NULL
            AND proposed_richard_pct IS NULL
            AND proposed_anastasia_pct IS NULL
            AND proposed_jean_claude_pct IS NULL
            AND final_richard_pct IS NULL
            AND final_anastasia_pct IS NULL
            AND final_jean_claude_pct IS NULL
            AND commission_pool_cents IS NULL
            AND richard_commission_cents IS NULL
            AND anastasia_commission_cents IS NULL
            AND jean_claude_commission_cents IS NULL
            AND approved_by_employee_id IS NULL
            AND approved_at IS NULL
        )
    ),
    CONSTRAINT transactions_expense_state_check CHECK (
        transaction_type <> 'EXPENSE' OR (
            (
                status = 'AWAITING_ALLOCATION'
                AND proposed_allocation IN ('A', 'B')
                AND final_allocation IS NULL
                AND allocated_by_employee_id IS NULL
                AND allocated_at IS NULL
            ) OR (
                status = 'ALLOCATED'
                AND proposed_allocation = 'COMPANY_OVERHEAD'
                AND final_allocation IS NOT NULL
                AND final_allocation = 'COMPANY_OVERHEAD'
                AND allocated_by_employee_id IS NULL
                AND allocated_at IS NOT NULL
            ) OR (
                status = 'ALLOCATED'
                AND proposed_allocation IN ('A', 'B')
                AND final_allocation IS NOT NULL
                AND final_allocation IN ('A', 'B', 'COMPANY_OVERHEAD')
                AND allocated_by_employee_id IS NOT NULL
                AND allocated_at IS NOT NULL
            )
        )
    ),

    CONSTRAINT transactions_sheet_status_check CHECK (
        sheet_sync_status IN ('PENDING', 'SYNCED', 'FAILED')
    ),
    CONSTRAINT transactions_submission_status_check CHECK (
        submission_confirmation_status IN ('NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED')
    ),
    CONSTRAINT transactions_submission_source_check CHECK (
        (
            source = 'WEBSITE'
            AND origin_telegram_chat_id IS NULL
            AND submission_confirmation_status = 'NOT_REQUIRED'
            AND submission_target_chat_id IS NULL
        ) OR (
            source = 'TELEGRAM'
            AND origin_telegram_chat_id IS NOT NULL
            AND submission_confirmation_status IN ('PENDING', 'SENT', 'FAILED')
            AND submission_target_chat_id IS NOT NULL
        )
    ),
    CONSTRAINT transactions_decision_status_check CHECK (
        decision_notification_status IN ('NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED', 'NO_RECIPIENT')
    ),
    -- Only manager-finalized rows can carry a decision notification.
    -- Target resolution/freeze and delivery metadata lifecycle remain later work.
    CONSTRAINT transactions_decision_state_check CHECK (
        (
            (
                status IN ('PENDING_APPROVAL', 'AWAITING_ALLOCATION')
                OR (transaction_type = 'EXPENSE' AND proposed_allocation = 'COMPANY_OVERHEAD')
            )
            AND decision_notification_status = 'NOT_REQUIRED'
        ) OR (
            (
                (transaction_type = 'SALE' AND status = 'APPROVED')
                OR (
                    transaction_type = 'EXPENSE' AND status = 'ALLOCATED'
                    AND proposed_allocation IN ('A', 'B')
                )
            )
            AND decision_notification_status IN ('PENDING', 'SENT', 'FAILED', 'NO_RECIPIENT')
        )
    )
);

-- PK/UNIQUE already supply their indexes. These serve own-submission and
-- manager pending-review queries without speculative indexing.
CREATE INDEX transactions_submitter_employee_id_idx
    ON public.transactions (submitter_employee_id);
CREATE INDEX transactions_type_status_idx
    ON public.transactions (transaction_type, status);

-- Closed browser access by default; there are deliberately no public policies.
-- Supabase's existing service_role has BYPASSRLS. Do not create or alter roles.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.employees, public.telegram_links, public.telegram_sessions,
    public.telegram_updates, public.transactions
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.employees, public.telegram_links, public.telegram_sessions,
    public.telegram_updates, public.transactions
    TO service_role;

-- Stable employee identities: rerunning this INSERT preserves existing UUIDs,
-- created_at and active flags. No financial transactions are seeded.
INSERT INTO public.employees (code, display_name, role)
VALUES
    ('SVETLANA', 'Svetlana de Monte Carlo', 'MANAGER'),
    ('RICHARD', 'Richard Darling', 'SALESPERSON'),
    ('ANASTASIA', 'Anastasia Ferrari', 'SALESPERSON'),
    ('JEAN_CLAUDE', 'Jean-Claude Bērziņš', 'SALESPERSON'),
    ('KEVIN', 'Kevin von Whatever', 'EXPENSE_REPORTER')
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    role = EXCLUDED.role;

COMMIT;
