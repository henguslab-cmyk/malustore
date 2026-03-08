alter table public.products
  add column if not exists image_urls text[] not null default '{}';
