-- Automatic product rows, from real orders (Products & pricing -> Product rows -> Automatic).
--   auto_product_rows() answers three lists of product page addresses:
--     bestSellers  most orders in the last 30 days
--     fastSelling  most orders in the last 7 days
--     boughtWith   per product, what was most often in the same order
--   Each order counts once for a product, however many bottles it has, so one big order or a milk plan can't take
--   over a list. Cancelled and unpaid orders don't count. A product that can't be bought now (out of stock, switched
--   off, or its page hidden) is left out. It answers only product addresses, nothing about customers.
--   The switch itself is "isAutomatic" in the product_rows setting; off, the lists picked by hand are used.
--   No table changes.
-- Safe to run again.

create or replace function public.auto_product_rows()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with order_products as (
    -- Every counted order and the product pages in it (1 litre, 500 ml and other packs are one product)
    select distinct o.id as order_id, o.placed_at, p.slug
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.product_pages p
      on (i.product_id = p.slug or i.product_id like p.slug || '-%')
     and not p.is_hidden and coalesce(p.page ->> 'status', 'published') = 'published'
    where o.status <> 'cancelled' and o.payment_status in ('not_charged', 'paid')
  ),
  can_be_bought as (
    select distinct op.slug
    from order_products op
    join public.product_cards c on c.product_id = private.stock_card_of(op.slug)
    where c.is_visible and c.stock <> 'out'
  ),
  best as (
    select op.slug, count(*) as orders
    from order_products op join can_be_bought b on b.slug = op.slug
    where op.placed_at > now() - interval '30 days'
    group by op.slug order by orders desc, op.slug limit 12
  ),
  fast as (
    select op.slug, count(*) as orders
    from order_products op join can_be_bought b on b.slug = op.slug
    where op.placed_at > now() - interval '7 days'
    group by op.slug order by orders desc, op.slug limit 12
  ),
  pairs as (
    select first_product.slug as product, second_product.slug as other, count(*) as orders,
           row_number() over (partition by first_product.slug order by count(*) desc, second_product.slug) as place
    from order_products first_product
    join order_products second_product on second_product.order_id = first_product.order_id and second_product.slug <> first_product.slug
    join can_be_bought b on b.slug = second_product.slug
    group by first_product.slug, second_product.slug
  ),
  bought_with as (
    select product, jsonb_agg(other order by place) as others from pairs where place <= 5 group by product
  )
  select jsonb_build_object(
    'bestSellers', coalesce((select jsonb_agg(slug order by orders desc, slug) from best), '[]'::jsonb),
    'fastSelling', coalesce((select jsonb_agg(slug order by orders desc, slug) from fast), '[]'::jsonb),
    'boughtWith', coalesce((select jsonb_object_agg(product, others) from bought_with), '{}'::jsonb));
$$;
revoke execute on function public.auto_product_rows() from public;
grant execute on function public.auto_product_rows() to anon, authenticated;
