-- 0019_transactions_country_cardtype.sql
-- Phase 7 / DM-01 + DM-02: promote wl_issuing_country + card_type from
-- stg_orderbird_order_items onto public.transactions and backfill historical
-- rows atomically. Also refreshes transactions_filterable_v to expose the
-- new country column for FLT-05.
--
-- GROUND-TRUTH DEVIATIONS from 07-CONTEXT.md D-03/D-04 (recorded in 07-02 SUMMARY):
--
--   1. `wl_card_type` is a Debit/Credit funding indicator, NOT a card network.
--      The authoritative network lives in `wl_payment_type` (Visa / Mastercard
--      / Maestro). COALESCE precedence is therefore:
--         wl_payment_type → wl_card_type → POS card_type
--      (Worldline-first, POS fallback is preserved; the change is which
--      Worldline column wins.)
--
--   2. `wl_issuing_country` in staging is a full country NAME ("Germany",
--      "Japan") not an ISO-3166-1 alpha-2 code. DM-01 still mandates
--      transactions.wl_issuing_country as char(2), so this migration installs
--      a public.country_name_to_iso2() helper covering every distinct value
--      observed in DEV (60 countries) and uses it in the inline backfill.
--      Unknown names fall through to NULL (surfaced as "Unknown" per D-06).

begin;

-- ---------------------------------------------------------------------------
-- 1. Schema promotion
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column wl_issuing_country char(2),
  add column card_type          text;

comment on column public.transactions.wl_issuing_country is
  'ISO-3166-1 alpha-2 issuing country from Worldline. NULL for cash, blackout (Apr 2026), and unmapped tourist rows. Populated by 0019 backfill via public.country_name_to_iso2(stg.wl_issuing_country).';

comment on column public.transactions.card_type is
  'Canonical card network: visa | mastercard | amex | maestro | girocard | other | unknown. Normalized at ingest by public.normalize_card_type() in SQL and canonicalizeCardType() in TS (byte-identical). No CHECK constraint — enforced at loader.';

