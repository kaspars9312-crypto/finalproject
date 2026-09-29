-- Block F. No business-operation replacement, browser grants or network calls.
BEGIN;

ALTER TABLE public.transactions
    ADD COLUMN sheet_synced_revision integer,
    ADD COLUMN sheet_sync_token uuid,
    ADD CONSTRAINT transactions_sheet_revision_check CHECK (
        sheet_synced_revision IS NULL OR sheet_synced_revision BETWEEN 1 AND revision
    );

-- Explicit projection: no chats, original JSON, tokens or private audit metadata.
-- Cast before JSON serialization, never after parsing into JavaScript numbers.
CREATE FUNCTION public.sheet_transaction_snapshot(p_row public.transactions)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
    SELECT jsonb_build_object(
        'id', p_row.id, 'reference', p_row.reference,
        'transaction_type', p_row.transaction_type, 'revision', p_row.revision,
        'submitter_employee_id', p_row.submitter_employee_id,
        'submitter_name', e.display_name, 'submitted_at', p_row.submitted_at,
        'customer', p_row.customer, 'project', p_row.project,
        'description', p_row.description, 'amount_cents', p_row.amount_cents::text,
        'proposed_richard_pct', p_row.proposed_richard_pct::text,
        'proposed_anastasia_pct', p_row.proposed_anastasia_pct::text,
        'proposed_jean_claude_pct', p_row.proposed_jean_claude_pct::text,
        'final_richard_pct', p_row.final_richard_pct::text,
        'final_anastasia_pct', p_row.final_anastasia_pct::text,
        'final_jean_claude_pct', p_row.final_jean_claude_pct::text,
        'richard_commission_cents', p_row.richard_commission_cents::text,
        'anastasia_commission_cents', p_row.anastasia_commission_cents::text,
        'jean_claude_commission_cents', p_row.jean_claude_commission_cents::text,
        'expense_category', p_row.expense_category,
        'proposed_allocation', p_row.proposed_allocation, 'final_allocation', p_row.final_allocation,
        'status', p_row.status, 'sheet_sync_status', p_row.sheet_sync_status,
        'sheet_synced_revision', p_row.sheet_synced_revision,
        'sheet_last_error', CASE WHEN p_row.sheet_last_error IS NOT NULL THEN 'Sheets sync failed. Retry to synchronize the saved transaction.' END
    ) FROM public.employees e WHERE e.id = p_row.submitter_employee_id;
$$;

CREATE FUNCTION public.read_visible_transactions(p_actor_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE actor public.employees%ROWTYPE; rows jsonb;
BEGIN
    SELECT * INTO actor FROM public.employees WHERE id = p_actor_employee_id AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BF001', MESSAGE='Active employee required'; END IF;
    SELECT coalesce(jsonb_agg(public.sheet_transaction_snapshot(t) ORDER BY t.submitted_at DESC, t.id),'[]')
        INTO rows FROM public.transactions t
        WHERE actor.role = 'MANAGER' OR t.submitter_employee_id = actor.id;
    RETURN jsonb_build_object('actor', jsonb_build_object('id',actor.id,'code',actor.code,
        'display_name',actor.display_name,'role',actor.role,'active',actor.active), 'transactions', rows);
END;
$$;

-- A durable ownership token serializes writers across stateless RPC requests.
-- Never expires automatically: a paused writer must not overlap a replacement.
-- Frozen Block D clears started_at on business changes, but never this token.
CREATE FUNCTION public.begin_sheet_sync(p_transaction_id uuid, p_actor_employee_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE t public.transactions%ROWTYPE; token uuid;
BEGIN
    -- NULL is trusted post-commit orchestration, never accepted by the retry action.
    IF p_actor_employee_id IS NOT NULL THEN
        PERFORM 1 FROM public.employees WHERE id=p_actor_employee_id AND active AND role='MANAGER' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BF001', MESSAGE='Manager required'; END IF;
    END IF;
    SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BF002', MESSAGE='Transaction not found'; END IF;
    IF t.sheet_sync_token IS NOT NULL THEN RETURN jsonb_build_object('outcome','BUSY'); END IF;
    IF t.sheet_sync_status='SYNCED' AND t.sheet_synced_revision=t.revision THEN
        RETURN jsonb_build_object('outcome','SYNCED');
    END IF;
    token := gen_random_uuid();
    UPDATE public.transactions SET sheet_sync_status='PENDING', sheet_last_error=NULL,
        sheet_sync_started_at=clock_timestamp(), sheet_sync_token=token
        WHERE id=p_transaction_id RETURNING * INTO t;
    RETURN jsonb_build_object('outcome','STARTED','token',token,'transaction',public.sheet_transaction_snapshot(t));
END;
$$;

CREATE FUNCTION public.finish_sheet_sync(p_transaction_id uuid, p_token uuid,
    p_written_revision integer, p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
    IF p_written_revision IS NULL OR p_written_revision < 1 OR p_outcome IS NULL
        OR p_outcome NOT IN ('SUCCESS','FAILED','PENDING') THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid sync outcome';
    END IF;
    SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BF002', MESSAGE='Transaction not found'; END IF;
    IF p_token IS NULL OR t.sheet_sync_token IS DISTINCT FROM p_token THEN
        RAISE EXCEPTION USING ERRCODE='BF003', MESSAGE='Sync ownership lost';
    END IF;
    IF p_outcome='SUCCESS' AND t.revision <> p_written_revision THEN
        UPDATE public.transactions SET sheet_sync_status='PENDING', sheet_last_error=NULL,
            sheet_sync_started_at=clock_timestamp() WHERE id=p_transaction_id RETURNING * INTO t;
        -- Retain ownership while the same writer immediately sends the newest state.
        RETURN jsonb_build_object('outcome','STALE','transaction',public.sheet_transaction_snapshot(t));
    END IF;
    UPDATE public.transactions SET
        sheet_sync_status=CASE p_outcome WHEN 'SUCCESS' THEN 'SYNCED' WHEN 'FAILED' THEN 'FAILED' ELSE 'PENDING' END,
        sheet_synced_revision=CASE WHEN p_outcome='SUCCESS' THEN p_written_revision ELSE sheet_synced_revision END,
        sheet_last_error=CASE WHEN p_outcome='FAILED' THEN 'Sheets sync failed. Retry to synchronize the saved transaction.' END,
        sheet_sync_token=NULL, sheet_sync_started_at=NULL
        WHERE id=p_transaction_id RETURNING * INTO t;
    RETURN jsonb_build_object('outcome',t.sheet_sync_status);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sheet_transaction_snapshot(public.transactions),
    public.read_visible_transactions(uuid), public.begin_sheet_sync(uuid,uuid),
    public.finish_sheet_sync(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sheet_transaction_snapshot(public.transactions),
    public.read_visible_transactions(uuid), public.begin_sheet_sync(uuid,uuid),
    public.finish_sheet_sync(uuid,uuid,integer,text) TO service_role;
COMMIT;
