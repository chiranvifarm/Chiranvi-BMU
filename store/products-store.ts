import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  The product list shared by the Chiranvi Panel and the website, saved in the Supabase "product_cards"
  table (supabase/migrations/0008_products.sql), so a change in the panel reaches every customer.
  - The panel (Products & pricing) changes prices, discounts, photos and stock. Prices change only by the
    owner: the database itself refuses anyone else.
  - The website reads the same list: the landing page's Best Sellers shows the products marked
    showOnBestSellers, with their current price and pack. A product that is switched off or out of stock
    still shows, marked "Sold out", with a "Notify me" button instead of Add to cart.
  - Out of stock is reported by the manager (outOfStockReport). When the panel marks it restocked, the
    manager gets a restock notice and the customers waiting on "Notify me" (table restock_requests) are told.
  - Stock counts (supabase/migrations/0029_stock_counts.sql): staff can enter how many are in stock, one number
    per pack size. Paid one-time orders lower it, cancelled and refunded ones put it back, and the label then
    follows the counts. A size without a number works by the label alone. Only the database changes the
    counts (saveStockCounts asks it).
  The list is read when first needed and again when the window comes back into focus; until then the
  starting list below is shown. A change shows at once and is then saved; if the database refuses it
  (e.g. a price changed by someone who is not the owner), the list is read again.
  Milk has a subscription price as well; every other product is one-time only.
*/

// The four standard categories, or one the admin added ("+ Add new category" on Products & pricing)
export type ProductCategory = "Milk" | "Paneer" | "Ghee & butter" | "Others" | (string & {});
export type StockLevel = "in" | "low" | "out";

export type ShopProduct = {
  productId: string;
  name: string;
  category: ProductCategory;
  packSize: string; // "1 L pouch", "500ml x 1"
  price: number;
  originalPrice?: number; // the old price shown crossed out on the website
  subscriptionPrice?: number; // milk only
  stock: StockLevel;
  stockCounts?: Record<string, number>; // how many are in stock, by the id the cart uses for each pack size
  isVisible: boolean; // false: switched off in the panel, the website shows it as Sold out
  showOnBestSellers?: boolean;
  bestSellerOrder?: number; // place in the landing page's Best Sellers (new ones go last)
  unitsPerDay: number; // how many sell a day (sample)
  imageSource?: string;
  imageWidth?: number;
  imageHeight?: number;
  // Who marked it out of stock, and when (shown in red at the top of its pop-up in the panel)
  outOfStockReport?: { reportedBy: string; reportedAt: string };
  // Mobile numbers of customers who tapped "Notify me" while it was sold out
  waitingCustomers?: string[];
  updatedAt?: string; // ISO date and time of the last change in the panel
};

// Sent to the manager when the panel marks a product restocked
export type RestockNotice = {
  productId: string;
  productName: string;
  restockedBy: string;
  sentTo: string[];
  customersNotified: number;
  at: string;
};

export const PRODUCT_CATEGORIES: ProductCategory[] = ["Milk", "Paneer", "Ghee & butter", "Others"];

/*
  Categories the admin added on Products & pricing (table product_categories). The full list (the standard
  four, then the added ones, then any a product already uses) is what the category tabs and pickers show.
*/
let addedCategories: ProductCategory[] = [];
const categoryListeners = new Set<() => void>();

function getAddedCategories() {
  return addedCategories;
}

// Adds a category (if new) and returns its name as stored (an existing one keeps its own spelling)
export function addProductCategory(name: string): ProductCategory {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const existing = [...PRODUCT_CATEGORIES, ...addedCategories].find((category) => category.toLowerCase() === cleanName.toLowerCase());
  if (existing || !cleanName) return existing ?? "Others";
  addedCategories = [...addedCategories, cleanName];
  categoryListeners.forEach((onChange) => onChange());
  void createClient()
    .from("product_categories")
    .insert({ name: cleanName })
    .then(({ error }) => {
      if (error) console.error("The database did not accept the category", error);
    });
  return cleanName;
}

