-- Block D: server-only business operations. No external delivery occurs here.
-- SQLSTATE: BD001 forbidden, BD002 not found, BD003 stale/finalized,
-- BD004 wrong transaction type, BD005 duplicate reference; 22023 invalid input.
-- All functions are SECURITY INVOKER with qualified application relations.
BEGIN;

CREATE FUNCTION public.create_website_sale(
    p_actor_employee_id uuid, p_reference text, p_customer text, p_project text,
    p_description text, p_amount_cents bigint,
    p_richard_pct numeric, p_anastasia_pct numeric, p_jean_claude_pct numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    v_row public.transactions%ROWTYPE;
    v_constraint text;
BEGIN
    -- Lock the actor through commit, so role/deactivation changes cannot race us.
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'SALESPERSON' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;

    INSERT INTO public.transactions (
        reference, transaction_type, source, submitter_employee_id, status,
        customer, project, description, amount_cents, original_submission,
        proposed_richard_pct, proposed_anastasia_pct, proposed_jean_claude_pct,
        commission_pool_cents, richard_commission_cents, anastasia_commission_cents,
        jean_claude_commission_cents, submission_confirmation_status
    ) VALUES (
        p_reference, 'SALE', 'WEBSITE', p_actor_employee_id, 'PENDING_APPROVAL',
        p_customer, p_project, p_description, p_amount_cents,
        jsonb_build_object('reference', p_reference, 'customer', p_customer,
            'project', p_project, 'description', p_description,
            'amount_cents', p_amount_cents::text,
            'proposed_richard_pct', p_richard_pct::text,
            'proposed_anastasia_pct', p_anastasia_pct::text,
            'proposed_jean_claude_pct', p_jean_claude_pct::text),
        p_richard_pct, p_anastasia_pct, p_jean_claude_pct, 0, 0, 0, 0, 'NOT_REQUIRED'
    ) RETURNING * INTO v_row;
    RETURN jsonb_build_object('id', v_row.id, 'reference', v_row.reference,
        'status', v_row.status, 'revision', v_row.revision);
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'transactions_reference_key' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD005', MESSAGE = 'Duplicate reference';
    END IF;
    RAISE;
END;
$$;

CREATE FUNCTION public.create_website_expense(
    p_actor_employee_id uuid, p_reference text, p_description text,
    p_amount_cents bigint, p_category text, p_proposed_allocation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    v_row public.transactions%ROWTYPE;
    v_constraint text;
    v_overhead boolean := p_proposed_allocation = 'COMPANY_OVERHEAD';
BEGIN
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'EXPENSE_REPORTER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;

    INSERT INTO public.transactions (
        reference, transaction_type, source, submitter_employee_id, status,
        description, amount_cents, expense_category, proposed_allocation,
        final_allocation, allocated_at, original_submission, submission_confirmation_status
    ) VALUES (
        p_reference, 'EXPENSE', 'WEBSITE', p_actor_employee_id,
        CASE WHEN v_overhead THEN 'ALLOCATED' ELSE 'AWAITING_ALLOCATION' END,
        p_description, p_amount_cents, p_category, p_proposed_allocation,
        CASE WHEN v_overhead THEN 'COMPANY_OVERHEAD' END,
        CASE WHEN v_overhead THEN now() END,
        jsonb_build_object('reference', p_reference, 'description', p_description,
            'amount_cents', p_amount_cents::text, 'expense_category', p_category,
            'proposed_allocation', p_proposed_allocation), 'NOT_REQUIRED'
    ) RETURNING * INTO v_row;
    RETURN jsonb_build_object('id', v_row.id, 'reference', v_row.reference,
        'status', v_row.status, 'revision', v_row.revision);
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'transactions_reference_key' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD005', MESSAGE = 'Duplicate reference';
    END IF;
    RAISE;
END;
$$;

CREATE FUNCTION public.correct_pending_sale(
    p_actor_employee_id uuid, p_transaction_id uuid, p_expected_revision integer,
    p_customer text, p_project text, p_description text, p_amount_cents bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE v_row public.transactions%ROWTYPE;
BEGIN
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;
    IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid revision';
    END IF;
    SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD002', MESSAGE = 'Not found'; END IF;
    IF v_row.transaction_type <> 'SALE' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD004', MESSAGE = 'Sale required';
    END IF;
    IF v_row.status <> 'PENDING_APPROVAL' OR v_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized';
    END IF;
    UPDATE public.transactions SET customer = p_customer, project = p_project,
        description = p_description, amount_cents = p_amount_cents,
        revision = revision + 1, updated_at = now(),
        sheet_sync_status = 'PENDING', sheet_last_error = NULL, sheet_sync_started_at = NULL
    WHERE id = p_transaction_id AND transaction_type = 'SALE'
        AND status = 'PENDING_APPROVAL' AND revision = p_expected_revision
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized'; END IF;
    RETURN jsonb_build_object('id', v_row.id, 'reference', v_row.reference,
        'status', v_row.status, 'revision', v_row.revision);
END;
$$;

-- An exact read boundary for Block C calculation. Returning a raw NUMERIC row
-- through JSON would lose precision before JavaScript could validate it.
CREATE FUNCTION public.read_sale_for_approval(p_actor_employee_id uuid, p_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE v_row public.transactions%ROWTYPE;
BEGIN
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;
    SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD002', MESSAGE = 'Not found'; END IF;
    IF v_row.transaction_type <> 'SALE' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD004', MESSAGE = 'Sale required';
    END IF;
    RETURN jsonb_build_object('status', v_row.status, 'revision', v_row.revision,
        'amount_cents', v_row.amount_cents::text,
        'proposed_richard_pct', v_row.proposed_richard_pct::text,
        'proposed_anastasia_pct', v_row.proposed_anastasia_pct::text,
        'proposed_jean_claude_pct', v_row.proposed_jean_claude_pct::text);
END;
$$;

CREATE FUNCTION public.approve_sale(
    p_actor_employee_id uuid, p_transaction_id uuid, p_expected_revision integer,
    p_richard_pct numeric, p_anastasia_pct numeric, p_jean_claude_pct numeric,
    p_pool_cents bigint, p_richard_cents bigint, p_anastasia_cents bigint, p_jean_claude_cents bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    v_row public.transactions%ROWTYPE;
    v_chat bigint;
BEGIN
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;
    IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid revision';
    END IF;
    SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD002', MESSAGE = 'Not found'; END IF;
    IF v_row.transaction_type <> 'SALE' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD004', MESSAGE = 'Sale required';
    END IF;
    IF v_row.status <> 'PENDING_APPROVAL' OR v_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized';
    END IF;

    IF v_row.source = 'TELEGRAM' THEN
        v_chat := v_row.origin_telegram_chat_id;
    ELSE
        SELECT last_private_chat_id INTO v_chat FROM public.telegram_links
            WHERE employee_id = v_row.submitter_employee_id FOR SHARE;
    END IF;
    -- Block C supplies exact individual rounding/residual results. Frozen Block B
    -- constraints independently enforce the split, pool and sum against this row.
    UPDATE public.transactions SET status = 'APPROVED',
        final_richard_pct = p_richard_pct, final_anastasia_pct = p_anastasia_pct,
        final_jean_claude_pct = p_jean_claude_pct,
        commission_pool_cents = p_pool_cents, richard_commission_cents = p_richard_cents,
        anastasia_commission_cents = p_anastasia_cents, jean_claude_commission_cents = p_jean_claude_cents,
        approved_by_employee_id = p_actor_employee_id, approved_at = now(),
        revision = revision + 1, updated_at = now(),
        sheet_sync_status = 'PENDING', sheet_last_error = NULL, sheet_sync_started_at = NULL,
        decision_notification_status = CASE WHEN v_chat IS NULL THEN 'NO_RECIPIENT' ELSE 'PENDING' END,
        decision_target_chat_id = v_chat, decision_last_error = NULL, decision_sent_at = NULL
    WHERE id = p_transaction_id AND transaction_type = 'SALE'
        AND status = 'PENDING_APPROVAL' AND revision = p_expected_revision
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized'; END IF;
    RETURN jsonb_build_object('id', v_row.id, 'reference', v_row.reference,
        'status', v_row.status, 'revision', v_row.revision);
END;
$$;

CREATE FUNCTION public.allocate_expense(
    p_actor_employee_id uuid, p_transaction_id uuid, p_expected_revision integer, p_final_allocation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    v_row public.transactions%ROWTYPE;
    v_chat bigint;
BEGIN
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id
        AND active AND role = 'MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD001', MESSAGE = 'Forbidden'; END IF;
    IF p_expected_revision IS NULL OR p_expected_revision < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid revision';
    END IF;
    SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD002', MESSAGE = 'Not found'; END IF;
    IF v_row.transaction_type <> 'EXPENSE' THEN
        RAISE EXCEPTION USING ERRCODE = 'BD004', MESSAGE = 'Expense required';
    END IF;
    IF v_row.status <> 'AWAITING_ALLOCATION' OR v_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized';
    END IF;
    IF v_row.source = 'TELEGRAM' THEN
        v_chat := v_row.origin_telegram_chat_id;
    ELSE
        SELECT last_private_chat_id INTO v_chat FROM public.telegram_links
            WHERE employee_id = v_row.submitter_employee_id FOR SHARE;
    END IF;
    UPDATE public.transactions SET status = 'ALLOCATED', final_allocation = p_final_allocation,
        allocated_by_employee_id = p_actor_employee_id, allocated_at = now(),
        revision = revision + 1, updated_at = now(),
        sheet_sync_status = 'PENDING', sheet_last_error = NULL, sheet_sync_started_at = NULL,
        decision_notification_status = CASE WHEN v_chat IS NULL THEN 'NO_RECIPIENT' ELSE 'PENDING' END,
        decision_target_chat_id = v_chat, decision_last_error = NULL, decision_sent_at = NULL
    WHERE id = p_transaction_id AND transaction_type = 'EXPENSE'
        AND status = 'AWAITING_ALLOCATION' AND revision = p_expected_revision
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BD003', MESSAGE = 'Stale or finalized'; END IF;
    RETURN jsonb_build_object('id', v_row.id, 'reference', v_row.reference,
        'status', v_row.status, 'revision', v_row.revision);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_website_sale(uuid,text,text,text,text,bigint,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_website_expense(uuid,text,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.correct_pending_sale(uuid,uuid,integer,text,text,text,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_sale_for_approval(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_sale(uuid,uuid,integer,numeric,numeric,numeric,bigint,bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_expense(uuid,uuid,integer,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_website_sale(uuid,text,text,text,text,bigint,numeric,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_website_expense(uuid,text,text,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.correct_pending_sale(uuid,uuid,integer,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_sale_for_approval(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_sale(uuid,uuid,integer,numeric,numeric,numeric,bigint,bigint,bigint,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_expense(uuid,uuid,integer,text) TO service_role;

COMMIT;
