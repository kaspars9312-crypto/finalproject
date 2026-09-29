-- Block F only: DB reads and delivery metadata. No external calls.
-- Apply the new migration first. Run this entire file as migration owner in one
-- dedicated connection, with unrelated writes paused. On error, ROLLBACK.
-- Only TEMP prestate is committed; every application mutation is rolled back.
BEGIN;
DROP TABLE IF EXISTS pg_temp.block_f_prestate;
CREATE TEMP TABLE block_f_prestate(prefix text, employees jsonb, transactions_digest text,
    links jsonb, sessions jsonb, updates jsonb) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.block_f_prestate SELECT 'QA-BLOCK-F-' || gen_random_uuid()::text || '-',
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]'),
    md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]')),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]');
GRANT SELECT ON pg_temp.block_f_prestate TO service_role;
COMMIT;

BEGIN;
CREATE TEMP TABLE block_f_results(scenario text PRIMARY KEY, result text NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.block_f_results TO service_role;
CREATE FUNCTION pg_temp.check_f(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF passed IS NOT TRUE THEN RAISE EXCEPTION 'Block F QA FAIL: %', label; END IF;
    INSERT INTO pg_temp.block_f_results VALUES(label,'PASS');
END;
$$;
CREATE FUNCTION pg_temp.error_f(label text, statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
    BEGIN
        EXECUTE statement;
        RAISE EXCEPTION USING ERRCODE='ZF001', MESSAGE='Unexpected success';
    EXCEPTION WHEN OTHERS THEN actual := SQLSTATE;
    END;
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Block F QA FAIL: % (expected %, got %)',label,expected,actual;
    END IF;
    INSERT INTO pg_temp.block_f_results VALUES(label,'PASS');
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.check_f(text,boolean),pg_temp.error_f(text,text,text) TO service_role;
DO $$
DECLARE f record; n integer := 0;
BEGIN
    FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
        WHERE ns.nspname='public' AND p.proname IN ('sheet_transaction_snapshot','read_visible_transactions','begin_sheet_sync','finish_sheet_sync')
    LOOP
        n := n+1;
        PERFORM pg_temp.check_f('ACL and search_path ' || f.proname,
            has_function_privilege('service_role',f.oid,'EXECUTE')
            AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
            AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
            AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE')
            AND NOT f.prosecdef AND 'search_path=pg_catalog'=ANY(f.proconfig));
    END LOOP;
    PERFORM pg_temp.check_f('Exactly four Block F functions',n=4);
    PERFORM pg_temp.check_f('Synced revision and token nullable, with NULL default',
        (SELECT count(*)=2 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions'
            AND column_name IN ('sheet_synced_revision','sheet_sync_token') AND is_nullable='YES' AND column_default IS NULL));
END;
$$;
SET LOCAL ROLE service_role;
DO $$
DECLARE r uuid; k uuid; m uuid; a uuid; j uuid; s uuid; e uuid; token uuid; old_token uuid;
    prefix text; result jsonb; snapshot jsonb; before_row jsonb; person uuid; t public.transactions%ROWTYPE;
BEGIN
    SELECT p.prefix INTO STRICT prefix FROM pg_temp.block_f_prestate p;
    SELECT id INTO STRICT r FROM public.employees WHERE code='RICHARD';
    SELECT id INTO STRICT k FROM public.employees WHERE code='KEVIN';
    SELECT id INTO STRICT m FROM public.employees WHERE code='SVETLANA';
    SELECT id INTO STRICT a FROM public.employees WHERE code='ANASTASIA';
    SELECT id INTO STRICT j FROM public.employees WHERE code='JEAN_CLAUDE';
    UPDATE public.employees SET active=true;
    s := (public.create_website_sale(r,prefix || 'sale','Customer','A','Description',12345,
        49.999999999999999999999999999999,50.000000000000000000000000000001,0)->>'id')::uuid;
    e := (public.create_website_expense(k,prefix || 'expense','Expense',100,'TRAVEL','B')->>'id')::uuid;
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    before_row := to_jsonb(t) - ARRAY['sheet_sync_status','sheet_last_error','sheet_sync_started_at','sheet_synced_revision','sheet_sync_token'];
    PERFORM pg_temp.check_f('01 new metadata defaults',t.sheet_synced_revision IS NULL AND t.sheet_sync_token IS NULL AND t.revision=1);
    result := public.begin_sheet_sync(s);
    token := (result->>'token')::uuid;
    snapshot := result->'transaction';
    PERFORM pg_temp.check_f('02 begin exact snapshot',result->>'outcome'='STARTED' AND token IS NOT NULL
        AND snapshot->>'revision'='1' AND snapshot->>'amount_cents'='12345'
        AND jsonb_typeof(snapshot->'amount_cents')='string'
        AND snapshot->>'proposed_richard_pct'='49.999999999999999999999999999999'
        AND jsonb_typeof(snapshot->'proposed_richard_pct')='string');
    PERFORM pg_temp.check_f('03 active writer blocks another attempt',public.begin_sheet_sync(s,m)->>'outcome'='BUSY');
    PERFORM pg_temp.check_f('Begin marks pending and timestamp without revision change',
        (SELECT sheet_sync_status='PENDING' AND sheet_sync_started_at IS NOT NULL AND revision=1 FROM public.transactions WHERE id=s));
    PERFORM pg_temp.error_f('04 wrong token cannot finish',format('SELECT public.finish_sheet_sync(%L,%L,1,''SUCCESS'')',s,gen_random_uuid()),'BF003');
    result := public.finish_sheet_sync(s,token,1,'SUCCESS');
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    PERFORM pg_temp.check_f('05 same revision marks synced',result->>'outcome'='SYNCED' AND t.sheet_sync_status='SYNCED'
        AND t.sheet_synced_revision=1 AND t.sheet_sync_token IS NULL AND t.sheet_sync_started_at IS NULL);
    PERFORM pg_temp.check_f('06 sync never changes financial state',
        to_jsonb(t) - ARRAY['sheet_sync_status','sheet_last_error','sheet_sync_started_at','sheet_synced_revision','sheet_sync_token']=before_row);
    PERFORM pg_temp.check_f('07 already current does not acquire writer',public.begin_sheet_sync(s,m)->>'outcome'='SYNCED');

    -- Existing business RPC advances revision; frozen code is never replaced.
    PERFORM public.correct_pending_sale(m,s,1,'Customer','A','Correction',12345);
    result := public.begin_sheet_sync(s,m); token := (result->>'token')::uuid;
    PERFORM public.approve_sale(m,s,2,20,40,40,1235,247,494,494);
    PERFORM pg_temp.check_f('08 business revision does not release writer token',public.begin_sheet_sync(s,m)->>'outcome'='BUSY');
    result := public.finish_sheet_sync(s,token,2,'SUCCESS');
    SELECT * INTO STRICT t FROM public.transactions WHERE id=s;
    PERFORM pg_temp.check_f('09 stale external success cannot mark new revision synced',
        result->>'outcome'='STALE' AND t.revision=3 AND t.sheet_sync_status='PENDING'
        AND t.sheet_synced_revision=1 AND t.sheet_sync_token=token AND t.status='APPROVED');
    PERFORM pg_temp.check_f('10 stale receipt contains newest approved snapshot',
        result->'transaction'->>'revision'='3' AND result->'transaction'->>'status'='APPROVED'
        AND result->'transaction'->>'final_richard_pct'='20'
        AND result->'transaction'->>'richard_commission_cents'='247');
    PERFORM public.finish_sheet_sync(s,token,3,'SUCCESS');
    PERFORM pg_temp.check_f('11 newest revision becomes synced',(SELECT sheet_sync_status='SYNCED' AND sheet_synced_revision=3 FROM public.transactions WHERE id=s));

    result := public.begin_sheet_sync(e,m); token := (result->>'token')::uuid; old_token := token;
    SELECT to_jsonb(x) - ARRAY['sheet_sync_status','sheet_last_error','sheet_sync_started_at','sheet_synced_revision','sheet_sync_token']
        INTO before_row FROM public.transactions x WHERE id=e;
    PERFORM public.finish_sheet_sync(e,token,1,'FAILED');
    SELECT * INTO STRICT t FROM public.transactions WHERE id=e;
    PERFORM pg_temp.check_f('12 failure is sanitized and financial state unchanged',t.sheet_sync_status='FAILED'
        AND t.sheet_last_error='Sheets sync failed. Retry to synchronize the saved transaction.'
        AND t.sheet_sync_token IS NULL AND t.sheet_synced_revision IS NULL
        AND to_jsonb(t) - ARRAY['sheet_sync_status','sheet_last_error','sheet_sync_started_at','sheet_synced_revision','sheet_sync_token']=before_row);
    result := public.begin_sheet_sync(e,m); token := (result->>'token')::uuid;
    PERFORM pg_temp.check_f('13 manager retry reuses record and revision',token<>old_token AND result->'transaction'->>'revision'='1'
        AND result->'transaction'->>'id'=e::text AND (SELECT count(*)=1 FROM public.transactions WHERE reference=prefix || 'expense'));
    PERFORM pg_temp.error_f('14 old token cannot finish replacement attempt',format('SELECT public.finish_sheet_sync(%L,%L,1,''SUCCESS'')',e,old_token),'BF003');
    PERFORM public.finish_sheet_sync(e,token,1,'PENDING');
    PERFORM pg_temp.check_f('15 bounded retry yields pending without revision change',
        (SELECT sheet_sync_status='PENDING' AND revision=1 AND sheet_sync_token IS NULL FROM public.transactions WHERE id=e));

    FOREACH person IN ARRAY ARRAY[r,k,a,j] LOOP
        PERFORM pg_temp.error_f('Non-manager retry denied ' || person,format('SELECT public.begin_sheet_sync(%L,%L)',e,person),'BF001');
    END LOOP;
    UPDATE public.employees SET active=false WHERE id=m;
    PERFORM pg_temp.error_f('16 inactive manager retry denied',format('SELECT public.begin_sheet_sync(%L,%L)',e,m),'BF001');
    UPDATE public.employees SET active=true WHERE id=m;
    PERFORM pg_temp.error_f('17 unknown actor retry denied',format('SELECT public.begin_sheet_sync(%L,%L)',e,gen_random_uuid()),'BF001');
    PERFORM pg_temp.error_f('18 missing transaction denied',format('SELECT public.begin_sheet_sync(%L,%L)',gen_random_uuid(),m),'BF002');

    FOREACH person IN ARRAY ARRAY[r,k,a,j] LOOP
        result := public.read_visible_transactions(person);
        PERFORM pg_temp.check_f('Own rows only ' || person,NOT EXISTS(
            SELECT 1 FROM jsonb_array_elements(result->'transactions') x WHERE x->>'submitter_employee_id'<>person::text));
    END LOOP;
    result := public.read_visible_transactions(m);
    PERFORM pg_temp.check_f('19 manager sees all rows',jsonb_array_length(result->'transactions')=(SELECT count(*) FROM public.transactions));
    PERFORM pg_temp.check_f('20 UI projection omits private identity and lock fields',NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(result->'transactions') x
        WHERE x ? 'sheet_sync_token' OR x ? 'origin_telegram_chat_id' OR x ? 'original_submission'));
    UPDATE public.employees SET active=false WHERE id=r;
    PERFORM pg_temp.error_f('21 inactive reader denied',format('SELECT public.read_visible_transactions(%L)',r),'BF001');
    PERFORM pg_temp.error_f('22 unknown reader denied',format('SELECT public.read_visible_transactions(%L)',gen_random_uuid()),'BF001');
END;
$$;
SELECT * FROM pg_temp.block_f_results ORDER BY scenario;
SELECT count(*) AS passed FROM pg_temp.block_f_results;
ROLLBACK;

DO $$
DECLARE p pg_temp.block_f_prestate%ROWTYPE;
BEGIN
    SELECT * INTO STRICT p FROM pg_temp.block_f_prestate;
    IF EXISTS(SELECT 1 FROM public.transactions WHERE starts_with(reference,p.prefix))
        OR md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]')) IS DISTINCT FROM p.transactions_digest THEN
        RAISE EXCEPTION 'Block F QA FAIL: transactions not restored after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]') IS DISTINCT FROM p.employees
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]') IS DISTINCT FROM p.links
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]') IS DISTINCT FROM p.sessions
        OR coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]') IS DISTINCT FROM p.updates THEN
        RAISE EXCEPTION 'Block F QA FAIL: other application state not restored after rollback';
    END IF;
END;
$$;
SELECT 'PASS: all application state restored after rollback' AS rollback_verification;
