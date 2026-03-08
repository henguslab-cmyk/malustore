alter table public.products
  add column if not exists size_stock jsonb not null default '{}'::jsonb;
