-- =====================================================================================================
-- 0044 · New photo for A2 Desi Paneer
--   On its product page (page.pictures) and its card (product_cards). The file is in public/images/products.
--   No new table or column.
-- Safe to run again.
-- =====================================================================================================

update public.product_pages
   set page = jsonb_set(page, '{pictures,0}',
         (page -> 'pictures' -> 0) || '{"imageSource": "/images/products/a2-desi-gir-paneer-box.webp", "imageWidth": 1236, "imageHeight": 908}'::jsonb),
       is_changed = is_starting_page or is_changed
 where slug = 'fresh-cow-paneer';

update public.product_cards
   set image_source = '/images/products/a2-desi-gir-paneer-box.webp', image_width = 1236, image_height = 908
 where product_id = 'fresh-cow-paneer';
