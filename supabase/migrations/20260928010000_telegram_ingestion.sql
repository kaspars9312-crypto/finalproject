-- Block E only. Four service-only RPCs; no schema changes or external calls.
BEGIN;

-- Exact string IDs and timestamp; the complete snapshot is a compare-and-set token.
CREATE FUNCTION public.telegram_read_session(p_user_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog AS $$
    SELECT to_jsonb(s) || jsonb_build_object('telegram_user_id', s.telegram_user_id::text,
        'chat_id', s.chat_id::text) FROM public.telegram_sessions s WHERE telegram_user_id = p_user_id;
$$;

CREATE FUNCTION public.telegram_apply_update(
    p_update_id bigint, p_user_id bigint, p_chat_id bigint, p_command text,
    p_expected_session jsonb DEFAULT NULL, p_value text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    v_employee public.employees%ROWTYPE;
    v_link public.telegram_links%ROWTYPE;
    v_session public.telegram_sessions%ROWTYPE;
    v_row public.transactions%ROWTYPE;
    v_draft jsonb;
    v_steps text[];
    v_index integer;
    v_next text;
    v_constraint text;
    v_overhead boolean;
BEGIN
    IF p_update_id IS NULL OR p_update_id < 0 OR p_user_id IS NULL OR p_user_id <= 0
        OR p_chat_id IS NULL OR p_chat_id = 0 OR p_command IS NULL
        OR p_command NOT IN ('START','CANCEL','SALE','EXPENSE','ANSWER','HELP') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid Telegram envelope';
    END IF;
    -- Small five-employee demo: serialize Telegram mutations/remaps, including
    -- absent links. No network is performed while holding this transaction lock.
    PERFORM pg_advisory_xact_lock(20260928, 5);
    INSERT INTO public.telegram_updates(update_id) VALUES(p_update_id) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome','DUPLICATE'); END IF;

    IF p_command = 'CANCEL' THEN
        DELETE FROM public.telegram_sessions WHERE telegram_user_id = p_user_id;
        RETURN jsonb_build_object('outcome','CANCELLED');
    END IF;
    IF p_command = 'HELP' THEN RETURN jsonb_build_object('outcome','HELP'); END IF;
    IF p_command = 'START' THEN
        INSERT INTO public.telegram_links(telegram_user_id,last_private_chat_id)
        VALUES(p_user_id,p_chat_id) ON CONFLICT(telegram_user_id) DO UPDATE
            SET last_private_chat_id = EXCLUDED.last_private_chat_id, updated_at = clock_timestamp();
    END IF;
    SELECT * INTO v_link FROM public.telegram_links WHERE telegram_user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_employee FROM public.employees WHERE id = v_link.employee_id AND active FOR SHARE;
    IF p_command = 'START' THEN
        RETURN jsonb_build_object('outcome','START','employee_name',v_employee.display_name,'role',v_employee.role);
    END IF;

    IF p_command IN ('SALE','EXPENSE') THEN
        IF v_employee.id IS NULL THEN RETURN jsonb_build_object('outcome','UNLINKED'); END IF;
        IF v_employee.role <> (CASE p_command WHEN 'SALE' THEN 'SALESPERSON' ELSE 'EXPENSE_REPORTER' END) THEN
            RETURN jsonb_build_object('outcome','FORBIDDEN');
        END IF;
        INSERT INTO public.telegram_sessions(telegram_user_id,chat_id,employee_id_at_start,flow_type,step,draft_payload,updated_at)
        VALUES(p_user_id,p_chat_id,v_employee.id,p_command,'reference','{}',clock_timestamp())
        ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id,
            employee_id_at_start = EXCLUDED.employee_id_at_start, flow_type = EXCLUDED.flow_type,
            step = 'reference', draft_payload = '{}', updated_at = EXCLUDED.updated_at;
        RETURN jsonb_build_object('outcome','PROMPT','step','reference');
    END IF;

    SELECT * INTO v_session FROM public.telegram_sessions WHERE telegram_user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome',CASE WHEN p_expected_session IS NOT NULL THEN 'STALE_SESSION'
            WHEN v_employee.id IS NULL THEN 'UNLINKED' ELSE 'NO_SESSION' END);
    END IF;
    IF v_employee.id IS DISTINCT FROM v_session.employee_id_at_start OR v_employee.role IS DISTINCT FROM
        (CASE v_session.flow_type WHEN 'SALE' THEN 'SALESPERSON' ELSE 'EXPENSE_REPORTER' END) THEN
        DELETE FROM public.telegram_sessions WHERE telegram_user_id = p_user_id;
        RETURN jsonb_build_object('outcome','STALE_SESSION');
    END IF;
    IF v_session.chat_id <> p_chat_id THEN RETURN jsonb_build_object('outcome','WRONG_CHAT'); END IF;
    IF public.telegram_read_session(p_user_id) IS DISTINCT FROM p_expected_session THEN
        -- Do not reinterpret an answer against a newer step or replacement wizard.
        RETURN jsonb_build_object('outcome','SESSION_CHANGED');
    END IF;
    IF p_value IS NULL THEN RETURN jsonb_build_object('outcome','INVALID'); END IF;
    v_steps := CASE v_session.flow_type WHEN 'SALE' THEN ARRAY['reference','customer','project','description',
        'amount_cents','proposed_richard_pct','proposed_anastasia_pct','proposed_jean_claude_pct']
        ELSE ARRAY['reference','description','amount_cents','expense_category','proposed_allocation'] END;
    v_index := array_position(v_steps,v_session.step);
    IF v_index IS NULL THEN RETURN jsonb_build_object('outcome','STALE_SESSION'); END IF;
    -- Defensive validation of normalized server values, even for direct RPC calls.
    IF p_value !~ '[^[:space:]]' OR p_value ~ '(^[[:space:]]|[[:space:]]$)' THEN
        RETURN jsonb_build_object('outcome','INVALID');
    END IF;
    IF v_session.step = 'project' AND p_value NOT IN ('A','B') OR
        v_session.step = 'expense_category' AND p_value NOT IN ('MATERIALS','TRAVEL','OTHER') OR
        v_session.step = 'proposed_allocation' AND p_value NOT IN ('A','B','COMPANY_OVERHEAD') THEN
        RETURN jsonb_build_object('outcome','INVALID');
    END IF;
    IF v_session.step = 'amount_cents' THEN
        IF p_value !~ '^[0-9]+$' THEN RETURN jsonb_build_object('outcome','INVALID'); END IF;
        IF p_value::numeric NOT BETWEEN 1 AND 9007199254740991 THEN RETURN jsonb_build_object('outcome','INVALID'); END IF;
    END IF;
    IF v_session.step LIKE '%pct' THEN
        IF p_value !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' THEN RETURN jsonb_build_object('outcome','INVALID'); END IF;
        IF p_value::numeric NOT BETWEEN 0 AND 100 THEN RETURN jsonb_build_object('outcome','INVALID'); END IF;
    END IF;
    v_draft := v_session.draft_payload || jsonb_build_object(v_session.step,p_value);
    v_next := v_steps[v_index + 1];
    IF v_next IS NOT NULL THEN
        UPDATE public.telegram_sessions SET step = v_next, draft_payload = v_draft, updated_at = clock_timestamp()
            WHERE telegram_user_id = p_user_id;
        RETURN jsonb_build_object('outcome','PROMPT','step',v_next);
    END IF;

    -- This subtransaction rolls back only a failed insert, keeping the durable
    -- update claim and the unchanged wizard on a deterministic rejection.
    BEGIN
        IF (v_draft->>'amount_cents')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid persisted amount';
        END IF;
        IF v_session.flow_type = 'SALE' THEN
            INSERT INTO public.transactions(reference,transaction_type,source,submitter_employee_id,
                origin_telegram_chat_id,status,description,amount_cents,customer,project,
                proposed_richard_pct,proposed_anastasia_pct,proposed_jean_claude_pct,
                commission_pool_cents,richard_commission_cents,anastasia_commission_cents,jean_claude_commission_cents,
                original_submission,submission_confirmation_status,submission_target_chat_id)
            VALUES(v_draft->>'reference','SALE','TELEGRAM',v_session.employee_id_at_start,v_session.chat_id,
                'PENDING_APPROVAL',v_draft->>'description',(v_draft->>'amount_cents')::bigint,
                v_draft->>'customer',v_draft->>'project',(v_draft->>'proposed_richard_pct')::numeric,
                (v_draft->>'proposed_anastasia_pct')::numeric,(v_draft->>'proposed_jean_claude_pct')::numeric,
                0,0,0,0,jsonb_build_object('reference',v_draft->>'reference','customer',v_draft->>'customer',
                    'project',v_draft->>'project','description',v_draft->>'description','amount_cents',v_draft->>'amount_cents',
                    'proposed_richard_pct',v_draft->>'proposed_richard_pct','proposed_anastasia_pct',v_draft->>'proposed_anastasia_pct',
                    'proposed_jean_claude_pct',v_draft->>'proposed_jean_claude_pct'),'PENDING',v_session.chat_id)
            RETURNING * INTO v_row;
        ELSE
            v_overhead := v_draft->>'proposed_allocation' = 'COMPANY_OVERHEAD';
            INSERT INTO public.transactions(reference,transaction_type,source,submitter_employee_id,
                origin_telegram_chat_id,status,description,amount_cents,expense_category,proposed_allocation,
                final_allocation,allocated_at,original_submission,submission_confirmation_status,submission_target_chat_id)
            VALUES(v_draft->>'reference','EXPENSE','TELEGRAM',v_session.employee_id_at_start,v_session.chat_id,
                CASE WHEN v_overhead THEN 'ALLOCATED' ELSE 'AWAITING_ALLOCATION' END,
                v_draft->>'description',(v_draft->>'amount_cents')::bigint,v_draft->>'expense_category',v_draft->>'proposed_allocation',
                CASE WHEN v_overhead THEN 'COMPANY_OVERHEAD' END,CASE WHEN v_overhead THEN now() END,
                jsonb_build_object('reference',v_draft->>'reference','description',v_draft->>'description',
                    'amount_cents',v_draft->>'amount_cents','expense_category',v_draft->>'expense_category',
                    'proposed_allocation',v_draft->>'proposed_allocation'),'PENDING',v_session.chat_id)
            RETURNING * INTO v_row;
        END IF;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'transactions_reference_key' THEN RETURN jsonb_build_object('outcome','DUPLICATE_REFERENCE'); END IF;
        RAISE;
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('outcome','INVALID');
    END;
    DELETE FROM public.telegram_sessions WHERE telegram_user_id = p_user_id;
    RETURN jsonb_build_object('outcome','SAVED','transaction',jsonb_build_object(
        'id',v_row.id,'reference',v_row.reference,'amount_cents',v_row.amount_cents::text,
        'transaction_type',v_row.transaction_type,'status',v_row.status,
        'destination',coalesce(v_row.project,v_row.proposed_allocation),'target_chat_id',v_row.submission_target_chat_id::text));
END;
$$;

CREATE FUNCTION public.telegram_set_link(p_actor_employee_id uuid,p_user_id bigint,p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(20260928, 5);
    PERFORM 1 FROM public.employees WHERE id = p_actor_employee_id AND active AND role = 'MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BE001', MESSAGE = 'Manager required'; END IF;
    PERFORM 1 FROM public.employees WHERE id = p_employee_id AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BE002', MESSAGE = 'Employee not found'; END IF;
    PERFORM 1 FROM public.telegram_links WHERE telegram_user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'BE002', MESSAGE = 'Start bot first'; END IF;
    -- Clear only sessions whose mapping changes. Historical rows are never touched.
    DELETE FROM public.telegram_sessions WHERE telegram_user_id IN (
        SELECT telegram_user_id FROM public.telegram_links WHERE
            (telegram_user_id = p_user_id AND employee_id IS DISTINCT FROM p_employee_id)
            OR (telegram_user_id <> p_user_id AND employee_id = p_employee_id));
    UPDATE public.telegram_links SET employee_id = NULL, updated_at = clock_timestamp()
        WHERE employee_id = p_employee_id AND telegram_user_id <> p_user_id;
    UPDATE public.telegram_links SET employee_id = p_employee_id, updated_at = clock_timestamp()
        WHERE telegram_user_id = p_user_id AND employee_id IS DISTINCT FROM p_employee_id;
END;
$$;

CREATE FUNCTION public.telegram_mark_confirmation(p_transaction_id uuid,p_sent boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
    IF p_sent IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Outcome required'; END IF;
    UPDATE public.transactions SET submission_confirmation_status = CASE WHEN p_sent THEN 'SENT' ELSE 'FAILED' END,
        submission_sent_at = CASE WHEN p_sent THEN clock_timestamp() END,
        submission_last_error = CASE WHEN NOT p_sent THEN 'Telegram delivery failed.' END
    WHERE id = p_transaction_id AND source = 'TELEGRAM' AND submission_confirmation_status = 'PENDING';
    -- No business revision or decision-delivery field is modified.
END;
$$;

REVOKE EXECUTE ON FUNCTION public.telegram_read_session(bigint) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.telegram_apply_update(bigint,bigint,bigint,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.telegram_set_link(uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.telegram_mark_confirmation(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_read_session(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.telegram_apply_update(bigint,bigint,bigint,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.telegram_set_link(uuid,bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.telegram_mark_confirmation(uuid,boolean) TO service_role;
COMMIT;
