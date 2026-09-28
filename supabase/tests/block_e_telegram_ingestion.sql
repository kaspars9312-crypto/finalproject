-- Run the entire script after all three migrations, in a dedicated connection
-- as migration owner. No Telegram network. Pause unrelated writes during QA.
-- psql: -v ON_ERROR_STOP=1 -f supabase/tests/block_e_telegram_ingestion.sql
-- On any unexpected exception, ROLLBACK before reusing the connection.
-- Explicitly commit ONLY temporary prestate, so SQL Editor batch rollback cannot
-- erase the evidence used by the actual post-rollback restoration assertions.
BEGIN;
DROP TABLE IF EXISTS pg_temp.block_e_prestate;
CREATE TEMP TABLE block_e_prestate (prefix text, links jsonb, sessions jsonb, updates jsonb,
    employees jsonb, transactions_digest text) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.block_e_prestate
SELECT 'QA-BLOCK-E-' || gen_random_uuid()::text || '-',
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]'),
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]'),
    md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]'));
GRANT SELECT ON pg_temp.block_e_prestate TO service_role;
COMMIT;

BEGIN;
CREATE TEMP TABLE block_e_results(scenario text PRIMARY KEY,result text NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.block_e_results TO service_role;
CREATE FUNCTION pg_temp.check_e(label text,passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF passed IS NOT TRUE THEN RAISE EXCEPTION 'Block E QA FAIL: %', label; END IF;
    INSERT INTO pg_temp.block_e_results VALUES(label,'PASS');
END;
$$;
CREATE FUNCTION pg_temp.error_e(label text,statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
    BEGIN
        EXECUTE statement;
        RAISE EXCEPTION USING ERRCODE = 'ZE001', MESSAGE = 'Unexpected success';
    EXCEPTION WHEN OTHERS THEN actual := SQLSTATE;
    END;
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Block E QA FAIL: % (expected %, got %)',label,expected,actual;
    END IF;
    INSERT INTO pg_temp.block_e_results VALUES(label,'PASS');
END;
$$;
CREATE FUNCTION pg_temp.answer_e(u bigint,person bigint,chat bigint,value text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT public.telegram_apply_update(u,person,chat,'ANSWER',public.telegram_read_session(person),value);
$$;
-- Build a complete sale through real RPC steps, leaving only the final share.
CREATE FUNCTION pg_temp.sale_e(u bigint,person bigint,chat bigint,ref text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM public.telegram_apply_update(u,person,chat,'SALE');
    PERFORM pg_temp.answer_e(u+1,person,chat,ref);
    PERFORM pg_temp.answer_e(u+2,person,chat,'QA customer');
    PERFORM pg_temp.answer_e(u+3,person,chat,'A');
    PERFORM pg_temp.answer_e(u+4,person,chat,'QA description');
    PERFORM pg_temp.answer_e(u+5,person,chat,'12345');
    PERFORM pg_temp.answer_e(u+6,person,chat,'12.5');
    PERFORM pg_temp.answer_e(u+7,person,chat,'37.5');
END;
$$;
CREATE FUNCTION pg_temp.expense_e(u bigint,person bigint,chat bigint,ref text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM public.telegram_apply_update(u,person,chat,'EXPENSE');
    PERFORM pg_temp.answer_e(u+1,person,chat,ref);
    PERFORM pg_temp.answer_e(u+2,person,chat,'QA expense');
    PERFORM pg_temp.answer_e(u+3,person,chat,'8000');
    PERFORM pg_temp.answer_e(u+4,person,chat,'TRAVEL');
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.check_e(text,boolean),pg_temp.error_e(text,text,text),
    pg_temp.answer_e(bigint,bigint,bigint,text),pg_temp.sale_e(bigint,bigint,bigint,text),
    pg_temp.expense_e(bigint,bigint,bigint,text) TO service_role;

DO $$
DECLARE f record; n integer := 0;
BEGIN
    FOR f IN SELECT p.* FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
        WHERE ns.nspname = 'public' AND p.proname IN ('telegram_read_session','telegram_apply_update','telegram_set_link','telegram_mark_confirmation')
    LOOP
        n := n+1;
        PERFORM pg_temp.check_e('ACL and search_path ' || f.proname,
            has_function_privilege('service_role',f.oid,'EXECUTE')
            AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
            AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner)))
                WHERE grantee = 0 AND privilege_type = 'EXECUTE')
            AND NOT f.prosecdef AND 'search_path=pg_catalog' = ANY(f.proconfig));
    END LOOP;
    PERFORM pg_temp.check_e('Exactly four Block E RPC signatures',n=4);
END;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
    r uuid; k uuid; m uuid; a uuid;
    person bigint := 900000000000000011;
    other_person bigint := 900000000000000012;
    chat bigint := 900000000000000021;
    other_chat bigint := 900000000000000022;
    u bigint := 900000000000001000;
    prefix text; result jsonb; before_session jsonb; before_row jsonb;
    t public.transactions%ROWTYPE; sale_id uuid; expense_id uuid;
BEGIN
    SELECT p.prefix INTO STRICT prefix FROM pg_temp.block_e_prestate p;
    SELECT id INTO STRICT r FROM public.employees WHERE code='RICHARD';
    SELECT id INTO STRICT k FROM public.employees WHERE code='KEVIN';
    SELECT id INTO STRICT m FROM public.employees WHERE code='SVETLANA';
    SELECT id INTO STRICT a FROM public.employees WHERE code='ANASTASIA';
    IF EXISTS (SELECT 1 FROM public.telegram_links WHERE telegram_user_id IN (person,other_person))
        OR EXISTS (SELECT 1 FROM public.telegram_updates WHERE update_id BETWEEN u AND u+999) THEN
        RAISE EXCEPTION 'Block E QA identity/update collision: choose unused QA IDs';
    END IF;
    UPDATE public.employees SET active=true;

    result := public.telegram_apply_update(u,person,chat,'START');
    PERFORM pg_temp.check_e('01 start creates unlinked identity and distinct chat',
        result->>'outcome'='START' AND result->>'role' IS NULL
        AND (SELECT employee_id IS NULL AND last_private_chat_id=chat FROM public.telegram_links WHERE telegram_user_id=person));
    PERFORM pg_temp.check_e('02 unlinked sale denied',public.telegram_apply_update(u+1,person,chat,'SALE')->>'outcome'='UNLINKED'
        AND NOT EXISTS(SELECT 1 FROM public.telegram_sessions WHERE telegram_user_id=person));
    PERFORM pg_temp.check_e('03 unlinked expense denied',public.telegram_apply_update(u+2,person,chat,'EXPENSE')->>'outcome'='UNLINKED');
    PERFORM pg_temp.error_e('04 non-manager link denied',format('SELECT public.telegram_set_link(%L,%L,%L)',r,person,r),'BE001');
    PERFORM pg_temp.error_e('05 missing target must start first',format('SELECT public.telegram_set_link(%L,%L,%L)',m,other_person,r),'BE002');
    PERFORM public.telegram_set_link(m,person,r);
    result := public.telegram_apply_update(u+3,person,other_chat,'START');
    PERFORM pg_temp.check_e('06 start preserves mapping and refreshes private chat',result->>'role'='SALESPERSON'
        AND (SELECT employee_id=r AND last_private_chat_id=other_chat FROM public.telegram_links WHERE telegram_user_id=person));
    result := public.telegram_apply_update(u+4,person,chat,'SALE');
    before_session := public.telegram_read_session(person);
    PERFORM pg_temp.check_e('07 sale begin claim and session snapshot',result->>'outcome'='PROMPT'
        AND before_session->>'chat_id'=chat::text AND before_session->>'employee_id_at_start'=r::text
        AND before_session->>'step'='reference' AND before_session->'draft_payload'='{}'::jsonb
        AND EXISTS(SELECT 1 FROM public.telegram_updates WHERE update_id=u+4));
    PERFORM pg_temp.check_e('08 duplicate command does not replace wizard',
        public.telegram_apply_update(u+4,person,other_chat,'EXPENSE')->>'outcome'='DUPLICATE'
        AND public.telegram_read_session(person)=before_session);
    PERFORM pg_temp.check_e('09 salesperson expense denied',public.telegram_apply_update(u+5,person,chat,'EXPENSE')->>'outcome'='FORBIDDEN');
    PERFORM pg_temp.check_e('10 invalid answer leaves step/draft unchanged',pg_temp.answer_e(u+6,person,chat,' ')->>'outcome'='INVALID'
        AND public.telegram_read_session(person)=before_session);
    PERFORM pg_temp.answer_e(u+7,person,chat,prefix || 'draft');
    before_session := public.telegram_read_session(person);
    PERFORM pg_temp.check_e('11 duplicate answer never advances twice',pg_temp.answer_e(u+7,person,chat,'QA customer')->>'outcome'='DUPLICATE'
        AND public.telegram_read_session(person)=before_session);
    PERFORM pg_temp.check_e('12 wrong chat cannot mutate wizard',pg_temp.answer_e(u+8,person,other_chat,'QA customer')->>'outcome'='WRONG_CHAT'
        AND public.telegram_read_session(person)=before_session);
    PERFORM pg_temp.check_e('13 stale snapshot is not interpreted against new step',
        public.telegram_apply_update(u+9,person,chat,'ANSWER','{}','QA customer')->>'outcome'='SESSION_CHANGED'
        AND public.telegram_read_session(person)=before_session);
    PERFORM public.telegram_apply_update(u+10,person,chat,'CANCEL');
    PERFORM pg_temp.check_e('14 cancel clears only current session and retains dedup',public.telegram_read_session(person) IS NULL
        AND EXISTS(SELECT 1 FROM public.telegram_updates WHERE update_id=u+10));

    -- Prove caller rollback restores BOTH update claim and caused session change.
    BEGIN
        PERFORM public.telegram_apply_update(u+11,person,chat,'SALE');
        RAISE EXCEPTION USING ERRCODE='ZE002',MESSAGE='Simulated transaction abort';
    EXCEPTION WHEN SQLSTATE 'ZE002' THEN NULL;
    END;
    PERFORM pg_temp.check_e('15 claim and session roll back together on transaction abort',
        public.telegram_read_session(person) IS NULL AND NOT EXISTS(SELECT 1 FROM public.telegram_updates WHERE update_id=u+11));

    PERFORM pg_temp.sale_e(u+20,person,chat,prefix || 'sale');
    before_session := public.telegram_read_session(person);
    result := pg_temp.answer_e(u+28,person,chat,'51');
    PERFORM pg_temp.check_e('16 invalid exact total does not advance or insert',result->>'outcome'='INVALID'
        AND public.telegram_read_session(person)=before_session
        AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE reference=prefix || 'sale'));
    result := pg_temp.answer_e(u+29,person,chat,'50');
    sale_id := (result->'transaction'->>'id')::uuid;
    SELECT * INTO STRICT t FROM public.transactions WHERE id=sale_id;
    before_row := to_jsonb(t);
    PERFORM pg_temp.check_e('17 final decimal sale is pending with complete original proposal',result->>'outcome'='SAVED'
        AND t.status='PENDING_APPROVAL' AND t.revision=1 AND t.amount_cents=12345
        AND t.customer='QA customer' AND t.project='A' AND t.proposed_richard_pct=12.5
        AND t.proposed_anastasia_pct=37.5 AND t.proposed_jean_claude_pct=50
        AND t.final_richard_pct IS NULL AND t.final_anastasia_pct IS NULL AND t.final_jean_claude_pct IS NULL
        AND t.commission_pool_cents=0 AND t.richard_commission_cents=0 AND t.anastasia_commission_cents=0 AND t.jean_claude_commission_cents=0
        AND t.original_submission=jsonb_build_object('reference',prefix || 'sale','customer','QA customer','project','A',
            'description','QA description','amount_cents','12345','proposed_richard_pct','12.5','proposed_anastasia_pct','37.5','proposed_jean_claude_pct','50'));
    PERFORM pg_temp.check_e('18 atomic source identity origin and initial intent',t.source='TELEGRAM'
        AND t.submitter_employee_id=r AND t.origin_telegram_chat_id=chat AND t.submission_target_chat_id=chat
        AND t.submission_confirmation_status='PENDING' AND t.submission_sent_at IS NULL
        AND t.decision_notification_status='NOT_REQUIRED' AND t.sheet_sync_status='PENDING'
        AND public.telegram_read_session(person) IS NULL
        AND EXISTS(SELECT 1 FROM public.telegram_updates WHERE update_id=u+29)
        AND result->'transaction'->>'target_chat_id'=chat::text AND jsonb_typeof(result->'transaction'->'amount_cents')='string');
    PERFORM pg_temp.check_e('19 replay final is duplicate not duplicate reference',pg_temp.answer_e(u+29,person,chat,'50')->>'outcome'='DUPLICATE'
        AND (SELECT count(*)=1 FROM public.transactions WHERE reference=prefix || 'sale'));
    PERFORM pg_temp.sale_e(u+40,person,chat,prefix || 'sale');
    before_session := public.telegram_read_session(person);
    PERFORM pg_temp.check_e('20 different update duplicate reference inserts nothing',pg_temp.answer_e(u+48,person,chat,'50')->>'outcome'='DUPLICATE_REFERENCE'
        AND public.telegram_read_session(person)=before_session AND (SELECT count(*)=1 FROM public.transactions WHERE reference=prefix || 'sale'));
    PERFORM pg_temp.check_e('21 duplicate reference rejection itself deduplicates',pg_temp.answer_e(u+48,person,chat,'50')->>'outcome'='DUPLICATE');

    PERFORM public.telegram_set_link(m,person,k);
    PERFORM pg_temp.check_e('22 manager remap clears active wizard',public.telegram_read_session(person) IS NULL);
    PERFORM pg_temp.check_e('23 in-flight stale snapshot rejects after remap',
        public.telegram_apply_update(u+49,person,chat,'ANSWER',before_session,'50')->>'outcome'='STALE_SESSION');
    PERFORM pg_temp.check_e('24 history unchanged after remap',(SELECT to_jsonb(x)=before_row FROM public.transactions x WHERE id=sale_id));
    PERFORM pg_temp.check_e('25 Kevin cannot start sale',public.telegram_apply_update(u+50,person,chat,'SALE')->>'outcome'='FORBIDDEN');

    PERFORM pg_temp.expense_e(u+60,person,chat,prefix || 'overhead');
    result := pg_temp.answer_e(u+65,person,chat,'COMPANY_OVERHEAD');
    expense_id := (result->'transaction'->>'id')::uuid;
    SELECT * INTO STRICT t FROM public.transactions WHERE id=expense_id;
    PERFORM pg_temp.check_e('26 Kevin overhead expense immediately allocated',t.status='ALLOCATED'
        AND t.final_allocation='COMPANY_OVERHEAD' AND t.proposed_allocation='COMPANY_OVERHEAD'
        AND t.allocated_by_employee_id IS NULL AND t.allocated_at IS NOT NULL AND t.source='TELEGRAM'
        AND t.submitter_employee_id=k AND t.origin_telegram_chat_id=chat AND t.submission_target_chat_id=chat
        AND t.submission_confirmation_status='PENDING' AND t.decision_notification_status='NOT_REQUIRED'
        AND t.sheet_sync_status='PENDING' AND t.revision=1 AND t.commission_pool_cents IS NULL
        AND t.original_submission=jsonb_build_object('reference',prefix || 'overhead','description','QA expense',
            'amount_cents','8000','expense_category','TRAVEL','proposed_allocation','COMPANY_OVERHEAD'));
    PERFORM pg_temp.expense_e(u+70,person,chat,prefix || 'project-expense');
    result := pg_temp.answer_e(u+75,person,chat,'B');
    PERFORM pg_temp.check_e('27 project expense awaits allocation with no final allocation',
        (SELECT status='AWAITING_ALLOCATION' AND final_allocation IS NULL AND allocated_at IS NULL
            FROM public.transactions WHERE id=(result->'transaction'->>'id')::uuid));

    -- Simulate an administrative mapping change that bypassed session cleanup.
    PERFORM public.telegram_set_link(m,person,r);
    PERFORM pg_temp.sale_e(u+80,person,chat,prefix || 'stale');
    UPDATE public.telegram_links SET employee_id=k WHERE telegram_user_id=person;
    result := pg_temp.answer_e(u+88,person,chat,'50');
    PERFORM pg_temp.check_e('28 final RPC independently checks current mapping',result->>'outcome'='STALE_SESSION'
        AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE reference=prefix || 'stale')
        AND public.telegram_read_session(person) IS NULL);
    PERFORM public.telegram_set_link(m,person,r);
    PERFORM pg_temp.sale_e(u+90,person,chat,prefix || 'role-changed');
    UPDATE public.employees SET role='EXPENSE_REPORTER' WHERE id=r;
    PERFORM pg_temp.check_e('29 final RPC checks current stored role',pg_temp.answer_e(u+98,person,chat,'50')->>'outcome'='STALE_SESSION'
        AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE reference=prefix || 'role-changed'));
    UPDATE public.employees SET role='SALESPERSON' WHERE id=r;

    PERFORM public.telegram_apply_update(u+100,other_person,other_chat,'START');
    PERFORM public.telegram_set_link(m,other_person,a);
    PERFORM public.telegram_apply_update(u+101,other_person,other_chat,'SALE');
    PERFORM public.telegram_apply_update(u+102,person,chat,'SALE');
    PERFORM public.telegram_set_link(m,other_person,r);
    PERFORM pg_temp.check_e('30 remap replaces target and unmaps previous owner atomically',
        (SELECT employee_id=r FROM public.telegram_links WHERE telegram_user_id=other_person)
        AND (SELECT employee_id IS NULL FROM public.telegram_links WHERE telegram_user_id=person)
        AND public.telegram_read_session(person) IS NULL AND public.telegram_read_session(other_person) IS NULL
        AND (SELECT to_jsonb(x)=before_row FROM public.transactions x WHERE id=sale_id));
    PERFORM public.telegram_set_link(m,person,m);
    PERFORM pg_temp.check_e('31 manager cannot submit routine sale or expense',
        public.telegram_apply_update(u+103,person,chat,'SALE')->>'outcome'='FORBIDDEN'
        AND public.telegram_apply_update(u+104,person,chat,'EXPENSE')->>'outcome'='FORBIDDEN');

    PERFORM public.telegram_mark_confirmation(sale_id,true);
    PERFORM pg_temp.check_e('32 confirmation SENT has time and cleared error with no business revision',
        (SELECT submission_confirmation_status='SENT' AND submission_sent_at IS NOT NULL AND submission_last_error IS NULL
            AND revision=1 AND origin_telegram_chat_id=chat AND status='PENDING_APPROVAL' FROM public.transactions WHERE id=sale_id));
    PERFORM public.telegram_mark_confirmation(sale_id,false);
    PERFORM pg_temp.check_e('33 late failure cannot downgrade SENT',(SELECT submission_confirmation_status='SENT' FROM public.transactions WHERE id=sale_id));
    PERFORM public.telegram_mark_confirmation(expense_id,false);
    PERFORM pg_temp.check_e('34 failed delivery retains saved expense and target',
        (SELECT submission_confirmation_status='FAILED' AND submission_sent_at IS NULL AND submission_last_error='Telegram delivery failed.'
            AND status='ALLOCATED' AND amount_cents=8000 AND revision=1 AND submission_target_chat_id=chat
            FROM public.transactions WHERE id=expense_id));

    PERFORM public.telegram_set_link(m,person,r);
    PERFORM pg_temp.sale_e(u+120,person,chat,prefix || 'bad-split');
    UPDATE public.telegram_sessions SET draft_payload=draft_payload ||
        '{"proposed_richard_pct":"60","proposed_anastasia_pct":"30"}' WHERE telegram_user_id=person;
    before_session := public.telegram_read_session(person);
    result := pg_temp.answer_e(u+128,person,chat,'20');
    PERFORM pg_temp.check_e('35 exact 60/30/20 rejected with unchanged wizard and no row',result->>'outcome'='INVALID'
        AND public.telegram_read_session(person)=before_session
        AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE reference=prefix || 'bad-split'));
    UPDATE public.telegram_sessions SET draft_payload=draft_payload - 'customer' ||
        '{"proposed_richard_pct":"12.5","proposed_anastasia_pct":"37.5"}' WHERE telegram_user_id=person;
    result := pg_temp.answer_e(u+129,person,chat,'50');
    PERFORM pg_temp.check_e('36 persisted missing required field rejected defensively',result->>'outcome'='INVALID'
        AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE reference=prefix || 'bad-split'));
    PERFORM public.telegram_apply_update(u+130,person,chat,'SALE');
    PERFORM pg_temp.check_e('37 restarting sale replaces unfinished wizard',
        (public.telegram_read_session(person)->>'step')='reference'
        AND (public.telegram_read_session(person)->'draft_payload')='{}'::jsonb);
    before_session := public.telegram_read_session(person);
    PERFORM public.telegram_set_link(m,person,r);
    PERFORM pg_temp.check_e('38 same mapping preserves unfinished wizard',public.telegram_read_session(person)=before_session);
    UPDATE public.employees SET active=false WHERE id=r;
    result := pg_temp.answer_e(u+131,person,chat,prefix || 'inactive');
    PERFORM pg_temp.check_e('39 inactive employee rejects and clears wizard',result->>'outcome'='STALE_SESSION'
        AND public.telegram_read_session(person) IS NULL);
