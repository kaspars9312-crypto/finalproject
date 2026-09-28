-- Run AFTER both migrations, as the authorized Supabase migration owner.
-- Run the ENTIRE file in one connection. psql: -v ON_ERROR_STOP=1 -f <file>.
-- No external calls, extensions, persistent fixtures or Test 1/Test 2 references.
-- If execution stops on an unexpected error, ROLLBACK before reusing the connection.
-- This script checks real PostgreSQL semantics and stale interleavings sequentially;
-- it does not pretend that a single connection is a simultaneous-session load test.
-- Commit only temporary QA prestate before the test transaction. Explicit COMMIT
-- makes this survive the test ROLLBACK even in a batched SQL Editor execution.
-- Run in a dedicated session with no unrelated uncommitted work. A rerun replaces
-- only this session's temporary prestate; no application-table change is committed.
BEGIN;
DROP TABLE IF EXISTS pg_temp.block_d_prestate;
CREATE TEMP TABLE block_d_prestate (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    qa_prefix text NOT NULL,
    links_before jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.block_d_prestate (qa_prefix, links_before)
SELECT 'QA-BLOCK-D-' || gen_random_uuid()::text || '-',
    coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY telegram_user_id)
        FROM public.telegram_links l), '[]'::jsonb);
GRANT SELECT ON pg_temp.block_d_prestate TO service_role;
COMMIT;

-- Every application-table mutation below is inside BEGIN / ROLLBACK.
BEGIN;

CREATE TEMP TABLE block_d_results (scenario text PRIMARY KEY, result text NOT NULL, detail text) ON COMMIT DROP;
GRANT SELECT, INSERT ON block_d_results TO service_role;

