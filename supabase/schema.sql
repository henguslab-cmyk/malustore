-- MaluStore marketplace schema for Supabase (PostgreSQL)

-- Optional helper extension
create extension if not exists pgcrypto;

-- 1) Profiles (linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Categories
create table if not exists public.categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- 3) Products
create table if not exists public.products (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  category_id bigint references public.categories(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) Cart items
create table if not exists public.cart_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

-- 5) Orders
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paid','shipped','delivered','cancelled')),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  shipping_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6) Order items
create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_products_seller_id on public.products(seller_id);
create index if not exists idx_products_category_id on public.products(category_id);
create index if not exists idx_products_is_active on public.products(is_active);
create index if not exists idx_cart_items_user_id on public.cart_items(user_id);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_orders_buyer_id on public.orders(buyer_id);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_cart_items_updated_at on public.cart_items;
create trigger trg_cart_items_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Basic RLS policies
-- profiles: user can read/update own profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- categories: public read
drop policy if exists "categories_select_all" on public.categories;
create policy "categories_select_all"
on public.categories for select
using (true);

-- products: public read active, seller manages own products
drop policy if exists "products_select_active" on public.products;
create policy "products_select_active"
on public.products for select
using (is_active = true);

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own"
on public.products for insert
with check (auth.uid() = seller_id);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own"
on public.products for update
using (auth.uid() = seller_id)
with check (auth.uid() = seller_id);

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own"
on public.products for delete
using (auth.uid() = seller_id);

-- cart: user manages own cart
drop policy if exists "cart_select_own" on public.cart_items;
create policy "cart_select_own"
on public.cart_items for select
using (auth.uid() = user_id);

drop policy if exists "cart_insert_own" on public.cart_items;
create policy "cart_insert_own"
on public.cart_items for insert
with check (auth.uid() = user_id);

drop policy if exists "cart_update_own" on public.cart_items;
create policy "cart_update_own"
on public.cart_items for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "cart_delete_own" on public.cart_items;
create policy "cart_delete_own"
on public.cart_items for delete
using (auth.uid() = user_id);

-- orders: buyer reads/inserts own orders
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
on public.orders for select
using (auth.uid() = buyer_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
on public.orders for insert
with check (auth.uid() = buyer_id);

-- order items: buyer can read items from own orders
drop policy if exists "order_items_select_own_order" on public.order_items;
create policy "order_items_select_own_order"
on public.order_items for select
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.buyer_id = auth.uid()
  )
);

-- Optional seed data
insert into public.categories (name, slug)
values
  ('Eletronicos', 'eletronicos'),
  ('Moda', 'moda'),
  ('Casa', 'casa')
on conflict (slug) do nothing;