END;
$$;

SELECT * FROM pg_temp.block_e_results ORDER BY scenario;
SELECT count(*) AS passed FROM pg_temp.block_e_results;
ROLLBACK;

DO $$
DECLARE p pg_temp.block_e_prestate%ROWTYPE;
BEGIN
    SELECT * INTO STRICT p FROM pg_temp.block_e_prestate;
    IF EXISTS(SELECT 1 FROM public.transactions WHERE starts_with(reference,p.prefix))
        OR md5(coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM public.transactions t),'[]')) IS DISTINCT FROM p.transactions_digest THEN
        RAISE EXCEPTION 'Block E QA FAIL: transaction restoration after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_links t),'[]') IS DISTINCT FROM p.links THEN
        RAISE EXCEPTION 'Block E QA FAIL: link restoration after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY telegram_user_id) FROM public.telegram_sessions t),'[]') IS DISTINCT FROM p.sessions THEN
        RAISE EXCEPTION 'Block E QA FAIL: session restoration after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY update_id) FROM public.telegram_updates t),'[]') IS DISTINCT FROM p.updates THEN
        RAISE EXCEPTION 'Block E QA FAIL: update restoration after rollback';
    END IF;
    IF coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.employees t),'[]') IS DISTINCT FROM p.employees THEN
        RAISE EXCEPTION 'Block E QA FAIL: employee restoration after rollback';
    END IF;
END;
$$;
SELECT 'PASS: all five application tables restored after rollback' AS rollback_verification;
