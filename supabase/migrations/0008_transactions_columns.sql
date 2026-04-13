-- Phase 2 / ING-03: extend transactions with invoice-grain fields.
alter table public.transactions
  add column tip_cents       integer,
  add column payment_method  text,
  add column sales_type      text;

comment on column public.transactions.tip_cents is
  'Invoice-level tip in cents. Loader takes first row of invoice group (D-12). Phase 3 MVs sum this; they MUST NOT sum tip_eur from stg_orderbird_order_items.';
comment on column public.transactions.payment_method is
  'Canonical payment method (case-normalized in loader): Bar, MasterCard, Visa, Maestro, Visa Electron, V PAY, Auf Rechnung, Debit Mastercard, DKB Visa Debit.';
comment on column public.transactions.sales_type is
  'INHOUSE | TAKEAWAY (from CSV sales_type column).';
