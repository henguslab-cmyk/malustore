-- 1) Profiles: add role for admin/customer
alter table public.profiles
  add column if not exists role text not null default 'customer'
  check (role in ('customer', 'admin'));

-- allow user to create own profile row after signup
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

-- 2) Products: extra fields required by product registration
alter table public.products
  add column if not exists sizes text[] default '{}',
  add column if not exists material text,
  add column if not exists brand text;

-- 3) Restrict product write to admins only
drop policy if exists "products_insert_own" on public.products;
drop policy if exists "products_update_own" on public.products;
drop policy if exists "products_delete_own" on public.products;

drop policy if exists "products_insert_admin" on public.products;
create policy "products_insert_admin"
on public.products for insert
with check (
  auth.uid() = seller_id
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "products_update_admin" on public.products;
create policy "products_update_admin"
on public.products for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "products_delete_admin" on public.products;
create policy "products_delete_admin"
on public.products for delete
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- 4) Storage bucket for product images
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- public can read product images
drop policy if exists "product_images_select_public" on storage.objects;
create policy "product_images_select_public"
on storage.objects for select
using (bucket_id = 'product-images');

-- only admins can upload/update/delete product images
drop policy if exists "product_images_insert_admin" on storage.objects;
create policy "product_images_insert_admin"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "product_images_update_admin" on storage.objects;
create policy "product_images_update_admin"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "product_images_delete_admin" on storage.objects;
create policy "product_images_delete_admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
