-- =====================================================================================================
-- 0045 · Two paneer products
--   The paneer is renamed A2 Desi Gir Paneer. It keeps its address, stock and past orders.
--   Jersey Cow Paneer is added: a product page and its card, the same template and prices as the A2 paneer until
--   the owner sets its own (Products & pricing → Edit). 250 g on, 500 g off, like every second pack. No review, as
--   nobody has bought it yet. Rating as a new product.
--   No new table or column. Past orders keep the name they were placed with.
-- Safe to run again.
-- =====================================================================================================

update public.product_pages
   set page = page || '{"name": "A2 Desi Gir Paneer"}'::jsonb, is_changed = is_starting_page or is_changed
 where slug = 'fresh-cow-paneer';

update public.product_cards set name = 'A2 Desi Gir Paneer' where product_id = 'fresh-cow-paneer';

insert into public.product_pages (slug, page, sort_order, is_starting_page, updated_by)
select 'jersey-cow-paneer',
       (p.page - 'panelCardIds' - 'addedInPanel') || jsonb_build_object(
         'slug', 'jersey-cow-paneer',
         'name', 'Jersey Cow Paneer',
         'description', 'Made from fresh Jersey cow milk, our soft and creamy paneer brings natural goodness and authentic taste to your everyday meals. No added starch, no fillers, just wholesome dairy goodness.',
         'highlights', '["Freshly Made", "Rich & Creamy", "No starch", "Jersey Cow Milk"]'::jsonb,
         'rating', coalesce((select j.page -> 'rating' from public.product_pages j where j.slug = 'jersey-ghee'), p.page -> 'rating'),
         'review', '{"quote": "", "name": "", "area": ""}'::jsonb,
         'pictures', jsonb_build_array((p.page -> 'pictures' -> 0) || '{"imageSource": "/images/products/jersey-cow-paneer-box.webp", "imageWidth": 1216, "imageHeight": 896, "alt": "Chiranvi Farm Jersey cow paneer box"}'::jsonb)),
       p.sort_order, false, 'Chiranvi Panel'
  from public.product_pages p
 where p.slug = 'fresh-cow-paneer'
on conflict (slug) do nothing;

insert into public.product_cards (product_id, name, category, pack_size, price_paise, stock, is_visible, show_on_best_sellers,
                                  units_per_day, image_source, image_width, image_height, sort_order, stock_counts)
select 'jersey-cow-paneer', 'Jersey Cow Paneer', c.category, c.pack_size, c.price_paise, 'in', true, false,
       0, '/images/products/jersey-cow-paneer-box.webp', 1216, 896, c.sort_order, '{"jersey-cow-paneer-500-g": 0}'::jsonb
  from public.product_cards c
 where c.product_id = 'fresh-cow-paneer'
on conflict (product_id) do nothing;
