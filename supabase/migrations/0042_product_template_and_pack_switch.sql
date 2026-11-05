-- =====================================================================================================
-- 0042 · One template for every product
--   Every product page now has the Product information and Nutrition facts tables and Choose Your Pack Size.
--   1. A pack size turned off on Products & pricing has a stock count of 0 (set_stock_counts, as before). That no
--      longer marks the whole product Low: only 1 to 5 is low. All sizes at 0 is still Out of stock.
--   2. Pages with no Nutrition facts get SAMPLE values, and milk pages get SAMPLE tables, to replace in the panel
--      (Products & pricing → Edit). Rows the panel already has are not touched.
--   3. A page with one pack size gets a second one, twice the size and price, turned off (count 0), so it shows Out
--      of stock until the panel sets it up. Its Net quantity row lists both.
--   Pages changed here are marked changed, so "Restore original" still offers the website's first version.
--   No new table or column.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.stock_label(p_card_id text, p_counts jsonb)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  keys text[] := private.stock_keys_of(p_card_id);
  is_milk boolean := exists (
    select 1 from public.product_pages p
    where not p.is_hidden and p.page ->> 'kind' = 'subscription'
      and (p.slug = p_card_id or coalesce(p.page -> 'panelCardIds', '[]'::jsonb) ? p_card_id));
  every_size_is_out boolean;
  one_is_low boolean;
begin
  every_size_is_out := not exists (
    select 1 from unnest(keys) as stock_key
    where coalesce((p_counts ->> stock_key)::integer, 1) > 0);
  -- A size at 0 is turned off or sold out, not low
  one_is_low := exists (
    select 1 from unnest(keys) as stock_key
    where (p_counts ->> stock_key)::integer between 1 and 5);
  if every_size_is_out and not is_milk then
    return 'out';
  end if;
  return case when one_is_low then 'low' else 'in' end;
end;
$$;

do $$
declare
  row_page record;
  page_data jsonb;
  old_pack jsonb;
  new_pack jsonb;
  old_label text;
  amount numeric;
  unit text;
  new_label text;
  new_id text;
  card_id text;
  sample jsonb;
  label_list text;
begin
  for row_page in select slug, page from public.product_pages where not is_hidden order by slug loop
    page_data := row_page.page;

    -- Milk: both tables
    if page_data ->> 'kind' = 'subscription' then
      if jsonb_array_length(coalesce(page_data -> 'nutritionFacts', '[]'::jsonb)) = 0 then
        sample := case when row_page.slug = 'skimmed-milk'
          then '[{"label":"Energy","value":"35 kcal"},{"label":"Protein","value":"3.4 g"},{"label":"Total fat","value":"0.2 g"},{"label":"Saturated fat","value":"0.1 g"},{"label":"Carbohydrate","value":"5 g"}]'::jsonb
          else '[{"label":"Energy","value":"67 kcal"},{"label":"Protein","value":"3.2 g"},{"label":"Total fat","value":"4 g"},{"label":"Saturated fat","value":"2.5 g"},{"label":"Carbohydrate","value":"4.8 g"}]'::jsonb
        end;
        page_data := page_data || jsonb_build_object('nutritionFacts', sample, 'nutritionBasis', 'per 100 ml (approx.)');
      end if;
      if jsonb_array_length(coalesce(page_data -> 'productInformation', '[]'::jsonb)) = 0 then
        page_data := page_data || jsonb_build_object('productInformation', jsonb_build_array(
          jsonb_build_object('label', 'Ingredients', 'value', 'Fresh cow milk'),
          jsonb_build_object('label', 'Net quantity', 'value', coalesce(page_data ->> 'packSize', '1 litre')),
          jsonb_build_object('label', 'Shelf life', 'value', 'Best within 2 days'),
          jsonb_build_object('label', 'Storage', 'value', 'Keep refrigerated'),
          jsonb_build_object('label', 'Country of origin', 'value', 'India'),
          jsonb_build_object('label', 'Manufactured by', 'value', 'Chiranvi Farm, [add address]'),
          jsonb_build_object('label', 'FSSAI Lic. No.', 'value', '[add number]')));
      end if;
    end if;

    if page_data ->> 'kind' = 'one-time' then
      -- Nutrition facts: sample values
      if jsonb_array_length(coalesce(page_data -> 'nutritionFacts', '[]'::jsonb)) = 0 then
        sample := case when row_page.slug ~ '(noodles|pasta|macaroni)'
          then '[{"label":"Energy","value":"350 kcal"},{"label":"Protein","value":"11 g"},{"label":"Total fat","value":"1.5 g"},{"label":"Saturated fat","value":"0.3 g"},{"label":"Carbohydrate","value":"72 g"}]'::jsonb
          else '[{"label":"Energy","value":"360 kcal"},{"label":"Protein","value":"10 g"},{"label":"Total fat","value":"3 g"},{"label":"Saturated fat","value":"0.5 g"},{"label":"Carbohydrate","value":"72 g"}]'::jsonb
        end;
        page_data := page_data || jsonb_build_object('nutritionFacts', sample, 'nutritionBasis', 'per 100 g (approx.)');
      end if;

      -- One pack size: a second one, twice the size and price
      if jsonb_array_length(coalesce(page_data -> 'packs', '[]'::jsonb)) = 1 then
        old_pack := page_data -> 'packs' -> 0;
        old_label := old_pack ->> 'label';
        amount := substring(old_label from '^[0-9.]+')::numeric;
        unit := trim(regexp_replace(old_label, '^[0-9.]+', ''));
        if amount is not null then
          new_label := trim_scale(amount * 2)::text || ' ' || unit;
          new_id := lower(replace(new_label, ' ', '-'));
          new_pack := (old_pack - 'tag') || jsonb_build_object(
            'packId', new_id, 'label', new_label,
            'size', (old_pack ->> 'size')::numeric * 2,
            'price', (old_pack ->> 'price')::numeric * 2);
          if old_pack ? 'originalPrice' then
            new_pack := new_pack || jsonb_build_object('originalPrice', (old_pack ->> 'originalPrice')::numeric * 2);
          end if;
          if old_pack ? 'itemCount' then
            new_pack := new_pack || jsonb_build_object('itemCount', (old_pack ->> 'itemCount')::numeric * 2);
          end if;
          page_data := jsonb_set(page_data, '{packs}', (page_data -> 'packs') || new_pack);

          -- Net quantity lists both
          label_list := old_label || ' / ' || new_label;
          page_data := jsonb_set(page_data, '{productInformation}', coalesce((
            select jsonb_agg(case when info ->> 'label' = 'Net quantity'
                                  then info || jsonb_build_object('value', label_list) else info end order by position)
              from jsonb_array_elements(coalesce(page_data -> 'productInformation', '[]'::jsonb)) with ordinality as rows (info, position)),
            '[]'::jsonb));
        end if;
      end if;
    end if;

    if page_data is distinct from row_page.page then
      update public.product_pages set page = page_data, is_changed = is_starting_page or is_changed where slug = row_page.slug;
    end if;

    -- The new pack starts turned off, on the card that keeps this page's stock
    if new_id is not null then
      card_id := private.stock_card_of(row_page.slug || '-' || new_id);
      if card_id is not null then
        update public.product_cards
           set stock_counts = stock_counts || jsonb_build_object(row_page.slug || '-' || new_id, 0)
         where product_id = card_id;
      else
        raise notice 'No card for %', row_page.slug;
      end if;
      new_id := null;
    end if;
  end loop;
end;
$$;
