-- =====================================================================================================
-- 0043 · New photos for the milk and ghee products
--   Each of the five products now has its own bottle or jar photo, on its product page (page.pictures) and its
--   card (product_cards). The files are in public/images/products. Nothing else on the pages changes.
--   No new table or column.
-- Safe to run again.
-- =====================================================================================================

with photos (slug, image_source, image_width, image_height) as (
  values
    ('a2-desi-milk', '/images/products/a2-desi-gir-milk-bottle.webp', 569, 1112),
    ('jersey-milk', '/images/products/jersey-cow-milk-bottle.webp', 568, 1112),
    ('skimmed-milk', '/images/products/skimmed-milk-bottle.webp', 564, 1100),
    ('a2-desi-ghee', '/images/products/a2-desi-gir-ghee-jar.webp', 788, 1048),
    ('jersey-ghee', '/images/products/jersey-cow-ghee-jar.webp', 792, 1056)
)
update public.product_pages p
   set page = jsonb_set(p.page, '{pictures,0}',
         (p.page -> 'pictures' -> 0) || jsonb_build_object('imageSource', photos.image_source, 'imageWidth', photos.image_width, 'imageHeight', photos.image_height)),
       is_changed = p.is_starting_page or p.is_changed
  from photos
 where p.slug = photos.slug;

with photos (slug, image_source, image_width, image_height) as (
  values
    ('a2-desi-milk', '/images/products/a2-desi-gir-milk-bottle.webp', 569, 1112),
    ('jersey-milk', '/images/products/jersey-cow-milk-bottle.webp', 568, 1112),
    ('skimmed-milk', '/images/products/skimmed-milk-bottle.webp', 564, 1100),
    ('a2-desi-ghee', '/images/products/a2-desi-gir-ghee-jar.webp', 788, 1048),
    ('jersey-ghee', '/images/products/jersey-cow-ghee-jar.webp', 792, 1056)
)
update public.product_cards c
   set image_source = photos.image_source, image_width = photos.image_width, image_height = photos.image_height
  from photos
 where c.product_id = photos.slug;