CREATE FUNCTION pg_temp.check_d(p_scenario text, p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'Block D QA FAIL: %', p_scenario;
    END IF;
    INSERT INTO pg_temp.block_d_results VALUES
        (p_scenario, 'PASS', NULL);
END;
$$;
CREATE FUNCTION pg_temp.error_d(p_scenario text, p_sql text, p_expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_code text;
BEGIN
    -- A subtransaction always rolls back an unexpected successful mutation too.
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION USING ERRCODE = 'ZD001', MESSAGE = 'Unexpected success';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    -- Outside the exception-catching subtransaction: never swallow a QA failure.
    IF v_code IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Block D QA FAIL: % (expected SQLSTATE %, got %)',
            p_scenario, p_expected, v_code;
    END IF;
    INSERT INTO pg_temp.block_d_results VALUES
        (p_scenario, 'PASS',
         'expected ' || p_expected || ', got ' || v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.check_d(text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.error_d(text,text,text) TO service_role;

-- Check privileges as owner, then exercise all business operations as service_role.
DO $$
DECLARE v_fn record; v_count integer := 0;
BEGIN
    FOR v_fn IN SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN (
            'create_website_sale', 'create_website_expense', 'correct_pending_sale',
            'read_sale_for_approval', 'approve_sale', 'allocate_expense')
    LOOP
        v_count := v_count + 1;
        PERFORM pg_temp.check_d('Privileges: ' || v_fn.proname,
            has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_fn.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
            AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(v_fn.proacl, acldefault('f', v_fn.proowner)))
                WHERE grantee = 0 AND privilege_type = 'EXECUTE')
            AND NOT v_fn.prosecdef AND 'search_path=pg_catalog' = ANY(v_fn.proconfig));
    END LOOP;
    PERFORM pg_temp.check_d('Exactly six Block D function signatures', v_count = 6);
END;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
    r uuid; k uuid; m uuid; a uuid; j uuid;
    s uuid; e uuid; s_link uuid; e_link uuid; overhead uuid; tg_sale uuid; tg_expense uuid;
    prefix text;
    row_before jsonb; original_sale jsonb; original_expense jsonb; proposal jsonb;
    t public.transactions%ROWTYPE;
    v_chat bigint := 900000000000000001;
    v_other_chat bigint := 900000000000000002;
    v_origin bigint := 900000000000000003;
    v_id uuid;
BEGIN
    SELECT qa_prefix INTO STRICT prefix FROM pg_temp.block_d_prestate;
    SELECT id INTO STRICT r FROM public.employees WHERE code = 'RICHARD';
    SELECT id INTO STRICT k FROM public.employees WHERE code = 'KEVIN';
    SELECT id INTO STRICT m FROM public.employees WHERE code = 'SVETLANA';
    SELECT id INTO STRICT a FROM public.employees WHERE code = 'ANASTASIA';
    SELECT id INTO STRICT j FROM public.employees WHERE code = 'JEAN_CLAUDE';
    -- Temporary QA setup is entirely rolled back, including existing mappings.
    UPDATE public.employees SET active = true;
    UPDATE public.telegram_links SET employee_id = NULL WHERE employee_id IN (r,k,a,j);
    IF EXISTS (SELECT 1 FROM public.telegram_links WHERE telegram_user_id IN (v_chat,v_other_chat)) THEN
        RAISE EXCEPTION 'QA identity collision; choose unused fake IDs before rerunning';
    END IF;

    s := (public.create_website_sale(r,prefix || 'sale','Original customer','A','Original description',100000,50,30,20)->>'id')::uuid;
    SELECT * INTO STRICT t FROM public.transactions WHERE id = s;
    original_sale := t.original_submission;
    PERFORM pg_temp.check_d('01 Richard creates website sale / revision 1 / original snapshot',
        t.status = 'PENDING_APPROVAL' AND t.revision = 1 AND t.source = 'WEBSITE'
        AND t.submitter_employee_id = r AND t.customer = 'Original customer' AND t.project = 'A'
        AND t.description = 'Original description' AND t.amount_cents = 100000
        AND t.final_richard_pct IS NULL AND t.final_anastasia_pct IS NULL AND t.final_jean_claude_pct IS NULL
        AND t.commission_pool_cents = 0 AND t.richard_commission_cents = 0
        AND t.anastasia_commission_cents = 0 AND t.jean_claude_commission_cents = 0
        AND t.origin_telegram_chat_id IS NULL AND t.submission_confirmation_status = 'NOT_REQUIRED'
        AND t.decision_notification_status = 'NOT_REQUIRED' AND t.decision_target_chat_id IS NULL
        AND t.sheet_sync_status = 'PENDING' AND original_sale = jsonb_build_object(
            'reference',prefix || 'sale','customer','Original customer','project','A',
            'description','Original description','amount_cents','100000',
            'proposed_richard_pct','50','proposed_anastasia_pct','30','proposed_jean_claude_pct','20'));
    PERFORM pg_temp.error_d('02 Kevin cannot create sale',format(
        'SELECT public.create_website_sale(%L,%L,''C'',''A'',''D'',100,50,30,20)',k,prefix || 'denied-sale'),'BD001');
    e := (public.create_website_expense(k,prefix || 'expense','Original expense',8000,'TRAVEL','B')->>'id')::uuid;
    SELECT * INTO STRICT t FROM public.transactions WHERE id = e;
    original_expense := t.original_submission;
    PERFORM pg_temp.check_d('03 Kevin creates website expense / revision 1 / awaiting',
        t.status = 'AWAITING_ALLOCATION' AND t.revision = 1 AND t.source = 'WEBSITE'
        AND t.submitter_employee_id = k AND t.final_allocation IS NULL
        AND t.allocated_by_employee_id IS NULL AND t.allocated_at IS NULL
        AND t.sheet_sync_status = 'PENDING' AND t.submission_confirmation_status = 'NOT_REQUIRED'
        AND t.decision_notification_status = 'NOT_REQUIRED'
        AND original_expense = jsonb_build_object('reference',prefix || 'expense',
            'description','Original expense','amount_cents','8000','expense_category','TRAVEL','proposed_allocation','B'));
    PERFORM pg_temp.error_d('04 Richard cannot create expense',format(
        'SELECT public.create_website_expense(%L,%L,''D'',100,''OTHER'',''A'')',r,prefix || 'denied-expense'),'BD001');
    PERFORM pg_temp.error_d('05 Duplicate reference across transaction types',format(
        'SELECT public.create_website_expense(%L,%L,''D'',100,''OTHER'',''A'')',k,prefix || 'sale'),'BD005');
    PERFORM pg_temp.check_d('05b Duplicate left exactly one transaction',
        (SELECT count(*) = 1 FROM public.transactions WHERE reference = prefix || 'sale'));
    FOREACH v_id IN ARRAY ARRAY[m,k] LOOP
        PERFORM pg_temp.error_d('Manager / reporter sale denied ' || v_id,format(
            'SELECT public.create_website_sale(%L,%L,''C'',''A'',''D'',100,50,30,20)',v_id,prefix || 'denied'),'BD001');
    END LOOP;
    PERFORM pg_temp.error_d('Manager expense submission denied',format(
        'SELECT public.create_website_expense(%L,%L,''D'',100,''OTHER'',''A'')',m,prefix || 'denied'),'BD001');
    UPDATE public.employees SET active = false WHERE id = r;
    PERFORM pg_temp.error_d('Inactive salesperson denied',format(
        'SELECT public.create_website_sale(%L,%L,''C'',''A'',''D'',100,50,30,20)',r,prefix || 'inactive'),'BD001');
    UPDATE public.employees SET active = true WHERE id = r;

    UPDATE public.transactions SET sheet_sync_status = 'FAILED', sheet_last_error = 'QA',
        sheet_sync_started_at = now(), updated_at = now() - interval '1 day' WHERE id = s;
    PERFORM public.correct_pending_sale(m,s,1,'Corrected customer','B','Corrected description',200000);
    SELECT * INTO STRICT t FROM public.transactions WHERE id = s;
    PERFORM pg_temp.check_d('06+08 Correction / revision / original and pending commissions',
        t.revision = 2 AND t.customer = 'Corrected customer' AND t.project = 'B'
        AND t.description = 'Corrected description' AND t.amount_cents = 200000
        AND t.original_submission = original_sale AND t.proposed_richard_pct = 50
        AND t.proposed_anastasia_pct = 30 AND t.proposed_jean_claude_pct = 20
        AND t.final_richard_pct IS NULL AND t.final_anastasia_pct IS NULL AND t.final_jean_claude_pct IS NULL
        AND t.commission_pool_cents = 0 AND t.richard_commission_cents = 0
        AND t.anastasia_commission_cents = 0 AND t.jean_claude_commission_cents = 0
        AND t.decision_notification_status = 'NOT_REQUIRED' AND t.sheet_sync_status = 'PENDING'
        AND t.sheet_last_error IS NULL AND t.sheet_sync_started_at IS NULL AND t.updated_at = now());
    row_before := to_jsonb(t);
    PERFORM pg_temp.error_d('07 Non-manager correction denied',format(
        'SELECT public.correct_pending_sale(%L,%L,2,''C'',''A'',''D'',1)',r,s),'BD001');
    PERFORM pg_temp.error_d('09 Stale correction fails',format(
        'SELECT public.correct_pending_sale(%L,%L,1,''C'',''A'',''D'',1)',m,s),'BD003');
    PERFORM pg_temp.error_d('16 Correction wins against old approval revision',format(
        'SELECT public.approve_sale(%L,%L,1,50,30,20,10000,5000,3000,2000)',m,s),'BD003');
    PERFORM pg_temp.error_d('Non-manager approval denied',format(
        'SELECT public.approve_sale(%L,%L,2,50,30,20,20000,10000,6000,4000)',r,s),'BD001');
    PERFORM pg_temp.check_d('Rejected correction/approval leave entire row unchanged',
        (SELECT to_jsonb(x) = row_before FROM public.transactions x WHERE id = s));
    PERFORM pg_temp.error_d('Invalid approval rolls back all financial and delivery fields',format(
        'SELECT public.approve_sale(%L,%L,2,50,30,20,7,3,2,2)',m,s),'23514');
    PERFORM pg_temp.check_d('Invalid approval has no partial write',
        (SELECT to_jsonb(x) = row_before FROM public.transactions x WHERE id = s));

    PERFORM public.approve_sale(m,s,2,20,40,40,20000,4000,8000,8000);
    SELECT * INTO STRICT t FROM public.transactions WHERE id = s;
    PERFORM pg_temp.check_d('10+11 Approval final commissions / audit / revision',
        t.status = 'APPROVED' AND t.revision = 3 AND t.final_richard_pct = 20
        AND t.final_anastasia_pct = 40 AND t.final_jean_claude_pct = 40
        AND t.commission_pool_cents = 20000 AND t.richard_commission_cents = 4000
        AND t.anastasia_commission_cents = 8000 AND t.jean_claude_commission_cents = 8000
        AND t.approved_by_employee_id = m AND t.approved_at = now() AND t.updated_at = now());
    PERFORM pg_temp.check_d('12+13 Durable approval intent / no website recipient',
        t.sheet_sync_status = 'PENDING' AND t.sheet_last_error IS NULL AND t.sheet_sync_started_at IS NULL
        AND t.decision_notification_status = 'NO_RECIPIENT' AND t.decision_target_chat_id IS NULL
        AND t.decision_last_error IS NULL AND t.decision_sent_at IS NULL);
    PERFORM pg_temp.check_d('21 Sale snapshot and immutable identity survive decisions',
        t.original_submission = original_sale AND t.reference = prefix || 'sale'
        AND t.submitter_employee_id = r AND t.source = 'WEBSITE' AND t.submitted_at = now()
        AND t.proposed_richard_pct = 50 AND t.proposed_anastasia_pct = 30 AND t.proposed_jean_claude_pct = 20);
    row_before := to_jsonb(t);
    PERFORM pg_temp.error_d('15 Double approval rejected even with new revision',format(
        'SELECT public.approve_sale(%L,%L,3,100,0,0,20000,20000,0,0)',m,s),'BD003');
    PERFORM pg_temp.error_d('Approval wins against subsequent correction',format(
        'SELECT public.correct_pending_sale(%L,%L,3,''C'',''A'',''D'',1)',m,s),'BD003');
    PERFORM pg_temp.check_d('Double approval/correction cannot change finalized row',
        (SELECT to_jsonb(x) = row_before FROM public.transactions x WHERE id = s));

    s_link := (public.create_website_sale(j,prefix || 'late-link','C','A','D',100,50,30,20)->>'id')::uuid;
    INSERT INTO public.telegram_links VALUES(v_chat,j,v_chat,now());
    PERFORM public.approve_sale(m,s_link,1,50,30,20,10,5,3,2);
    SELECT * INTO STRICT t FROM public.transactions WHERE id = s_link;
    PERFORM pg_temp.check_d('14 Website link added after submission resolved at approval',
        t.decision_target_chat_id = v_chat AND t.decision_notification_status = 'PENDING');
    row_before := to_jsonb(t);
    UPDATE public.telegram_links SET last_private_chat_id = v_other_chat WHERE employee_id = j;
    PERFORM pg_temp.error_d('Retry cannot redirect a frozen target',format(
        'SELECT public.approve_sale(%L,%L,2,50,30,20,10,5,3,2)',m,s_link),'BD003');
    PERFORM pg_temp.check_d('Retry retains complete row and old recipient',
        (SELECT to_jsonb(x) = row_before FROM public.transactions x WHERE id = s_link));

    PERFORM pg_temp.error_d('Non-manager allocation denied',format(
        'SELECT public.allocate_expense(%L,%L,1,''A'')',k,e),'BD001');
    PERFORM pg_temp.error_d('Stale allocation rejected',format(
        'SELECT public.allocate_expense(%L,%L,2,''A'')',m,e),'BD003');
    PERFORM public.allocate_expense(m,e,1,'A');
    SELECT * INTO STRICT t FROM public.transactions WHERE id = e;
    PERFORM pg_temp.check_d('17+18+21 Allocation / original B vs final A / same expense',
        t.status = 'ALLOCATED' AND t.revision = 2 AND t.proposed_allocation = 'B' AND t.final_allocation = 'A'
        AND t.amount_cents = 8000 AND t.original_submission = original_expense
        AND t.allocated_by_employee_id = m AND t.allocated_at = now()
        AND t.decision_notification_status = 'NO_RECIPIENT' AND t.decision_target_chat_id IS NULL
        AND t.sheet_sync_status = 'PENDING' AND t.decision_last_error IS NULL AND t.decision_sent_at IS NULL);
    row_before := to_jsonb(t);
    PERFORM pg_temp.error_d('19 Double allocation rejected',format(
        'SELECT public.allocate_expense(%L,%L,2,''B'')',m,e),'BD003');
    PERFORM pg_temp.check_d('19b Double allocation leaves row and expense count unchanged',
        (SELECT to_jsonb(x) = row_before FROM public.transactions x WHERE id = e)
        AND (SELECT count(*) = 1 AND sum(amount_cents) = 8000 FROM public.transactions WHERE reference = prefix || 'expense'));

    e_link := (public.create_website_expense(k,prefix || 'late-expense','D',100,'OTHER','A')->>'id')::uuid;
    INSERT INTO public.telegram_links VALUES(v_other_chat,k,v_other_chat,now());
    PERFORM public.allocate_expense(m,e_link,1,'COMPANY_OVERHEAD');
    PERFORM pg_temp.check_d('Website expense freezes link added before allocation',
        (SELECT decision_target_chat_id = v_other_chat AND decision_notification_status = 'PENDING'
            AND final_allocation = 'COMPANY_OVERHEAD' AND proposed_allocation = 'A'
            FROM public.transactions WHERE id = e_link));
    overhead := (public.create_website_expense(k,prefix || 'overhead','D',100,'OTHER','COMPANY_OVERHEAD')->>'id')::uuid;
    PERFORM pg_temp.check_d('Automatic overhead is allocated at revision 1 without decision intent',
        (SELECT status = 'ALLOCATED' AND revision = 1 AND final_allocation = 'COMPANY_OVERHEAD'
            AND allocated_by_employee_id IS NULL AND allocated_at = now()
            AND decision_notification_status = 'NOT_REQUIRED' AND decision_target_chat_id IS NULL
            FROM public.transactions WHERE id = overhead));
    PERFORM pg_temp.error_d('Automatic overhead cannot be manager allocated again',format(
        'SELECT public.allocate_expense(%L,%L,1,''A'')',m,overhead),'BD003');

    -- Simulate future bot rows by fixture-only source/origin changes BEFORE decisions.
    -- The application contains no Telegram creation operation or bot flow.
    tg_sale := (public.create_website_sale(j,prefix || 'telegram-sale','C','A','D',100,50,30,20)->>'id')::uuid;
    tg_expense := (public.create_website_expense(k,prefix || 'telegram-expense','D',100,'OTHER','B')->>'id')::uuid;
    UPDATE public.transactions SET source = 'TELEGRAM', origin_telegram_chat_id = v_origin,
        submission_confirmation_status = 'PENDING', submission_target_chat_id = v_origin
        WHERE id IN (tg_sale,tg_expense);
    SELECT original_submission INTO proposal FROM public.transactions WHERE id = tg_sale;
    PERFORM public.correct_pending_sale(m,tg_sale,1,'Corrected','B','Corrected',100);
    PERFORM public.approve_sale(m,tg_sale,2,50,30,20,10,5,3,2);
    PERFORM pg_temp.check_d('20 Telegram sale preserves origin and proposal despite different mapping',
        (SELECT decision_target_chat_id = v_origin AND origin_telegram_chat_id = v_origin
            AND decision_notification_status = 'PENDING' AND original_submission = proposal
            AND submitter_employee_id = j AND submission_target_chat_id = v_origin
            FROM public.transactions WHERE id = tg_sale));
    SELECT original_submission INTO proposal FROM public.transactions WHERE id = tg_expense;
    PERFORM public.allocate_expense(m,tg_expense,1,'A');
    PERFORM pg_temp.check_d('20b Telegram expense uses origin and preserves proposal',
        (SELECT decision_target_chat_id = v_origin AND origin_telegram_chat_id = v_origin
            AND decision_notification_status = 'PENDING' AND original_submission = proposal
            AND submitter_employee_id = k FROM public.transactions WHERE id = tg_expense));

    PERFORM pg_temp.error_d('Missing transaction distinguished',format(
        'SELECT public.allocate_expense(%L,%L,1,''A'')',m,gen_random_uuid()),'BD002');
    PERFORM pg_temp.error_d('Wrong type distinguished',format(
        'SELECT public.allocate_expense(%L,%L,3,''A'')',m,s),'BD004');
    PERFORM pg_temp.error_d('Null revision rejected',format(
        'SELECT public.correct_pending_sale(%L,%L,NULL,''C'',''A'',''D'',1)',m,s),'22023');

    -- Read RPC must serialize precise NUMERIC/BIGINT values as JSON strings.
    v_id := (public.create_website_sale(r,prefix || 'precision','C','A','D',9007199254740991,
        49.999999999999999999999999999999,50.000000000000000000000000000001,0)->>'id')::uuid;
    proposal := public.read_sale_for_approval(m,v_id);
    PERFORM pg_temp.check_d('Exact numeric wire representation',
        jsonb_typeof(proposal->'amount_cents') = 'string'
        AND proposal->>'amount_cents' = '9007199254740991'
        AND jsonb_typeof(proposal->'proposed_richard_pct') = 'string'
        AND proposal->>'proposed_richard_pct' = '49.999999999999999999999999999999');
END;
$$;

SELECT scenario, result, detail FROM pg_temp.block_d_results ORDER BY scenario;
SELECT count(*) FILTER (WHERE result = 'PASS') AS passed,
       count(*) FILTER (WHERE result = 'FAIL') AS failed FROM pg_temp.block_d_results;
ROLLBACK;

-- These are real post-rollback checks, not an assumption based on ROLLBACK text.
-- Raise named failures here too, so the last result set cannot hide a failure.
DO $$
DECLARE
    prestate pg_temp.block_d_prestate%ROWTYPE;
    actual_links jsonb;
BEGIN
    SELECT * INTO STRICT prestate FROM pg_temp.block_d_prestate;
    IF EXISTS (SELECT 1 FROM public.transactions
        WHERE starts_with(reference, prestate.qa_prefix)) THEN
        RAISE EXCEPTION 'Block D QA FAIL: 22 No QA transactions remain after rollback';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY telegram_user_id), '[]'::jsonb)
        INTO actual_links FROM public.telegram_links l;
    IF actual_links IS DISTINCT FROM prestate.links_before THEN
        RAISE EXCEPTION 'Block D QA FAIL: 22b All Telegram links restored after rollback';
    END IF;
END;
$$;

SELECT '22 No QA transactions remain after rollback' AS scenario,
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.transactions
        WHERE starts_with(reference, (SELECT qa_prefix FROM pg_temp.block_d_prestate)))
    THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT '22b All Telegram links restored after rollback',
    CASE WHEN coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY telegram_user_id)
        FROM public.telegram_links l), '[]'::jsonb) = (SELECT links_before FROM pg_temp.block_d_prestate)
    THEN 'PASS' ELSE 'FAIL' END;
