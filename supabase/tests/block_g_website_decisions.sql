-- Manual review-time QA only. Apply all migrations first. Run the ENTIRE file
-- as migration owner in one dedicated connection, unrelated writes paused.
-- No network calls. All application changes roll back. On an error: ROLLBACK.
BEGIN;
DROP TABLE IF EXISTS pg_temp.block_g_prestate;
CREATE TEMP TABLE block_g_prestate(prefix text, employees jsonb, transactions_digest text,
    links jsonb, sessions jsonb, updates jsonb) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.block_g_prestate SELECT 'QA-BLOCK-G-' || gen_random_uuid()::text || '-',
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]'),
    md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]')),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]');
GRANT SELECT ON pg_temp.block_g_prestate TO service_role;
COMMIT;

BEGIN;
CREATE TEMP TABLE block_g_results(scenario text PRIMARY KEY, result text NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.block_g_results TO service_role;
CREATE FUNCTION pg_temp.check_g(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF passed IS NOT TRUE THEN RAISE EXCEPTION 'Block G QA FAIL: %',label; END IF;
    INSERT INTO pg_temp.block_g_results VALUES(label,'PASS');
END;
$$;
CREATE FUNCTION pg_temp.error_g(label text, statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
    BEGIN
        EXECUTE statement;
        RAISE EXCEPTION USING ERRCODE='ZG001', MESSAGE='Unexpected success';
    EXCEPTION WHEN OTHERS THEN actual := SQLSTATE;
    END;
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Block G QA FAIL: % (expected %, got %)',label,expected,actual;
    END IF;
    INSERT INTO pg_temp.block_g_results VALUES(label,'PASS');
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.check_g(text,boolean),pg_temp.error_g(text,text,text) TO service_role;

DO $$
DECLARE f record; n integer := 0;
BEGIN
    FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname IN ('read_website_workflow','begin_decision_delivery','finish_decision_delivery')
    LOOP
        n := n+1;
        PERFORM pg_temp.check_g('ACL and search_path ' || f.proname,
            has_function_privilege('service_role',f.oid,'EXECUTE')
            AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
            AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
            AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
            AND NOT f.prosecdef AND 'search_path=pg_catalog'=ANY(f.proconfig));
    END LOOP;
    PERFORM pg_temp.check_g('Exactly three Block G functions',n=3);
END;
$$;
SET LOCAL ROLE service_role;
DO $$
DECLARE r uuid; k uuid; m uuid; a uuid; person uuid; s uuid; e uuid; tg uuid; overhead uuid; missing uuid;
    token uuid; old_token uuid; result jsonb; before_row jsonb; history jsonb; t public.transactions%ROWTYPE;
    prefix text; final_destination text;
    user_one bigint := 900000000000000071; user_two bigint := 900000000000000072;
    chat_one bigint := 900000000000000081; chat_two bigint := 900000000000000082;
    origin_chat bigint := 900000000000000083; u bigint := 900000000000007000;
    answer text; offset_n integer := 0;
    delivery_fields text[] := ARRAY['decision_notification_status','decision_last_error','decision_sent_at',
        'decision_delivery_token','decision_delivery_started_at'];
BEGIN
    SELECT p.prefix INTO STRICT prefix FROM pg_temp.block_g_prestate p;
    SELECT id INTO STRICT r FROM public.employees WHERE code='RICHARD';
    SELECT id INTO STRICT k FROM public.employees WHERE code='KEVIN';
    SELECT id INTO STRICT m FROM public.employees WHERE code='SVETLANA';
    SELECT id INTO STRICT a FROM public.employees WHERE code='ANASTASIA';
    IF EXISTS(SELECT 1 FROM public.telegram_links WHERE telegram_user_id IN (user_one,user_two))
        OR EXISTS(SELECT 1 FROM public.telegram_updates WHERE update_id BETWEEN u AND u+99) THEN
        RAISE EXCEPTION 'Block G QA ID collision: select unused fake IDs';
    END IF;
    UPDATE public.employees SET active=true;
    UPDATE public.telegram_links SET employee_id=NULL WHERE employee_id IN (r,k,a);

    s := (public.create_website_sale(r,prefix || 'website','Customer','A','Description',12345,12.5,37.5,50)->>'id')::uuid;
    PERFORM pg_temp.check_g('01 pending notification not required',public.begin_decision_delivery(m,s)->>'outcome'='NOT_REQUIRED');
    -- Link AFTER creation and BEFORE decision, preserving a previously unlinked /start chat.
    PERFORM public.telegram_apply_update(u,user_one,chat_one,'START');
    PERFORM public.telegram_set_link(m,user_one,r);
    PERFORM pg_temp.check_g('02 manager setup retains known private chat',
        (SELECT employee_id=r AND last_private_chat_id=chat_one FROM public.telegram_links WHERE telegram_user_id=user_one));
    SELECT original_submission INTO history FROM public.transactions WHERE id=s;
    PERFORM public.correct_pending_sale(m,s,1,'Corrected customer','B','Corrected description',20000);
    PERFORM public.approve_sale(m,s,2,20,40,40,2000,400,800,800);
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    before_row := to_jsonb(t) - delivery_fields;
    PERFORM pg_temp.check_g('03 website decision resolves current submitter chat',t.decision_target_chat_id=chat_one
        AND t.decision_notification_status='PENDING' AND t.original_submission=history AND t.revision=3);
    -- Remapping even before first send cannot redirect the committed intent.
    PERFORM public.telegram_apply_update(u+1,user_two,chat_two,'START');
    PERFORM public.telegram_set_link(m,user_two,r);
    result := public.begin_decision_delivery(m,s); token := (result->>'token')::uuid; old_token := token;
    PERFORM pg_temp.check_g('04 first claim keeps decision-time target after remap',result->>'outcome'='STARTED'
        AND result->>'target_chat_id'=chat_one::text AND jsonb_typeof(result->'target_chat_id')='string'
        AND result->'transaction'->>'commission_pool_cents'='2000'
        AND jsonb_typeof(result->'transaction'->'commission_pool_cents')='string'
        AND result->'transaction'->>'final_richard_pct'='20');
    PERFORM pg_temp.check_g('05 overlapping claim blocked',public.begin_decision_delivery(m,s)->>'outcome'='BUSY');
    PERFORM pg_temp.error_g('06 wrong token cannot finish',format('SELECT public.finish_decision_delivery(%L,%L,''SENT'')',s,gen_random_uuid()),'BG003');
    PERFORM public.finish_decision_delivery(s,token,'FAILED');
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    PERFORM pg_temp.check_g('07 failure isolated and sanitized',t.decision_notification_status='FAILED'
        AND t.decision_last_error='Telegram decision delivery failed.' AND t.decision_sent_at IS NULL
        AND t.decision_delivery_token IS NULL AND t.decision_delivery_started_at IS NULL
        AND to_jsonb(t) - delivery_fields=before_row);
    result := public.begin_decision_delivery(m,s); token := (result->>'token')::uuid;
    PERFORM pg_temp.check_g('08 retry freezes same target and new owner',result->>'target_chat_id'=chat_one::text AND token<>old_token);
    PERFORM pg_temp.error_g('09 old owner cannot finish retry',format('SELECT public.finish_decision_delivery(%L,%L,''SENT'')',s,old_token),'BG003');
    PERFORM public.finish_decision_delivery(s,token,'SENT');
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    PERFORM pg_temp.check_g('10 successful finish changes delivery only',t.decision_notification_status='SENT'
        AND t.decision_sent_at IS NOT NULL AND t.decision_last_error IS NULL AND t.decision_delivery_token IS NULL
        AND to_jsonb(t) - delivery_fields=before_row);
    PERFORM pg_temp.check_g('11 sent retry is a no-op',public.begin_decision_delivery(m,s)->>'outcome'='SENT');
    PERFORM pg_temp.error_g('12 late finish cannot downgrade sent',format('SELECT public.finish_decision_delivery(%L,%L,''FAILED'')',s,token),'BG003');
    PERFORM pg_temp.error_g('13 approved correction rejected',format('SELECT public.correct_pending_sale(%L,%L,3,''C'',''A'',''D'',100)',m,s),'BD003');
    PERFORM pg_temp.error_g('14 double approval rejected',format('SELECT public.approve_sale(%L,%L,3,20,40,40,2000,400,800,800)',m,s),'BD003');

    -- A true Telegram-origin row, produced by the frozen wizard RPCs.
    PERFORM public.telegram_set_link(m,user_one,r);
    PERFORM public.telegram_apply_update(u+2,user_one,origin_chat,'SALE');
    FOREACH answer IN ARRAY ARRAY[prefix || 'telegram','Customer','A','Description','10000','50','30','20'] LOOP
        offset_n := offset_n+1;
        result := public.telegram_apply_update(u+2+offset_n,user_one,origin_chat,'ANSWER',public.telegram_read_session(user_one),answer);
    END LOOP;
    tg := (result->'transaction'->>'id')::uuid;
    SELECT to_jsonb(x) INTO history FROM public.transactions x WHERE id=tg;
    PERFORM public.telegram_set_link(m,user_one,k);
    PERFORM pg_temp.check_g('15 remap preserves entire Telegram history',(SELECT to_jsonb(x)=history FROM public.transactions x WHERE id=tg));
    PERFORM public.approve_sale(m,tg,1,50,30,20,1000,500,300,200);
    result := public.begin_decision_delivery(m,tg); token := (result->>'token')::uuid;
    PERFORM pg_temp.check_g('16 Telegram approval uses immutable submission chat',result->>'target_chat_id'=origin_chat::text
        AND (SELECT submitter_employee_id=r AND origin_telegram_chat_id=origin_chat FROM public.transactions WHERE id=tg));
    PERFORM public.finish_decision_delivery(tg,token,'FAILED');
    PERFORM public.telegram_set_link(m,user_two,r);
    result := public.begin_decision_delivery(m,tg); token := (result->>'token')::uuid;
    PERFORM pg_temp.check_g('17 Telegram retry still uses origin',result->>'target_chat_id'=origin_chat::text);
    PERFORM public.finish_decision_delivery(tg,token,'PENDING');
    PERFORM pg_temp.check_g('18 operator release retains pending intent and business revision',
        (SELECT decision_notification_status='PENDING' AND decision_delivery_token IS NULL AND revision=2
            AND decision_target_chat_id=origin_chat FROM public.transactions WHERE id=tg));

    missing := (public.create_website_sale(a,prefix || 'no-link','C','A','D',10000,50,30,20)->>'id')::uuid;
    PERFORM public.approve_sale(m,missing,1,50,30,20,1000,500,300,200);
    PERFORM pg_temp.check_g('19 missing link is explicit no recipient',public.begin_decision_delivery(m,missing)->>'outcome'='NO_RECIPIENT'
        AND (SELECT decision_target_chat_id IS NULL AND decision_delivery_token IS NULL FROM public.transactions WHERE id=missing));
    PERFORM public.telegram_set_link(m,user_two,a);
    PERFORM pg_temp.check_g('20 later link does not silently redirect no-recipient decision',public.begin_decision_delivery(m,missing)->>'outcome'='NO_RECIPIENT');

    FOREACH final_destination IN ARRAY ARRAY['A','B','COMPANY_OVERHEAD'] LOOP
        e := (public.create_website_expense(k,prefix || 'expense-' || final_destination,'Expense',8000,'TRAVEL','B')->>'id')::uuid;
        PERFORM public.allocate_expense(m,e,1,final_destination);
        SELECT * INTO STRICT t FROM public.transactions WHERE id=e;
        before_row := to_jsonb(t) - delivery_fields;
        result := public.begin_decision_delivery(m,e); token := (result->>'token')::uuid;
        PERFORM pg_temp.check_g('21 expense reporter target and final allocation ' || final_destination,
            result->>'target_chat_id'=chat_one::text AND result->'transaction'->>'final_allocation'=final_destination);
        PERFORM public.finish_decision_delivery(e,token,'FAILED');
        PERFORM pg_temp.check_g('22 expense financial state survives failure ' || final_destination,
            (SELECT to_jsonb(x) - delivery_fields=before_row AND amount_cents=8000 AND proposed_allocation='B' FROM public.transactions x WHERE id=e));
        PERFORM pg_temp.error_g('23 double allocation refused ' || final_destination,
            format('SELECT public.allocate_expense(%L,%L,2,''A'')',m,e),'BD003');
    END LOOP;
    overhead := (public.create_website_expense(k,prefix || 'overhead','D',100,'OTHER','COMPANY_OVERHEAD')->>'id')::uuid;
    PERFORM pg_temp.check_g('24 auto-overhead requires no decision delivery',public.begin_decision_delivery(m,overhead)->>'outcome'='NOT_REQUIRED');

    FOREACH person IN ARRAY ARRAY[r,k,a] LOOP
        PERFORM pg_temp.error_g('Non-manager delivery denied ' || person,format('SELECT public.begin_decision_delivery(%L,%L)',person,s),'BG001');
        result := public.read_website_workflow(person);
        PERFORM pg_temp.check_g('Own workflow and no link list ' || person,jsonb_array_length(result->'links')=0 AND NOT EXISTS(
            SELECT 1 FROM jsonb_array_elements(result->'transactions') x WHERE x->>'submitter_employee_id'<>person::text));
    END LOOP;
    result := public.read_website_workflow(m);
    PERFORM pg_temp.check_g('25 manager sees all rows and exact links',jsonb_array_length(result->'transactions')=(SELECT count(*) FROM public.transactions)
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(result->'links') x WHERE x->>'telegram_user_id'=user_one::text
            AND jsonb_typeof(x->'telegram_user_id')='string' AND x->>'private_chat_known'='true'));
    PERFORM pg_temp.check_g('26 read never exposes targets tokens or raw errors',NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(result->'transactions') x WHERE x ? 'decision_target_chat_id'
            OR x ? 'decision_delivery_token' OR x ? 'origin_telegram_chat_id' OR x ? 'decision_last_error'));
    UPDATE public.employees SET active=false WHERE id=m;
    PERFORM pg_temp.error_g('27 inactive manager denied',format('SELECT public.begin_decision_delivery(%L,%L)',m,s),'BG001');
    PERFORM pg_temp.error_g('28 inactive workflow reader denied',format('SELECT public.read_website_workflow(%L)',m),'BG001');
    UPDATE public.employees SET active=true WHERE id=m;
    PERFORM pg_temp.error_g('29 missing actor cannot use internal bypass',format('SELECT public.begin_decision_delivery(NULL,%L)',s),'BG001');
    PERFORM pg_temp.error_g('30 unknown transaction refused',format('SELECT public.begin_decision_delivery(%L,%L)',m,gen_random_uuid()),'BG002');
    PERFORM pg_temp.error_g('31 invalid finish outcome refused',format('SELECT public.finish_decision_delivery(%L,%L,''PRIVATE'')',s,token),'22023');
    PERFORM pg_temp.error_g('32 non-manager link denied',format('SELECT public.telegram_set_link(%L,%L,%L)',r,user_one,r),'BE001');
END;
$$;
SELECT * FROM pg_temp.block_g_results ORDER BY scenario;
SELECT count(*) AS passed FROM pg_temp.block_g_results;
ROLLBACK;

DO $$
DECLARE p pg_temp.block_g_prestate%ROWTYPE;
BEGIN
    SELECT * INTO STRICT p FROM pg_temp.block_g_prestate;
    IF EXISTS(SELECT 1 FROM public.transactions WHERE starts_with(reference,p.prefix))
        OR md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]')) IS DISTINCT FROM p.transactions_digest THEN
        RAISE EXCEPTION 'Block G QA FAIL: transactions not restored after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]') IS DISTINCT FROM p.employees
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]') IS DISTINCT FROM p.links
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]') IS DISTINCT FROM p.sessions
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]') IS DISTINCT FROM p.updates THEN
        RAISE EXCEPTION 'Block G QA FAIL: other application state not restored after rollback';
    END IF;
END;
$$;
SELECT 'PASS: all five application tables restored after rollback' AS rollback_verification;