function subscribeToCategories(onChange: () => void) {
  categoryListeners.add(onChange);
  startFollowingProducts();
  return () => {
    categoryListeners.delete(onChange);
  };
}

const NO_ADDED_CATEGORIES: ProductCategory[] = [];

export function useProductCategories(): ProductCategory[] {
  const added = useSyncExternalStore(subscribeToCategories, getAddedCategories, () => NO_ADDED_CATEGORIES);
  const products = useShopProducts();
  const all = [...PRODUCT_CATEGORIES, ...added, ...products.map((product) => product.category)];
  return all.filter((category, index) => category && all.indexOf(category) === index);
}


function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

// The six Best Sellers keep the names, pictures and prices the website already shows.
const startingProducts: ShopProduct[] = [
  { productId: "cow-milk-1-l", name: "Cow Milk", category: "Milk", packSize: "1 L pouch", price: 68, subscriptionPrice: 64, stock: "in", isVisible: true, unitsPerDay: 612, imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  { productId: "cow-milk-500-ml", name: "Cow Milk", category: "Milk", packSize: "500 ml pouch", price: 36, subscriptionPrice: 34, stock: "in", isVisible: true, unitsPerDay: 388, imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  {
    productId: "a2-desi-milk",
    name: "A2 Desi Milk",
    category: "Milk",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    subscriptionPrice: 229,
    stock: "in",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 1,
    unitsPerDay: 240,
    imageSource: "/images/products/a2-cow-milk-1-litre-bottle.webp",
    imageWidth: 232,
    imageHeight: 500,
  },
  { productId: "buffalo-milk-1-l", name: "Buffalo Milk", category: "Milk", packSize: "1 L pouch", price: 78, subscriptionPrice: 74, stock: "low", isVisible: true, unitsPerDay: 96, imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  { productId: "a2-milk-500-ml", name: "A2 Milk", category: "Milk", packSize: "500 ml glass bottle", price: 52, subscriptionPrice: 48, stock: "in", isVisible: true, unitsPerDay: 120, imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  {
    productId: "fresh-cow-paneer",
    name: "Fresh Cow Paneer",
    category: "Paneer",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    stock: "in",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 3,
    unitsPerDay: 84,
    imageSource: "/images/products/fresh-paneer-200g-box.webp",
    imageWidth: 604,
    imageHeight: 444,
  },
  { productId: "malai-paneer-500-g", name: "Malai Paneer", category: "Paneer", packSize: "500 g pack", price: 220, stock: "in", isVisible: true, unitsPerDay: 40, imageSource: "/images/products/fresh-paneer-200g-box.webp", imageWidth: 604, imageHeight: 444 },
  { productId: "malai-paneer-200-g", name: "Malai Paneer", category: "Paneer", packSize: "200 g pack", price: 95, stock: "low", isVisible: true, unitsPerDay: 72, imageSource: "/images/products/fresh-paneer-200g-box.webp", imageWidth: 604, imageHeight: 444 },
  {
    productId: "a2-desi-ghee",
    name: "A2 Desi Ghee",
    category: "Ghee & butter",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    stock: "in",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 2,
    unitsPerDay: 38,
    imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp",
    imageWidth: 1524,
    imageHeight: 2204,
  },
  { productId: "desi-ghee-1-l", name: "Desi Ghee", category: "Ghee & butter", packSize: "1 L jar", price: 790, stock: "out", isVisible: false, unitsPerDay: 12, outOfStockReport: { reportedBy: "Store manager", reportedAt: hoursAgo(5) }, waitingCustomers: ["9845012345", "9900123456", "9741234567"], imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204 },
  { productId: "white-butter-100-g", name: "White Butter", category: "Ghee & butter", packSize: "100 g", price: 58, stock: "in", isVisible: true, unitsPerDay: 50 },
  { productId: "buttermilk-500-ml", name: "Buttermilk", category: "Others", packSize: "500 ml", price: 25, stock: "in", isVisible: true, unitsPerDay: 140 },
  { productId: "khoa-250-g", name: "Khoa", category: "Others", packSize: "250 g", price: 120, stock: "out", isVisible: false, unitsPerDay: 8, outOfStockReport: { reportedBy: "Store manager", reportedAt: hoursAgo(26) }, waitingCustomers: ["9886543210", "9538765432"] },
  {
    productId: "moringa-powder",
    name: "Moringa Powder",
    category: "Others",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    stock: "in",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 4,
    unitsPerDay: 20,
    imageSource: "/images/products/moringa-leaves-powder-pouch.webp",
    imageWidth: 336,
    imageHeight: 516,
  },
  {
    productId: "turmeric-powder",
    name: "Turmeric Powder",
    category: "Others",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    stock: "low",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 5,
    unitsPerDay: 26,
    imageSource: "/images/products/turmeric-powder-pouch.webp",
    imageWidth: 360,
    imageHeight: 548,
  },
  {
    productId: "red-chilli-powder",
    name: "Red Chilli Powder",
    category: "Others",
    packSize: "500ml x 1",
    price: 249,
    originalPrice: 389,
    stock: "low",
    isVisible: true,
    showOnBestSellers: true,
    bestSellerOrder: 6,
    unitsPerDay: 22,
    imageSource: "/images/products/red-chilli-powder-pouch.webp",
    imageWidth: 360,
    imageHeight: 548,
  },
];

// The row as the database keeps it (money in paise)
type CardRow = {
  product_id: string;
  name: string;
  category: string;
  pack_size: string;
  price_paise: number;
  original_price_paise: number | null;
  subscription_price_paise: number | null;
  stock: StockLevel;
  stock_counts: Record<string, number> | null;
  is_visible: boolean;
  show_on_best_sellers: boolean;
  best_seller_order: number | null;
  units_per_day: number;
  image_source: string | null;
  image_width: number | null;
  image_height: number | null;
  out_of_stock_reported_by: string | null;
  out_of_stock_reported_at: string | null;
  updated_at: string;
};

const rupees = (paise: number | null) => (paise === null ? undefined : paise / 100);
const paise = (amount: number | undefined) => (amount === undefined ? null : Math.round(amount * 100));

function toProduct(row: CardRow, waiting: string[]): ShopProduct {
  return {
    productId: row.product_id,
    name: row.name,
    category: row.category,
    packSize: row.pack_size,
    price: row.price_paise / 100,
    originalPrice: rupees(row.original_price_paise),
    subscriptionPrice: rupees(row.subscription_price_paise),
    stock: row.stock,
    stockCounts: row.stock_counts ?? undefined,
    isVisible: row.is_visible,
    showOnBestSellers: row.show_on_best_sellers,
    bestSellerOrder: row.best_seller_order ?? undefined,
    unitsPerDay: row.units_per_day,
    imageSource: row.image_source ?? undefined,
    imageWidth: row.image_width ?? undefined,
    imageHeight: row.image_height ?? undefined,
    outOfStockReport: row.out_of_stock_reported_by && row.out_of_stock_reported_at ? { reportedBy: row.out_of_stock_reported_by, reportedAt: row.out_of_stock_reported_at } : undefined,
    waitingCustomers: waiting.length ? waiting : undefined,
    updatedAt: row.updated_at,
  };
}

// The changed fields of a product as database columns
function toRow(changes: Partial<ShopProduct>) {
  const row: Record<string, unknown> = {};
  if ("name" in changes) row.name = changes.name;
  if ("category" in changes) row.category = changes.category;
  if ("packSize" in changes) row.pack_size = changes.packSize;
  if ("price" in changes) row.price_paise = paise(changes.price) ?? 0;
  if ("originalPrice" in changes) row.original_price_paise = paise(changes.originalPrice);
  if ("subscriptionPrice" in changes) row.subscription_price_paise = paise(changes.subscriptionPrice);
  if ("stock" in changes) row.stock = changes.stock;
  if ("isVisible" in changes) row.is_visible = changes.isVisible;
  if ("showOnBestSellers" in changes) row.show_on_best_sellers = Boolean(changes.showOnBestSellers);
  if ("bestSellerOrder" in changes) row.best_seller_order = changes.bestSellerOrder ?? null;
  if ("unitsPerDay" in changes) row.units_per_day = changes.unitsPerDay;
  if ("imageSource" in changes) row.image_source = changes.imageSource ?? null;
  if ("imageWidth" in changes) row.image_width = changes.imageWidth ?? null;
  if ("imageHeight" in changes) row.image_height = changes.imageHeight ?? null;
  if ("outOfStockReport" in changes) {
    row.out_of_stock_reported_by = changes.outOfStockReport?.reportedBy ?? null;
    row.out_of_stock_reported_at = changes.outOfStockReport?.reportedAt ?? null;
  }
  return row;
}

let products: ShopProduct[] = startingProducts;
const listeners = new Set<() => void>();
let isFollowing = false;
let isLoading = false;
// True once the list has been read from the database (until then the starting list is shown)
let hasLoaded = false;

function announce() {
  listeners.forEach((onChange) => onChange());
}

// Reads the cards, the added categories and who is waiting on "Notify me" (staff see everyone; a customer
// only themselves)
async function loadProducts() {
  if (isLoading) return;
  isLoading = true;
  const supabase = createClient();
  const [cards, categories, waiting] = await Promise.all([
    supabase.from("product_cards").select("*").order("sort_order").order("created_at"),
    supabase.from("product_categories").select("name").order("created_at"),
    supabase.from("restock_requests").select("product_id, mobile_number"),
  ]);
  isLoading = false;
  if (cards.error) {
    console.error("Could not read the products", cards.error);
    return;
  }
  const waitingByProduct = new Map<string, string[]>();
  for (const request of (waiting.data ?? []) as { product_id: string; mobile_number: string }[]) {
    waitingByProduct.set(request.product_id, [...(waitingByProduct.get(request.product_id) ?? []), request.mobile_number]);
  }
  products = ((cards.data ?? []) as CardRow[]).map((row) => toProduct(row, waitingByProduct.get(row.product_id) ?? []));
  hasLoaded = true;
  addedCategories = ((categories.data ?? []) as { name: string }[]).map((category) => category.name);
  announce();
  categoryListeners.forEach((onChange) => onChange());
}

// Reads the list once, then again when the window comes back into focus or someone logs in / out
function startFollowingProducts() {
  if (isFollowing || typeof window === "undefined") return;
  isFollowing = true;
  void loadProducts();
  window.addEventListener("focus", () => void loadProducts());
  createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") window.setTimeout(() => void loadProducts(), 0);
  });
}

function getProducts() {
  return products;
}

// After a change: show it at once, save it, and read the list again if the database refused it
function saveThenCheck(change: () => void, write: () => PromiseLike<{ error: unknown }>) {
  change();
  announce();
  void Promise.resolve(write()).then(({ error }) => {
    if (error) {
      console.error("The database did not accept the product change", error);
      void loadProducts();
    }
  });
}

/*
  Changes from the panel's pop-up. Marking it out of stock switches it off (Sold out on the website) and
  notes who reported it; restocking is done with markRestocked, which also tells the manager.
*/
export function updateProduct(productId: string, changes: Partial<Omit<ShopProduct, "productId">>, changedBy = "Chiranvi Panel") {
  const product = products.find((existing) => existing.productId === productId);
  if (!product) return;
  const extra: Partial<ShopProduct> = {};
  if (changes.stock === "out" && product.stock !== "out") {
    extra.isVisible = false;
    extra.outOfStockReport = { reportedBy: changedBy, reportedAt: new Date().toISOString() };
  }
  if (changes.stock && changes.stock !== "out") extra.outOfStockReport = undefined;
  const allChanges = { ...changes, ...extra };
  saveThenCheck(
    () => {
      products = products.map((existing) => (existing.productId === productId ? { ...existing, ...allChanges, updatedAt: new Date().toISOString() } : existing));
    },
    () => createClient().from("product_cards").update(toRow(allChanges)).eq("product_id", productId),
  );
}

// Back in stock: shown as available again, the manager gets a notice, waiting customers are told
export function markRestocked(productId: string, restockedBy: string, managers: string[]) {
  const product = products.find((existing) => existing.productId === productId);
  if (!product) return null;
  const notice: RestockNotice = {
    productId,
    productName: `${product.name} · ${product.packSize}`,
    restockedBy,
    sentTo: managers.length ? managers : ["Store manager"],
    customersNotified: product.waitingCustomers?.length ?? 0,
    at: new Date().toISOString(),
  };
  updateProduct(productId, { stock: "in", isVisible: true, outOfStockReport: undefined, waitingCustomers: [] });
  // The waiting list is cleared once they have been told
  void createClient().from("restock_requests").delete().eq("product_id", productId);
  // The notice is shown in the panel's message (nothing is kept in the browser)
  return notice;
}

/*
  The panel's stock boxes: only the sizes that changed are sent ({ id: 12 }, or { id: null } to stop counting
  it), so a sale happening meanwhile isn't undone for the others. Answers a problem to show, or null.
*/
export async function saveStockCounts(productId: string, counts: Record<string, number | null>) {
  const { error } = await createClient().rpc("set_stock_counts", { p_product_id: productId, p_counts: counts });
  await loadProducts();
  if (error) {
    console.error("The database did not accept the stock counts", error);
    return error.message || "Couldn't save the stock counts. Please try again.";
  }
  return null;
}

// "Notify me" on the website (once per mobile number; the database keeps one request per customer)
export function askToBeNotified(productId: string, mobileNumber: string) {
  const digits = mobileNumber.replace(/\D/g, "").slice(-10);
  saveThenCheck(
    () => {
      products = products.map((product) =>
        product.productId === productId && !product.waitingCustomers?.includes(digits)
          ? { ...product, waitingCustomers: [...(product.waitingCustomers ?? []), digits] }
          : product,
      );
    },
    () => createClient().from("restock_requests").upsert({ product_id: productId, mobile_number: digits }, { onConflict: "product_id,mobile_number", ignoreDuplicates: true }),
  );
}

// The photo the product started with (to undo a changed photo)
export function getStartingPhoto(productId: string) {
  const product = startingProducts.find((existing) => existing.productId === productId);
  return product?.imageSource ? { imageSource: product.imageSource, imageWidth: product.imageWidth, imageHeight: product.imageHeight } : null;
}

export function addProduct(product: Omit<ShopProduct, "productId" | "unitsPerDay">) {
  const baseId = `${product.name}-${product.packSize}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  let productId = baseId;
  for (let copy = 2; products.some((existing) => existing.productId === productId); copy++) productId = `${baseId}-${copy}`;
  const newProduct: ShopProduct = { ...product, productId, unitsPerDay: 0 };
  saveThenCheck(
    () => {
      products = [...products, newProduct];
    },
    () => createClient().from("product_cards").insert({ product_id: productId, sort_order: products.length, ...toRow(newProduct) }),
  );
  return newProduct;
}

// Deleted in the panel: gone from the panel and the website
export function removeProduct(productId: string) {
  saveThenCheck(
    () => {
      products = products.filter((product) => product.productId !== productId);
    },
    () => createClient().from("product_cards").delete().eq("product_id", productId),
  );
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  startFollowingProducts();
  return () => {
    listeners.delete(onChange);
  };
}

export function useShopProducts() {
  return useSyncExternalStore(subscribe, getProducts, () => startingProducts);
}

// True once the product list has been read from the database (the panel waits for this before making a
// card for a page that has none, so it never makes one that already exists)
export function useHaveProductsLoaded() {
  return useSyncExternalStore(subscribe, () => hasLoaded, () => false);
}

// Can be ordered on the website: switched on and in stock (otherwise it shows as Sold out)
export function isAvailableToOrder(product: ShopProduct) {
  return product.isVisible && product.stock !== "out";
}

// Percent off the old (crossed-out) price, e.g. 36
export function getDiscountPercent(product: Pick<ShopProduct, "price" | "originalPrice">) {
  return product.originalPrice && product.originalPrice > product.price
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : 0;
}