-- ---------------------------------------------------------------------------
-- 2. public.normalize_card_type(raw text) — canonical network mapper
-- ---------------------------------------------------------------------------
-- Must stay byte-identical to scripts/ingest/normalize.ts canonicalizeCardType.
-- Both sides are verified against tests/ingest/fixtures/canonical-card-types.json
-- in 07-03.
create or replace function public.normalize_card_type(raw text)
returns text
language sql
immutable
as $$
  with norm as (
    select lower(regexp_replace(btrim(coalesce(raw, '')), '\s+', ' ', 'g')) as k
  )
  select case
    when (select k from norm) = '' then 'unknown'
    -- Visa family (explicit variants + prefix match for "visa *")
    when (select k from norm) in ('visa','visa debit','visa credit','visa prepaid','visa dkb','chase visa') then 'visa'
    when (select k from norm) like 'visa %' then 'visa'
    when (select k from norm) like '% visa' then 'visa'
    -- Mastercard family
    when (select k from norm) in ('mastercard','mc','master card','mastercard debit','kebhana master') then 'mastercard'
    when (select k from norm) like 'mastercard %' then 'mastercard'
    when (select k from norm) like '% mastercard' then 'mastercard'
    -- Amex
    when (select k from norm) in ('amex','american express') then 'amex'
    -- Maestro / V PAY (Visa's debit EU scheme — historically grouped with maestro)
    when (select k from norm) in ('maestro','v pay','vpay') then 'maestro'
    -- Girocard / EC Karte
    when (select k from norm) in ('girocard','ec','ec karte','ec-karte','eckarte') then 'girocard'
    -- Bare debit/credit indicator — network unknown
    when (select k from norm) in ('debit','credit','commercial','commercialdebit','commercial debit') then 'unknown'
    else 'other'
  end;
$$;

comment on function public.normalize_card_type(text) is
  'Phase 7: map a raw Orderbird/Worldline card-type string to the canonical bucket {visa,mastercard,amex,maestro,girocard,other,unknown}. Byte-identical to scripts/ingest/normalize.ts canonicalizeCardType. Idempotent-safe: normalize(normalize(x)) = normalize(x) for all x in the canonical set.';

-- ---------------------------------------------------------------------------
-- 3. public.country_name_to_iso2(name text) — Worldline country-name → ISO-2
-- ---------------------------------------------------------------------------
-- Covers every distinct value observed in DEV stg_orderbird_order_items on
-- 2026-04-16 (60 distinct names). Any future unseen name returns NULL (safe
-- default per D-06: NULL is first-class and surfaced as "Unknown").
create or replace function public.country_name_to_iso2(name text)
returns char(2)
language sql
immutable
as $$
  select case btrim(coalesce(name, ''))
    when ''                         then null
    when 'Germany'                  then 'DE'
    when 'Austria'                  then 'AT'
    when 'Switzerland'              then 'CH'
    when 'France'                   then 'FR'
    when 'Italy'                    then 'IT'
    when 'Spain'                    then 'ES'
    when 'Portugal'                 then 'PT'
    when 'Netherlands'              then 'NL'
    when 'Belgium'                  then 'BE'
    when 'Luxembourg'               then 'LU'
    when 'Ireland'                  then 'IE'
    when 'United Kingdom'           then 'GB'
    when 'Denmark'                  then 'DK'
    when 'Sweden'                   then 'SE'
    when 'Norway'                   then 'NO'
    when 'Finland'                  then 'FI'
    when 'Iceland'                  then 'IS'
    when 'Poland'                   then 'PL'
    when 'Czechia'                  then 'CZ'
    when 'Czech Republic'           then 'CZ'
    when 'Slovakia'                 then 'SK'
    when 'Slovenia'                 then 'SI'
    when 'Hungary'                  then 'HU'
    when 'Romania'                  then 'RO'
    when 'Bulgaria'                 then 'BG'
    when 'Croatia'                  then 'HR'
    when 'Serbia'                   then 'RS'
    when 'Bosnia and Herzegovina'   then 'BA'
    when 'North Macedonia'          then 'MK'
    when 'Greece'                   then 'GR'
    when 'Turkey'                   then 'TR'
    when 'Cyprus'                   then 'CY'
    when 'Malta'                    then 'MT'
    when 'Estonia'                  then 'EE'
    when 'Latvia'                   then 'LV'
    when 'Lithuania'                then 'LT'
    when 'Ukraine'                  then 'UA'
    when 'Belarus'                  then 'BY'
    when 'Russia'                   then 'RU'
    when 'Russian Federation'       then 'RU'
    when 'Moldova'                  then 'MD'
    when 'Georgia'                  then 'GE'
    when 'Armenia'                  then 'AM'
    when 'Azerbaijan'               then 'AZ'
    when 'Kazakhstan'               then 'KZ'
    when 'Kyrgyzstan'               then 'KG'
    when 'United States'            then 'US'
    when 'Canada'                   then 'CA'
    when 'Mexico'                   then 'MX'
    when 'Brazil'                   then 'BR'
    when 'Argentina'                then 'AR'
    when 'Colombia'                 then 'CO'
    when 'Paraguay'                 then 'PY'
    when 'Japan'                    then 'JP'
    when 'China'                    then 'CN'
    when 'Hong Kong'                then 'HK'
    when 'Taiwan, Province of China' then 'TW'
    when 'Taiwan'                   then 'TW'
    when 'Korea, Republic of'       then 'KR'
    when 'South Korea'              then 'KR'
    when 'Singapore'                then 'SG'
    when 'Malaysia'                 then 'MY'
    when 'Thailand'                 then 'TH'
    when 'Philippines'              then 'PH'
    when 'India'                    then 'IN'
    when 'Nepal'                    then 'NP'
    when 'Australia'                then 'AU'
    when 'New Zealand'              then 'NZ'
    when 'Israel'                   then 'IL'
    when 'United Arab Emirates'     then 'AE'
    when 'South Africa'             then 'ZA'
    else null
  end;
$$;

comment on function public.country_name_to_iso2(text) is
  'Phase 7: map a Worldline country name to ISO-3166-1 alpha-2. Returns NULL for unknown names (first-class NULL per D-06). Coverage: all 60 distinct names observed in DEV stg_orderbird_order_items on 2026-04-16 plus common aliases.';

-- ---------------------------------------------------------------------------
-- 4. Inline backfill — one DISTINCT ON per (restaurant_id, invoice_number)
-- ---------------------------------------------------------------------------
-- Line items within an invoice carry identical Worldline values (proven in
-- 07-RESEARCH Focus Q1). ORDER BY row_index makes the pick reproducible for
-- the edge case where all rows of an invoice are Worldline-empty and we fall
-- through to the POS card_type (which is row-stable too).
update public.transactions t
   set wl_issuing_country = src.iso2,
       card_type          = src.card_type_canonical
  from (
    select distinct on (stg.restaurant_id, stg.invoice_number)
           stg.restaurant_id,
           stg.invoice_number,
           public.country_name_to_iso2(nullif(btrim(stg.wl_issuing_country), '')) as iso2,
           public.normalize_card_type(
             coalesce(
               nullif(btrim(stg.wl_payment_type), ''),   -- authoritative network
               nullif(btrim(stg.wl_card_type),    ''),   -- Debit/Credit indicator (rare hit)
               nullif(btrim(stg.card_type),       '')    -- POS fallback for blackout window
             )
           ) as card_type_canonical
      from public.stg_orderbird_order_items stg
     order by stg.restaurant_id, stg.invoice_number, stg.row_index
  ) src
 where t.restaurant_id = src.restaurant_id
   and t.source_tx_id  = src.invoice_number;

-- ---------------------------------------------------------------------------
-- 5. Refresh transactions_filterable_v to expose wl_issuing_country
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE VIEW append-column rule: existing columns keep name/type/
-- position, new column appended at end. Preserves security_invoker + JWT
-- WHERE clause (ci-guards Guard 1) and the existing grant.
create or replace view public.transactions_filterable_v
with (security_invoker = true) as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  t.wl_issuing_country
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

commit;
