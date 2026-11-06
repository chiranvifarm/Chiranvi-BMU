import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { startingProductPages, type ProductPage } from "@/components/product/product-page-data";

/*
  Product pages shown at /products/<slug>, saved in the Supabase "product_pages" table
  (supabase/migrations/0008_products.sql): the website's 34 starting pages (copied in once from
  components/product/product-page-data.ts) plus the pages added in the Chiranvi Panel ("Add product").
  The panel can edit and delete any page:
  - a panel page: edited or deleted as it is;
  - a starting page: an edit is marked "changed", a delete hides it, and "Restore original" puts the
    code's version back (shown again, changes dropped).
  Every browser reads the same pages, so a change in the panel reaches every customer. Prices change only
  by the owner (the database refuses anyone else). The pages are read when first needed and again when the
  window comes back into focus; until then the code's starting pages are shown.
*/

type PageRow = { slug: string; page: ProductPage; is_starting_page: boolean; is_changed: boolean; is_hidden: boolean; sort_order: number };

let rows: PageRow[] | null = null;
let allPages: ProductPage[] = startingProductPages;
let hiddenSlugs: string[] = [];
const listeners = new Set<() => void>();
let isFollowing = false;
let isLoading = false;
// The database has answered at least once (a product added in the panel isn't known before that)
let hasLoadedPages = false;

const startingSlugs = new Set(startingProductPages.map((page) => page.slug));

export function isStartingProductPage(slug: string) {
  return startingSlugs.has(slug);
}

// The shown pages in their order (deleted starting pages left out), and the deleted ones' addresses
function combinePages() {
  const sorted = [...(rows ?? [])].sort((first, second) => first.sort_order - second.sort_order);
  allPages = sorted.filter((row) => !row.is_hidden).map((row) => ({ ...row.page, addedInPanel: !row.is_starting_page }));
  hiddenSlugs = sorted.filter((row) => row.is_hidden).map((row) => row.slug);
  listeners.forEach((onChange) => onChange());
}

async function loadPages() {
  if (isLoading) return;
  isLoading = true;
  const { data, error } = await createClient().from("product_pages").select("slug, page, is_starting_page, is_changed, is_hidden, sort_order");
  isLoading = false;
  hasLoadedPages = true;
  if (error) {
    console.error("Could not read the product pages", error);
    listeners.forEach((onChange) => onChange());
    return;
  }
  // Nothing readable yet (e.g. the table is empty): keep the code's pages
  if (!data?.length) {
    listeners.forEach((onChange) => onChange());
    return;
  }
  rows = data as PageRow[];
  combinePages();
}

// Reads the pages once, then again when the window comes back into focus or someone logs in / out (staff
// also see drafts and deleted pages)
function startFollowingPages() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadPages();
  window.addEventListener("focus", () => void loadPages());
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadPages(), 0);
  });
}

function getAllPages() {
  return allPages;
}

// After a change: show it at once, save it, and read the pages again if the database refused it (e.g. a
// price changed by someone who is not the owner)
let lastPageSave: Promise<unknown> = Promise.resolve();

// Done when the last page change has reached the database (a new pack's stock number waits for this)
export function whenPageIsSaved() {
  return lastPageSave;
}

function saveThenCheck(change: (current: PageRow[]) => PageRow[], write: () => PromiseLike<{ error: unknown }>) {
  rows = change(rows ?? startingProductPages.map((page, index) => ({ slug: page.slug, page, is_starting_page: true, is_changed: false, is_hidden: false, sort_order: index })));
  combinePages();
  lastPageSave = Promise.resolve(write()).then(({ error }) => {
    if (error) {
      console.error("The database did not accept the page change", error);
      void loadPages();
    }
  });
  return true;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingPages();
  return () => {
    listeners.delete(onChange);
  };
}

// Every product page shown on the website (on the server: the code's starting pages)
export function useProductPages() {
  return useSyncExternalStore(subscribe, getAllPages, () => startingProductPages);
}

// False until the database has answered: a page can't be called "not found" before that
export function useHaveProductPagesLoaded() {
  return useSyncExternalStore(subscribe, () => hasLoadedPages, () => false);
}

// Starting pages deleted in the panel (listed there with "Restore original")
function getHiddenSlugs() {
  return hiddenSlugs;
}

const noHiddenSlugs: string[] = [];
export function useHiddenStartingProductSlugs() {
  return useSyncExternalStore(subscribe, getHiddenSlugs, () => noHiddenSlugs);
}

// A starting page changed in the panel
export function isChangedStartingProductPage(slug: string) {
  return Boolean(rows?.some((row) => row.slug === slug && row.is_starting_page && row.is_changed));
}

export function isProductSlugTaken(slug: string) {
  return allPages.some((page) => page.slug === slug) || hiddenSlugs.includes(slug);
}

// A new page from the panel's "Add product"
export function addProductPage(page: ProductPage) {
  const sortOrder = Math.max(0, ...(rows ?? []).map((row) => row.sort_order)) + 1;
  const newPage = { ...page, addedInPanel: true };
  return saveThenCheck(
    (current) => [...current, { slug: page.slug, page: newPage, is_starting_page: false, is_changed: false, is_hidden: false, sort_order: sortOrder }],
    () => createClient().from("product_pages").insert({ slug: page.slug, page: newPage, sort_order: sortOrder, is_starting_page: false }),
  );
}

// An edited page (same address); a starting page is marked changed
export function updateProductPage(page: ProductPage) {
  const isStarting = startingSlugs.has(page.slug);
  const updated = { ...page, addedInPanel: !isStarting };
  return saveThenCheck(
    (current) => current.map((row) => (row.slug === page.slug ? { ...row, page: updated, is_changed: isStarting || row.is_changed } : row)),
    () => createClient().from("product_pages").update({ page: updated, is_changed: isStarting }).eq("slug", page.slug),
  );
}

// Delete: a panel page goes; a starting page is hidden
export function deleteProductPage(slug: string) {
  if (!startingSlugs.has(slug)) {
    return saveThenCheck(
      (current) => current.filter((row) => row.slug !== slug),
      () => createClient().from("product_pages").delete().eq("slug", slug),
    );
  }
  return saveThenCheck(
    (current) => current.map((row) => (row.slug === slug ? { ...row, is_hidden: true } : row)),
    () => createClient().from("product_pages").update({ is_hidden: true }).eq("slug", slug),
  );
}

// "Restore original": a starting page back to the code's version (shown again, changes dropped)
export function restoreStartingProductPage(slug: string) {
  const original = startingProductPages.find((page) => page.slug === slug);
  if (!original) return false;
  return saveThenCheck(
    (current) => current.map((row) => (row.slug === slug ? { ...row, page: original, is_changed: false, is_hidden: false } : row)),
    () => createClient().from("product_pages").update({ page: original, is_changed: false, is_hidden: false }).eq("slug", slug),
  );
}
