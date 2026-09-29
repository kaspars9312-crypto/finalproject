-- Block G: additive delivery ownership and authorized workflow reads only.
-- Frozen financial operations and their decision-time recipient selection stay intact.
BEGIN;

ALTER TABLE public.transactions
    ADD COLUMN decision_delivery_token uuid,
    ADD COLUMN decision_delivery_started_at timestamptz;

CREATE FUNCTION public.read_website_workflow(p_actor_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE actor public.employees%ROWTYPE; rows jsonb; links jsonb := '[]';
BEGIN
    SELECT * INTO actor FROM public.employees WHERE id=p_actor_employee_id AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BG001', MESSAGE='Active employee required'; END IF;
    SELECT coalesce(jsonb_agg(public.sheet_transaction_snapshot(t) || jsonb_build_object(
        'original_submission',t.original_submission,
        'decision_notification_status',t.decision_notification_status,
        'decision_delivery_busy',t.decision_delivery_token IS NOT NULL)
        ORDER BY t.submitted_at DESC,t.id),'[]') INTO rows FROM public.transactions t
        WHERE actor.role='MANAGER' OR t.submitter_employee_id=actor.id;
    IF actor.role='MANAGER' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('telegram_user_id',l.telegram_user_id::text,
            'employee_id',l.employee_id,'private_chat_known',l.last_private_chat_id IS NOT NULL)
            ORDER BY l.telegram_user_id),'[]') INTO links FROM public.telegram_links l;
    END IF;
    RETURN jsonb_build_object('actor',jsonb_build_object('id',actor.id,'code',actor.code,
        'display_name',actor.display_name,'role',actor.role,'active',actor.active),
        'transactions',rows,'links',links);
END;
$$;

-- Every caller supplies the active manager, including post-decision delivery.
-- No expiry: an old paused sender must not overlap a replacement sender.
CREATE FUNCTION public.begin_decision_delivery(p_actor_employee_id uuid,p_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE t public.transactions%ROWTYPE; token uuid;
BEGIN
    PERFORM 1 FROM public.employees WHERE id=p_actor_employee_id AND active AND role='MANAGER' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BG001', MESSAGE='Manager required'; END IF;
    SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BG002', MESSAGE='Transaction not found'; END IF;
    IF t.decision_notification_status IN ('NOT_REQUIRED','SENT','NO_RECIPIENT') THEN
        RETURN jsonb_build_object('outcome',t.decision_notification_status);
    END IF;
    IF t.decision_delivery_token IS NOT NULL THEN RETURN jsonb_build_object('outcome','BUSY'); END IF;
    -- Block D freezes the target at the decision commit, even before this claim.
    -- Never consult current links here; retries cannot redirect a decision.
    IF t.decision_target_chat_id IS NULL OR t.decision_target_chat_id=0 OR
        (t.source='TELEGRAM' AND t.decision_target_chat_id IS DISTINCT FROM t.origin_telegram_chat_id) THEN
        RAISE EXCEPTION USING ERRCODE='BG003', MESSAGE='Invalid saved destination';
    END IF;
    token := gen_random_uuid();
    UPDATE public.transactions SET decision_delivery_token=token,
        decision_delivery_started_at=clock_timestamp(),decision_notification_status='PENDING',
        decision_last_error=NULL,decision_sent_at=NULL WHERE id=t.id RETURNING * INTO t;
    RETURN jsonb_build_object('outcome','STARTED','token',token,
        'target_chat_id',t.decision_target_chat_id::text,
        'transaction',public.sheet_transaction_snapshot(t) || jsonb_build_object(
            'commission_pool_cents',t.commission_pool_cents::text));
END;
$$;

CREATE FUNCTION public.finish_decision_delivery(p_transaction_id uuid,p_token uuid,p_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE t public.transactions%ROWTYPE;
BEGIN
    IF p_outcome IS NULL OR p_outcome NOT IN ('SENT','FAILED','PENDING') THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid delivery outcome';
    END IF;
    SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='BG002', MESSAGE='Transaction not found'; END IF;
    IF p_token IS NULL OR t.decision_delivery_token IS DISTINCT FROM p_token THEN
        RAISE EXCEPTION USING ERRCODE='BG003', MESSAGE='Delivery ownership lost';
    END IF;
    UPDATE public.transactions SET decision_notification_status=p_outcome,
        decision_sent_at=CASE WHEN p_outcome='SENT' THEN clock_timestamp() END,
        decision_last_error=CASE WHEN p_outcome='FAILED' THEN 'Telegram decision delivery failed.' END,
        decision_delivery_token=NULL,decision_delivery_started_at=NULL
        WHERE id=t.id;
    -- No business revision, financial state, target, proposal, or Sheets changes.
    RETURN jsonb_build_object('outcome',p_outcome);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.read_website_workflow(uuid),
    public.begin_decision_delivery(uuid,uuid),public.finish_decision_delivery(uuid,uuid,text)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_website_workflow(uuid),
    public.begin_decision_delivery(uuid,uuid),public.finish_decision_delivery(uuid,uuid,text)
    TO service_role;
COMMIT;
