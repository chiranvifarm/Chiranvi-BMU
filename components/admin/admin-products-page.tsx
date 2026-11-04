"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  addProduct,
  getDiscountPercent,
  getStartingPhoto,
  isAvailableToOrder,
  markRestocked,
  removeProduct,
  saveStockCounts,
  updateProduct,
  useProductCategories,
  useHaveProductsLoaded,
  useShopProducts,
  type ProductCategory,
  type ShopProduct,
  type StockLevel,
} from "@/store/products-store";
import { useCurrentStaffAccess, useStaffMembers } from "@/store/staff-access-store";
import { AdminFeatureGate } from "./admin-panel-layout";
import type { ProductKind, ProductPage, ShopCategory } from "@/components/product/product-page-data";
import { POWDER_PRODUCT_IDS } from "@/components/product/all-products-page";
import { deleteProductPage, isStartingProductPage, useProductPages } from "@/store/product-pages-store";
import {
  DEFAULT_PRODUCT_ROWS,
  NOODLES_KINDS,
  NOODLES_KIND_NAMES,
  saveProductRows,
  useProductRows,
  type ProductRows,
} from "@/store/admin-product-rows-store";
import {
  CategoryPicker,
  ChooseProductKindDialog,
  PICTURE_TOO_BIG_MESSAGE,
  ProductPageCardActions,
  ProductPageForm,
  ProductRowSlotsEditor,
  noodlesRowChoices,
  processPictureFile,
  useDeletedStartingProductPages,
} from "./admin-product-page-form";
import {
  AdminFilterTabs,
  AdminPageTop,
  AdminStatCards,
  AdminDialog,
  adminInputClassName,
  downloadCsv,
  toDateFileName,
  useAdminCan,
  useAdminToast,
  useIsPanelOwner,
  OWNER_ONLY_MESSAGE,
} from "./admin-shared";
import dashboardStyles from "./admin-dashboard.module.css";
import sharedStyles from "./admin-shared.module.css";
import styles from "./admin-products-page.module.css";
import AdminDeliveryChargesPopup from "./admin-delivery-charges-popup";
import deliveryPopupStyles from "./admin-delivery-charges-popup.module.css";

/*
  Products & pricing (/admin/products), from the design 09-products-pricing: every product as a card
  with its price, stock and a switch for selling it on the website.
    top        search, Add product, category tabs (All / Milk / Paneer / Ghee & butter / Others), Export
    numbers    products (available / sold out), best seller, low stock and out of stock (red: serious);
               clicking Low stock or Out of stock shows only those products (click again for all)
    cards      the switch: off shows the product on the website as "Sold out" with a "Notify me" button
    pop-up     clicking a card opens it over the blurred page: price, old price and discount, subscription
               price (milk), photo, stock, name / pack / category, Best Sellers, and Delete (asks once more).
               Out of stock: a red line at the top says who reported it, and "Restocked" puts it back in
               stock, sends the manager a notice and tells the customers waiting on "Notify me".
  Milk has a subscription price as well; every other product is one-time only.
  The products come from store/products-store.ts, which the website reads too.
*/

type CategoryTab = "all" | ProductCategory;

// A product page's All products filter → the category tab its card goes under here
const CATEGORY_FROM_SHOP_CATEGORY: Record<ShopCategory, ProductCategory> = {
  Milk: "Milk",
  Paneer: "Paneer",
  Ghee: "Ghee & butter",
  Butter: "Ghee & butter",
  Flours: "Others",
  Batter: "Others",
  Powders: "Others",
  Noodles: "Others",
  Pasta: "Others",
  Macaroni: "Others",
  Others: "Others",
};

/*
  "Arrange product rows": the five products under the product pages, in order.
    - Fast selling products: on every page except the noodles, pasta and macaroni ones.
    - You may also like: one list each for the Instant Noodles, Pasta and Macaroni pages; a place can match
      the page (another flavour, or the same flavour of another product) or be any product.
  A page with its own order (Edit page → "Product row on this page") keeps it. "Back to the original rows"
  fills in the rows the website started with (saved only with Save rows).
*/
function ProductRowsDialog({ onClose, showToast }: { onClose: () => void; showToast: (message: string) => void }) {
  const [rows, setRows] = useState<ProductRows>(useProductRows());
  return (
    <AdminDialog
      title="Product rows"
      submitLabel="Save rows"
      onClose={onClose}
      onSubmit={() => {
        saveProductRows(rows);
        showToast("Product rows saved");
        onClose();
      }}
    >
      <p className={styles["admin-product-rows-intro"]}>
        Five products in each row, in this order. The page&apos;s own product is always left out; an empty place is skipped and the row is
        filled up to five.
      </p>
      <section className={styles["admin-product-rows-group"]}>
        <h3 className={styles["admin-product-rows-group-title"]}>Fast selling products</h3>
        <p className={styles["admin-product-rows-group-note"]}>Milk, ghee, paneer, butter, flours, batter and powders pages</p>
        <ProductRowSlotsEditor slots={rows.fastSelling} onChange={(slots) => setRows({ ...rows, fastSelling: slots })} label="Fast selling products" />
      </section>
      {NOODLES_KINDS.map((kind) => (
        <section key={kind} className={styles["admin-product-rows-group"]}>
          <h3 className={styles["admin-product-rows-group-title"]}>You may also like · {NOODLES_KIND_NAMES[kind]} pages</h3>
          <ProductRowSlotsEditor
            slots={rows.youMayAlsoLike[kind]}
            onChange={(slots) => setRows({ ...rows, youMayAlsoLike: { ...rows.youMayAlsoLike, [kind]: slots } })}
            label={`You may also like on ${NOODLES_KIND_NAMES[kind]} pages`}
            matchingChoices={noodlesRowChoices(kind)}
          />
        </section>
      ))}
      <button type="button" className={styles["admin-product-rows-reset-button"]} onClick={() => setRows(DEFAULT_PRODUCT_ROWS)}>
        Back to the original rows
      </button>
    </AdminDialog>
  );
}

// The product page a card belongs to: made with the page in the panel, or the same address (a2-desi-ghee)
function findPageOfCard(pages: ProductPage[], productId: string) {
  return pages.find((page) => page.panelCardIds?.includes(productId) || page.slug === productId);
}

// The photo a card shows: its website page's first picture (what customers see), else the card's own
function photoOfCard(product: Pick<ShopProduct, "imageSource" | "imageWidth" | "imageHeight">, page?: ProductPage) {
  const picture = page?.pictures[0];
  return picture ? { imageSource: picture.imageSource, imageWidth: picture.imageWidth, imageHeight: picture.imageHeight } : product;
}

/*
  A card's prices and pack come from its website page (the only place prices are set for a product with a
  page): subscription (all milk) from its price per unit and first plan; one-time (every other product) from
  the pack its page opens on.
*/
function cardPricesFromPage(page: ProductPage) {
  if (page.kind === "subscription") {
    const defaultPlan = page.plans.find((plan) => plan.planId === page.defaultPlanId) ?? page.plans[0];
    return {
      category: "Milk" as ProductCategory,
      packSize: page.packSize,
      price: page.price,
      originalPrice: page.originalPrice,
      subscriptionPrice: defaultPlan ? Math.round(page.price * (1 - defaultPlan.percentOff / 100)) : undefined,
    };
  }
  const pack = page.packs.find((onePack) => onePack.packId === page.defaultPackId) ?? page.packs[0];
  const category = CATEGORY_FROM_SHOP_CATEGORY[page.shopCategory ?? "Others"];
  return {
    category: category === "Milk" ? ("Others" as ProductCategory) : category,
    packSize: pack ? `${pack.label} ${page.cartPackWord}` : "",
    price: pack?.price ?? 0,
    originalPrice: pack?.originalPrice,
    subscriptionPrice: undefined,
  };
}

/*
  A card like the rest (stock, switch, prices) for a product page that has none, e.g. one added in the code.
  It is made with the page address as its name first, so its id is the address (addProduct makes the id from
  name + pack) and the card and the page find each other without changing the page.
*/
function makeCardForPage(page: ProductPage): string {
  const picture = page.pictures[0] && !page.pictures[0].imageSource.startsWith("data:") ? page.pictures[0] : undefined;
  const photo = picture ? { imageSource: picture.imageSource, imageWidth: picture.imageWidth, imageHeight: picture.imageHeight } : {};
  const { packSize, ...prices } = cardPricesFromPage(page);
  const card = addProduct({ name: page.slug, packSize: "", ...prices, stock: "in", isVisible: page.status === "published", ...photo });
  updateProduct(card.productId, { name: page.name, packSize });
  return card.productId;
}

// Deleting a product: its website page and every card of it go together
function deleteProductAndPage(productId: string | null, page?: ProductPage) {
  if (productId) removeProduct(productId);
  page?.panelCardIds?.forEach((cardId) => cardId !== productId && removeProduct(cardId));
  if (page) deleteProductPage(page.slug);
}

const STOCK_LABELS: Record<StockLevel, string> = { in: "In stock", low: "Low stock", out: "Out of stock" };

const STOCK_CLASS_NAMES: Record<StockLevel, string> = {
  in: dashboardStyles["admin-status-delivered"],
  low: sharedStyles["admin-status-cancelled"],
  out: sharedStyles["admin-status-warning"],
};

type ProductForm = {
  name: string;
  category: ProductCategory;
  packSize: string;
  price: string;
  originalPrice: string;
  discountPercent: string;
  subscriptionPrice: string;
  stock: StockLevel;
  isVisible: boolean;
  showOnBestSellers: boolean;
  isRestocked: boolean;
  imageSource?: string;
  imageWidth?: number;
  imageHeight?: number;
};

const EMPTY_FORM: ProductForm = {
  name: "",
  category: "Milk",
  packSize: "",
  price: "",
  originalPrice: "",
  discountPercent: "",
  subscriptionPrice: "",
  stock: "in",
  isVisible: true,
  showOnBestSellers: false,
  isRestocked: false,
};

function toForm(product: ShopProduct): ProductForm {
  const discount = getDiscountPercent(product);
  return {
    name: product.name,
    category: product.category,
    packSize: product.packSize,
    price: String(product.price),
    originalPrice: product.originalPrice ? String(product.originalPrice) : "",
    discountPercent: discount ? String(discount) : "",
    subscriptionPrice: product.subscriptionPrice ? String(product.subscriptionPrice) : "",
    stock: product.stock,
    isVisible: product.isVisible,
    showOnBestSellers: Boolean(product.showOnBestSellers),
    isRestocked: false,
    imageSource: product.imageSource,
    imageWidth: product.imageWidth,
    imageHeight: product.imageHeight,
  };
}

const onlyDigits = (text: string) => text.replace(/\D/g, "");

// The pack sizes with a stock count, by the id the cart uses (the database checks the same list)
function stockSizesOf(product: ShopProduct, page?: ProductPage) {
  if (!page) return [{ key: product.productId, label: product.packSize || "Stock" }];
  if ("packs" in page) return page.packs.map((pack) => ({ key: `${page.slug}-${pack.packId}`, label: pack.label }));
  return [{ key: page.slug, label: "1 L" }, ...(page.hasHalfLitreBottle ? [{ key: `${page.slug}-half-litre`, label: "500 ml" }] : [])];
}

// "21 Oct, 9:40 am"
function formatWhen(isoDate: string) {
  return new Date(isoDate).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function AdminProductsPage() {
  return (
    <AdminFeatureGate feature="products">
      <ProductsPage />
    </AdminFeatureGate>
  );
}

function ProductsPage() {
  /*
    Only the products the website shows: a card with its own product page (one card per page, named as on
    the website) and the powders. Old sample cards the website doesn't have stay saved but are not shown.
  */
  const allCards = useShopProducts();
  const productPages = useProductPages();
  const pageSlugsShown = new Set<string>();
  const products = allCards.flatMap((product) => {
    const page = findPageOfCard(productPages, product.productId);
    if (!page) return POWDER_PRODUCT_IDS.includes(product.productId) ? [product] : [];
    if (pageSlugsShown.has(page.slug)) return [];
    pageSlugsShown.add(page.slug);
    // Name, pack and prices as on the website (from its page); the category stays the card's own
    return [{ ...product, ...cardPricesFromPage(page), category: product.category, name: page.name }];
  });
  const [today] = useState(() => new Date());
  const [searchText, setSearchText] = useState("");
  const [tab, setTab] = useState<CategoryTab>("all");
  // Set by clicking the Low stock / Out of stock card
  const [stockFilter, setStockFilter] = useState<"low" | "out" | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  // null: no pop-up open; "new": Add product; otherwise the id of the product being changed
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  // "Add product": asks subscription or one-time, then the product's details and its website page
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  // The new product being filled in (after its kind is chosen)
  const [newProduct, setNewProduct] = useState<{ kind: ProductKind; category: ProductCategory } | null>(null);
  // "Arrange product rows": the Fast selling / You may also like rows under the product pages
  const [isArrangingRows, setIsArrangingRows] = useState(false);
  const { showToast, toast } = useAdminToast();
  // "Set delivery charge" (owner only): delivery settings are kept per product page (how the cart finds a product)
  const isPanelOwner = useIsPanelOwner();
  const [isSettingDelivery, setIsSettingDelivery] = useState(false);
  const deliveryProducts = products.map((product) => ({ ...product, productId: findPageOfCard(productPages, product.productId)?.slug ?? product.productId }));

  const words = searchText.trim().toLowerCase();
  const matching = products.filter(
    (product) => !words || `${product.name} ${product.packSize} ${product.category}`.toLowerCase().includes(words),
  );
  const shown = matching.filter(
    (product) => (tab === "all" || product.category === tab) && (!stockFilter || product.stock === stockFilter),
  );

  /*
    Product pages: their Open / Edit page / Delete buttons sit on their card. A page with no card here (for
    example a product added in the code) gets a card of its own in the same grid, and a page from the code
    deleted in the panel keeps a faded card with "Restore page". These follow the search and the tabs.
  */
  const deletedStartingPages = useDeletedStartingProductPages();
  const pagesWithoutCard = productPages.filter((page) => !products.some((product) => findPageOfCard([page], product.productId)));
  // The tabs and the Products number count these too
  const pagesWithoutCardMatching = pagesWithoutCard.filter((page) => !words || page.name.toLowerCase().includes(words));
  const pageCategory = (page: ProductPage) => CATEGORY_FROM_SHOP_CATEGORY[page.shopCategory ?? "Others"];
  // Every product is treated the same: a page without a card gets one (once; the ref stops a second copy).
  // Only once the cards have been read from the database, so an existing card is never made again.
  const cardsMadeForSlugs = useRef(new Set<string>());
  const haveProductsLoaded = useHaveProductsLoaded();
  useEffect(() => {
    if (!haveProductsLoaded) return;
    pagesWithoutCard.forEach((page) => {
      if (cardsMadeForSlugs.current.has(page.slug)) return;
      cardsMadeForSlugs.current.add(page.slug);
      makeCardForPage(page);
    });
  });
  const pageOnlyCards = [
    ...pagesWithoutCard.map((page) => ({ page, isDeleted: false })),
    ...deletedStartingPages.map((page) => ({ page, isDeleted: true })),
  ].filter(
    ({ page }) =>
      !stockFilter &&
      (!words || page.name.toLowerCase().includes(words)) &&
      (tab === "all" || CATEGORY_FROM_SHOP_CATEGORY[page.shopCategory ?? "Others"] === tab),
  );
  const [openPageSlug, setOpenPageSlug] = useState<string | null>(null);
  const [isPageDeleteAsked, setIsPageDeleteAsked] = useState(false);
  const canDelete = useAdminCan("delete");
  const openPageCard =
    productPages.map((page) => ({ page, isDeleted: false })).find(({ page }) => page.slug === openPageSlug) ??
    deletedStartingPages.map((page) => ({ page, isDeleted: true })).find(({ page }) => page.slug === openPageSlug);

  function showStock(stock: "low" | "out") {
    const isTurningOn = stockFilter !== stock;
    setStockFilter(isTurningOn ? stock : null);
    if (isTurningOn) {
      setTab("all");
      setSearchText("");
      // Bring the cards into view below the numbers
      window.setTimeout(() => gridRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  }
  // The tabs: the standard categories and any the admin added
  const categories = useProductCategories();
  const countIn = (category: ProductCategory) =>
    matching.filter((product) => product.category === category).length +
    pagesWithoutCardMatching.filter((page) => pageCategory(page) === category).length;

  const productCount = products.length + pagesWithoutCard.length;
  const available =
    products.filter(isAvailableToOrder).length + pagesWithoutCard.filter((page) => page.status === "published").length;
  const lowStock = products.filter((product) => product.stock === "low").length;
  const outOfStock = products.filter((product) => product.stock === "out").length;
  const bestSeller = products.reduce<ShopProduct | null>(
    (best, product) => (!best || product.unitsPerDay > best.unitsPerDay ? product : best),
    null,
  );
  const editing = editingId === "new" ? "new" : products.find((product) => product.productId === editingId);

  function switchAvailability(product: ShopProduct) {
    if (product.stock === "out") {
      showToast("It is out of stock. Open it and switch on Restocked");
      return;
    }
    updateProduct(product.productId, { isVisible: !product.isVisible });
    showToast(`${product.name} ${product.isVisible ? "shows as Sold out on" : "can be ordered on"} the website`);
  }

  function exportProducts() {
    downloadCsv(`chiranvi-products-${toDateFileName(today)}.csv`, [
      ["Product", "Pack", "Category", "Price (₹)", "Old price (₹)", "Discount (%)", "Subscription (₹)", "Stock", "On website", "Units a day"],
      ...shown.map((product) => [
        product.name,
        product.packSize,
        product.category,
        product.price,
        product.originalPrice ?? "",
        getDiscountPercent(product) || "",
        product.subscriptionPrice ?? "",
        STOCK_LABELS[product.stock],
        isAvailableToOrder(product) ? "Available" : "Sold out",
        product.unitsPerDay,
      ]),
    ]);
  }

  return (
    <div className={dashboardStyles["admin-dashboard"]}>
      <AdminPageTop
        title="Products & pricing"
        description="Milk has subscription and one-time prices · all other products are one-time only"
        searchText={searchText}
        onSearchTextChange={setSearchText}
        searchPlaceholder="Search products..."
        actionLabel="Add product"
        onAction={() => setIsAddingProduct(true)}
        onExport={exportProducts}
        beforeExport={
          isPanelOwner ? (
            <button type="button" className={deliveryPopupStyles["set-delivery-charge-button"]} onClick={() => setIsSettingDelivery(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7h11v9H3z" />
                <path d="M14 10h4l3 3v3h-7" />
                <path d="M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01" />
              </svg>
              Set delivery charge
            </button>
          ) : null
        }
        belowSearch={
          <AdminFilterTabs
            label="Show category"
            selected={tab}
            onSelect={setTab}
            tabs={[
              { key: "all", label: `All ${matching.length + pagesWithoutCardMatching.length}` },
              ...categories.map((category) => ({ key: category, label: `${category} ${countIn(category)}` })),
            ]}
          />
        }
      />

      <AdminStatCards
        stats={[
          {
            label: "Products",
            value: String(productCount),
            note: `${available} available · ${productCount - available} sold out`,
            trend: "plain",
            icon: ["M4 8l8-4 8 4-8 4-8-4Z", "M4 8v8l8 4 8-4V8", "M12 12v8"],
          },
          {
            label: "Best seller",
            value: bestSeller ? `${bestSeller.name} ${bestSeller.packSize.replace(/ (pouch|pack|jar|glass bottle)$/, "")}` : "—",
            note: `${bestSeller?.unitsPerDay ?? 0} units/day`,
            trend: "up",
            isTextValue: true,
            icon: ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"],
          },
          {
            label: "Low stock",
            value: String(lowStock),
            note: "Restock before 6 PM",
            trend: lowStock ? "bad" : "plain",
            icon: ["M12 4l9 16H3L12 4Z", "M12 10v4", "M12 17h.01"],
            onClick: () => showStock("low"),
            isSelected: stockFilter === "low",
            clickLabel: "Show low stock products",
          },
          {
            label: "Out of stock",
            value: String(outOfStock),
            note: "Shown as Sold out",
            trend: outOfStock ? "bad" : "plain",
            icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M5.6 5.6l12.8 12.8"],
            onClick: () => showStock("out"),
            isSelected: stockFilter === "out",
            clickLabel: "Show out of stock products",
          },
        ]}
      />

      {/* The row of five products under every product page, and its order */}
      <div className={styles["admin-product-rows-bar"]}>
        <p className={styles["admin-product-rows-bar-text"]}>
          <strong>Product rows</strong> · the five products under each product page: Fast selling products, and You may also like on the
          noodles, pasta and macaroni pages
        </p>
        <button type="button" className={styles["admin-product-rows-bar-button"]} onClick={() => setIsArrangingRows(true)}>
          Arrange product rows
        </button>
      </div>

      {stockFilter && (
        <div className={styles["admin-product-filter-row"]}>
          <p className={styles["admin-product-filter-text"]}>
            Showing <strong>{stockFilter === "low" ? "low stock" : "out of stock"}</strong> products ({shown.length})
          </p>
          <button type="button" className={styles["admin-product-filter-clear"]} onClick={() => setStockFilter(null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            Show all products
          </button>
        </div>
      )}

      <ul ref={gridRef} className={styles["admin-product-grid"]}>
        {shown.map((product) => {
          const canBeOrdered = isAvailableToOrder(product);
          const discount = getDiscountPercent(product);
          const cardPage = findPageOfCard(productPages, product.productId);
          return (
            <li
              key={product.productId}
              className={`${styles["admin-product-card"]} ${canBeOrdered ? "" : styles["admin-product-card-hidden"]}`}
            >
              <button
                type="button"
                className={styles["admin-product-open-button"]}
                aria-label={`Change ${product.name} ${product.packSize}`}
                onClick={() => setEditingId(product.productId)}
              >
                <span className={styles["admin-product-image-area"]}>
                  <span className={`${dashboardStyles["admin-status"]} ${STOCK_CLASS_NAMES[product.stock]} ${styles["admin-product-stock"]}`}>
                    {STOCK_LABELS[product.stock]}
                  </span>
                  {product.showOnBestSellers && <span className={styles["admin-product-best-seller-tag"]}>Best Seller</span>}
                  {discount > 0 && <span className={styles["admin-product-discount-tag"]}>{discount}% off</span>}
                  <ProductPhoto product={photoOfCard(product, cardPage)} className={styles["admin-product-image"]} sizes="120px" />
                </span>
                <span className={styles["admin-product-name"]}>{product.name}</span>
                <span className={styles["admin-product-pack"]}>
                  {product.packSize} · {product.category}
                </span>
                {/* Where its website page comes from (a small note; every card works the same) */}
                <span className={styles["admin-product-origin-note"]}>
                  {!cardPage
                    ? "No product page yet"
                    : isStartingProductPage(cardPage.slug)
                      ? "Built-in page"
                      : "Page added in the panel"}
                </span>
                {!canBeOrdered && <span className={styles["admin-product-sold-out-note"]}>Shows as Sold out on the website</span>}
              </button>

              <div className={styles["admin-product-bottom-row"]}>
                <p className={styles["admin-product-prices"]}>
                  <span className={styles["admin-product-price"]}>
                    ₹{product.price}
                    {product.originalPrice && <s className={styles["admin-product-old-price"]}>₹{product.originalPrice}</s>}
                  </span>
                  <span className={styles["admin-product-subscription"]}>
                    {product.subscriptionPrice ? `Subscription ₹${product.subscriptionPrice}` : "One-time only"}
                  </span>
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={canBeOrdered}
                  aria-label={`${product.name} ${product.packSize} can be ordered on the website`}
                  title={canBeOrdered ? "Can be ordered on the website" : "Shows as Sold out on the website"}
                  className={`${styles["admin-product-switch"]} ${canBeOrdered ? styles["admin-product-switch-on"] : ""}`}
                  onClick={() => switchAvailability(product)}
                >
                  <span className={styles["admin-product-switch-knob"]} />
                </button>
              </div>
            </li>
          );
        })}
        {pageOnlyCards.map(({ page, isDeleted }) => {
          const picture = page.pictures[0];
          const priceText =
            page.kind === "subscription"
              ? `₹${page.price} / ${page.unitName}`
              : (() => {
                  const pack = page.packs.find((onePack) => onePack.packId === page.defaultPackId) ?? page.packs[0];
                  return pack ? `₹${pack.price} / ${pack.label}` : "";
                })();
          return (
            <li key={`page-${page.slug}`} className={`${styles["admin-product-card"]} ${isDeleted ? styles["admin-product-card-hidden"] : ""}`}>
              {/* Clicking opens its page form to edit (or Restore page, when it was deleted) */}
              <button
                type="button"
                className={styles["admin-product-open-button"]}
                aria-label={`${page.name} website page`}
                onClick={() => setOpenPageSlug(page.slug)}
              >
                <span className={styles["admin-product-image-area"]}>
                  <span className={`${dashboardStyles["admin-status"]} ${styles["admin-product-stock"]} ${isDeleted ? sharedStyles["admin-status-warning"] : dashboardStyles["admin-status-delivered"]}`}>
                    {isDeleted ? "Deleted" : page.status === "draft" ? "Draft" : "On website"}
                  </span>
                  {picture && (
                    <ProductPhoto
                      product={{ imageSource: picture.imageSource, imageWidth: picture.imageWidth, imageHeight: picture.imageHeight }}
                      className={styles["admin-product-image"]}
                      sizes="120px"
                    />
                  )}
                </span>
                <span className={styles["admin-product-name"]}>{page.name}</span>
                <span className={styles["admin-product-pack"]}>
                  {page.kind === "subscription" ? "Subscription" : "One-time"} · {CATEGORY_FROM_SHOP_CATEGORY[page.shopCategory ?? "Others"]}
                </span>
              </button>
              <div className={styles["admin-product-bottom-row"]}>
                <p className={styles["admin-product-prices"]}>
                  <span className={styles["admin-product-price"]}>{priceText}</span>
                  <span className={styles["admin-product-subscription"]}>Product page only</span>
                </p>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && pageOnlyCards.length === 0 && <li className={styles["admin-product-empty"]}>{stockFilter ? (stockFilter === "low" ? "No products are low on stock." : "No products are out of stock.") : "No products match this search."}</li>}
      </ul>

      {editing && (
        <ProductPopup
          key={editingId}
          product={editing === "new" ? null : editing}
          page={editing === "new" ? undefined : findPageOfCard(productPages, editing.productId)}
          onClose={() => setEditingId(null)}
          showToast={showToast}
        />
      )}

      {/* A product page with no card of its own: edit it right away, with Delete product at the bottom */}
      {openPageCard && !openPageCard.isDeleted && (
        <ProductPageForm
          key={openPageCard.page.slug}
          editingPage={openPageCard.page}
          onClose={() => setOpenPageSlug(null)}
          showToast={showToast}
          onDelete={canDelete ? () => setIsPageDeleteAsked(true) : undefined}
        />
      )}
      {openPageCard && !openPageCard.isDeleted && isPageDeleteAsked && (
        <AdminDialog
          title={`Delete ${openPageCard.page.name}?`}
          submitLabel="Yes, delete"
          isDanger
          onClose={() => setIsPageDeleteAsked(false)}
          onSubmit={() => {
            deleteProductAndPage(null, openPageCard.page);
            showToast(`${openPageCard.page.name} deleted`);
            setIsPageDeleteAsked(false);
            setOpenPageSlug(null);
          }}
        >
          <p className={styles["admin-product-page-only-dialog"]}>It will be removed from the panel and the website.</p>
        </AdminDialog>
      )}
      {/* A product from the code that was deleted: Restore page brings it back */}
      {openPageCard?.isDeleted && (
        <AdminDialog title={openPageCard.page.name} submitLabel="Close" onClose={() => setOpenPageSlug(null)} onSubmit={() => setOpenPageSlug(null)}>
          <div className={styles["admin-product-page-only-dialog"]}>
            <p>
              {openPageCard.page.kind === "subscription" ? "Subscription" : "One-time"} product · /products/{openPageCard.page.slug}
            </p>
            <ProductPageCardActions page={openPageCard.page} isDeleted={openPageCard.isDeleted} showToast={showToast} />
          </div>
        </AdminDialog>
      )}

      {/* Add product: the kind first, then the same pop-up as editing a product */}
      {isAddingProduct && (
        <ChooseProductKindDialog
          onClose={() => setIsAddingProduct(false)}
          onChosen={(kind, category) => {
            setIsAddingProduct(false);
            setNewProduct({ kind, category });
          }}
        />
      )}
      {newProduct && (
        <ProductPopup key="new-product" product={null} newProduct={newProduct} onClose={() => setNewProduct(null)} showToast={showToast} />
      )}

      {isArrangingRows && <ProductRowsDialog onClose={() => setIsArrangingRows(false)} showToast={showToast} />}

      {isSettingDelivery && (
        <AdminDeliveryChargesPopup
          products={deliveryProducts}
          onClose={() => setIsSettingDelivery(false)}
          onSaved={(message) => {
            setIsSettingDelivery(false);
            showToast(message);
          }}
        />
      )}

      {toast}
    </div>
  );
}

function ProductPhoto({ product, className, sizes }: { product: Pick<ShopProduct, "imageSource" | "imageWidth" | "imageHeight">; className: string; sizes: string }) {
  if (!product.imageSource) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["admin-product-placeholder"]}>
        <path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5Z" />
      </svg>
    );
  }
  return (
    <Image
      src={product.imageSource}
      alt=""
      width={product.imageWidth ?? 400}
      height={product.imageHeight ?? 400}
      sizes={sizes}
      className={className}
    />
  );
}

/*
  The product pop-up. The page behind is blurred. Add product uses it too (newProduct: the chosen kind and
  category): the same photo, stock and details, and the website page's fields below, empty; saving
  creates the page and its card together.
  Old price + discount work together: change the discount and the price follows, change the price and
  the discount follows.
*/
function ProductPopup({
  product,
  page,
  newProduct,
  onClose,
  showToast,
}: {
  product: ShopProduct | null;
  page?: ProductPage; // its website page, when it has one (Open / Edit page / Delete page in the pop-up)
  newProduct?: { kind: ProductKind; category: ProductCategory };
  onClose: () => void;
  showToast: (message: string) => void;
}) {
  // The website page's fields show for a product with a page, and for a new product (its page is made)
  const hasPageForm = Boolean(page || newProduct);
  // The photo starts as the one the website shows (its page's first picture), so both always match
  const [form, setForm] = useState<ProductForm>(() =>
    product ? { ...toForm(product), ...photoOfCard(product, page) } : { ...EMPTY_FORM, category: newProduct?.category ?? EMPTY_FORM.category },
  );
  // Saves the website page fields below (one Save changes for the card and its page)
  const pageSaveRef = useRef<(() => boolean) | null>(null);
  // The page as just saved: the card takes its prices and pack from it
  const savedPageRef = useRef<ProductPage | null>(null);
  const [isPageProblem, setIsPageProblem] = useState(false);
  const changedBy = useCurrentStaffAccess()?.name ?? "Chiranvi Panel";
  const team = useStaffMembers();
  // Prices are changed only by the owner; the Delete button needs Delete (Roles & permissions)
  const isOwner = useIsPanelOwner();
  const canDelete = useAdminCan("delete");
  const isOutOfStock = product?.stock === "out";
  // The stock boxes, one per pack size (empty: not counted, the label is set by hand)
  const stockSizes = product ? stockSizesOf(product, page) : [];
  const savedCounts = product?.stockCounts ?? {};
  const [countTexts, setCountTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(savedCounts).map(([key, count]) => [key, String(count)])),
  );
  const hasCounts = stockSizes.some((size) => countTexts[size.key]);
  const startingPhoto = product ? getStartingPhoto(product.productId) : null;
  const waitingCount = product?.waitingCustomers?.length ?? 0;
  const [isDeleteAsked, setIsDeleteAsked] = useState(false);
  // Shown inside the pop-up (a toast would sit behind it): empty boxes turn red after Save is pressed
  const [hasTriedSaving, setHasTriedSaving] = useState(false);
  const [photoProblem, setPhotoProblem] = useState("");
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
  // With a page, the pack and prices are set in the page's fields below (checked there), not here
  const missingFields = [
    !form.name.trim() && "Product name",
    !hasPageForm && !form.packSize.trim() && "Pack",
    !hasPageForm && !Number(form.price) && "Selling price",
  ].filter((field): field is string => Boolean(field));
  const isMissing = (field: string) => hasTriedSaving && missingFields.includes(field);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function changeOldPrice(text: string) {
    const originalPrice = onlyDigits(text);
    const discount = Number(form.discountPercent);
    setForm({
      ...form,
      originalPrice,
      price: discount && Number(originalPrice) ? String(Math.round(Number(originalPrice) * (1 - discount / 100))) : form.price,
    });
  }

  function changeDiscount(text: string) {
    const discountPercent = String(Math.min(90, Number(onlyDigits(text)) || 0) || "");
    const oldPrice = Number(form.originalPrice);
    setForm({
      ...form,
      discountPercent,
      price: oldPrice ? String(Math.round(oldPrice * (1 - (Number(discountPercent) || 0) / 100))) : form.price,
    });
  }

  function changePrice(text: string) {
    const price = onlyDigits(text);
    const oldPrice = Number(form.originalPrice);
    const discount = oldPrice > Number(price) && Number(price) ? Math.round((1 - Number(price) / oldPrice) * 100) : 0;
    setForm({ ...form, price, discountPercent: discount ? String(discount) : "" });
  }

  // The same preparation as the page form: background removed, soft shadow below, see-through WebP (up to 25 MB)
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setIsPreparingPhoto(true);
    setPhotoProblem("");
    try {
      // White products (milk) keep their light bottom; others lose the photo's grey floor shadow
      const photo = await processPictureFile(file, form.category !== "Milk");
      // Keeps anything typed while the photo was loading
      setForm((latestForm) => ({ ...latestForm, ...photo }));
    } catch (error) {
      setPhotoProblem(
        error instanceof Error && error.message === PICTURE_TOO_BIG_MESSAGE
          ? PICTURE_TOO_BIG_MESSAGE
          : "That file is not a picture. Choose a JPG, PNG or WEBP.",
      );
    }
    setIsPreparingPhoto(false);
  }

  function save() {
    const price = Number(form.price);
    if (missingFields.length) {
      setHasTriedSaving(true);
      // With a website page its check still runs, so everything missing is listed together at the end
      if (hasPageForm && pageSaveRef.current && !pageSaveRef.current()) setIsPageProblem(true);
      return;
    }
    const oldPrice = Number(form.originalPrice);
    // (With a page the prices are checked by the page's own fields, which refuse a change by anyone but the owner)
    const isPriceChanged =
      !page &&
      product &&
      (price !== product.price ||
        (Number(form.originalPrice) || undefined) !== product.originalPrice ||
        (form.category === "Milk" ? Number(form.subscriptionPrice) || undefined : undefined) !== product.subscriptionPrice);
    if (isPriceChanged && !isOwner) {
      showToast(OWNER_ONLY_MESSAGE);
      return;
    }
    // The page is saved first: if one of its fields is missing, nothing is saved yet
    if (hasPageForm && pageSaveRef.current && !pageSaveRef.current()) {
      setIsPageProblem(true);
      return;
    }
    setIsPageProblem(false);
    const savedPage = hasPageForm ? savedPageRef.current : null;
    const details = {
      name: form.name.trim(),
      category: form.category,
      packSize: form.packSize.trim(),
      price,
      originalPrice: oldPrice > price ? oldPrice : undefined,
      // Only milk can be subscribed to
      subscriptionPrice: form.category === "Milk" ? Number(form.subscriptionPrice) || undefined : undefined,
      // With a page: pack and prices from the page just saved (the category stays the one chosen here)
      ...(savedPage ? { ...cardPricesFromPage(savedPage), category: form.category } : {}),
      showOnBestSellers: form.showOnBestSellers,
      // An uploaded photo of a product with a page is kept on the page only (the card shows the page's
      // photo), so the browser's small storage holds it once
      ...(page && form.imageSource?.startsWith("data:")
        ? {}
        : { imageSource: form.imageSource, imageWidth: form.imageWidth, imageHeight: form.imageHeight }),
    };

    if (!product) {
      if (savedPage) {
        // A new product: its page is saved; its card (id = the page address) takes the stock, switch,
        // Best Sellers and category chosen here
        const cardId = makeCardForPage(savedPage);
        updateProduct(cardId, {
          category: form.category,
          stock: form.stock,
          isVisible: form.isVisible && form.stock !== "out",
          showOnBestSellers: form.showOnBestSellers,
        });
        showToast(`${savedPage.name} added · /products/${savedPage.slug}`);
      } else {
        addProduct({ ...details, stock: form.stock, isVisible: form.isVisible && form.stock !== "out" });
        showToast(`${details.name} added`);
      }
      onClose();
      return;
    }

    // Only the boxes that changed are sent (a sale meanwhile isn't undone for the others)
    const changedCounts: Record<string, number | null> = {};
    for (const size of stockSizes) {
      const text = countTexts[size.key] ?? "";
      if (text !== (size.key in savedCounts ? String(savedCounts[size.key]) : "")) changedCounts[size.key] = text === "" ? null : Number(text);
    }
    const saveCounts = () => {
      if (Object.keys(changedCounts).length === 0) return;
      void saveStockCounts(product.productId, changedCounts).then((problem) => {
        if (problem) showToast(problem);
      });
    };

    // Out of stock and a new count entered: that is a restock (the manager and waiting customers are told)
    const isRestockedByCount = isOutOfStock && Object.values(changedCounts).some((count) => count !== null && count > 0);
    if (isOutOfStock && (form.isRestocked || isRestockedByCount)) {
      const managers = team.filter((member) => member.roleId === "manager").map((member) => member.name);
      const notice = markRestocked(product.productId, changedBy, managers);
      updateProduct(product.productId, { ...details, stock: form.stock === "out" ? "in" : form.stock }, changedBy);
      showToast(
        `Restocked. ${notice?.sentTo.join(", ")} notified${notice?.customersNotified ? ` · ${notice.customersNotified} waiting customers told` : ""}`,
      );
    } else {
      // With counts the database sets the label, so the buttons' choice isn't used
      const stock = hasCounts ? product.stock : form.stock;
      updateProduct(
        product.productId,
        { ...details, stock, isVisible: !hasCounts && stock === "out" ? false : form.isVisible },
        changedBy,
      );
      showToast(`${details.name} · ${details.packSize} saved`);
    }
    saveCounts();
    onClose();
  }

  const priceNumber = Number(form.price);
  const oldPriceNumber = Number(form.originalPrice);
  const stockShown: StockLevel = isOutOfStock && form.isRestocked && form.stock === "out" ? "in" : form.stock;
  const willBeAvailable = stockShown !== "out" && (form.isVisible || (isOutOfStock && form.isRestocked));

  return (
    <div className={styles["admin-product-popup-backdrop"]} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={product ? `${product.name} ${product.packSize}` : "Add product"}
        className={styles["admin-product-popup"]}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          save();
        }}
      >
        {isOutOfStock && product?.outOfStockReport && (
          <p className={styles["admin-product-popup-warning"]} role="alert">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4l9 16H3L12 4Z" />
              <path d="M12 10v4M12 17h.01" />
            </svg>
            <span>
              <strong>Out of stock.</strong> Reported by {product.outOfStockReport.reportedBy} on{" "}
              {formatWhen(product.outOfStockReport.reportedAt)}. Customers see this product as Sold out until it is
              marked as restocked.
            </span>
          </p>
        )}

        <div className={styles["admin-product-popup-heading"]}>
          <div>
            <h2 className={styles["admin-product-popup-title"]}>{product ? product.name : "Add product"}</h2>
            <p className={styles["admin-product-popup-subtitle"]}>
              {product
                ? `${product.packSize} · ${product.category}${product.updatedAt ? ` · last changed ${formatWhen(product.updatedAt)}` : ""}`
                : "Fill in the details; it shows on the website once saved"}
            </p>
            {/* The product's ID for the database (its page address; each pack's ID adds the pack, e.g. -1-litre) */}
            {product && (
              <p className={styles["admin-product-popup-subtitle"]}>
                Product ID: <strong>{page?.slug ?? product.productId}</strong>
              </p>
            )}
          </div>
          <button type="button" className={styles["admin-product-popup-close"]} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={styles["admin-product-popup-columns"]}>
          {/* Photo and how the website shows it */}
          <div className={styles["admin-product-popup-photo-column"]}>
            <div className={styles["admin-product-popup-photo"]}>
              <ProductPhoto product={form} className={styles["admin-product-popup-image"]} sizes="260px" />
              {!willBeAvailable && <span className={styles["admin-product-popup-sold-out"]}>Sold out</span>}
            </div>
            <label className={styles["admin-product-photo-button"]}>
              <input
                type="file"
                accept="image/*"
                className={dashboardStyles["admin-visually-hidden"]}
                onChange={(changeEvent) => {
                  choosePhoto(changeEvent.target.files?.[0]);
                  changeEvent.target.value = "";
                }}
              />
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4v-11Z" />
                <path d="M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              </svg>
              {isPreparingPhoto ? "Removing the background…" : form.imageSource ? "Change photo" : "Add photo"}
            </label>
            {photoProblem &&<p className={styles["admin-product-field-problem"]}>{photoProblem}</p>}
            {startingPhoto && form.imageSource !== startingPhoto.imageSource && (
              <button
                type="button"
                className={styles["admin-product-photo-reset"]}
                onClick={() => setForm({ ...form, ...startingPhoto })}
              >
                Use the original photo
              </button>
            )}

            <p className={styles["admin-product-popup-website-line"]}>
              On the website:{" "}
              <strong className={willBeAvailable ? styles["admin-product-available-text"] : styles["admin-product-sold-out-text"]}>
                {willBeAvailable ? "Available to order" : "Sold out · Notify me"}
              </strong>
            </p>
            {product && waitingCount > 0 && (
              <p className={styles["admin-product-popup-waiting"]}>
                {waitingCount} {waitingCount === 1 ? "customer is" : "customers are"} waiting to be notified
              </p>
            )}

            {/* Its website page (/products/…); its fields are below, saved with Save changes */}
            {page && (
              <div className={styles["admin-product-popup-page-section"]}>
                <p className={styles["admin-product-popup-page-title"]}>Website page</p>
                <a
                  className={styles["admin-product-popup-page-link"]}
                  href={`/products/${page.slug}${page.status === "draft" ? "?preview=1" : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {page.status === "draft" ? "Preview" : "Open"} /products/{page.slug} ↗
                </a>
              </div>
            )}
          </div>

          <div className={styles["admin-product-popup-fields"]}>
            {/* Restock: only for out-of-stock products (a counted one is restocked by entering a new count) */}
            {isOutOfStock && !hasCounts && (
              <div className={styles["admin-product-restock-row"]}>
                <span>
                  <span className={styles["admin-product-option-title"]}>Restocked</span>
                  <span className={styles["admin-product-option-detail"]}>
                    Marks it in stock and notifies the manager
                    {waitingCount ? ` and ${waitingCount} waiting customers` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isRestocked}
                  aria-label="Restocked"
                  className={`${styles["admin-product-switch"]} ${form.isRestocked ? styles["admin-product-switch-on"] : ""}`}
                  onClick={() =>
                    setForm({ ...form, isRestocked: !form.isRestocked, stock: !form.isRestocked ? "in" : "out" })
                  }
                >
                  <span className={styles["admin-product-switch-knob"]} />
                </button>
              </div>
            )}

            {/* With a website page the prices are set once, in its pack sizes (milk: price & plans) below */}
            {hasPageForm ? (
              <fieldset className={styles["admin-product-popup-group"]}>
                <legend className={styles["admin-product-group-title"]}>Price</legend>
                <p className={styles["admin-product-one-time-note"]}>
                  Set below in {(page?.kind ?? newProduct?.kind) === "subscription" ? "Price & units and Subscription plans" : "Pack sizes & prices"}{" "}
                  (what the website shows)
                </p>
              </fieldset>
            ) : (
            <fieldset className={styles["admin-product-popup-group"]}>
              <legend className={styles["admin-product-group-title"]}>Price</legend>
              <div className={styles["admin-product-field-grid"]}>
                <PopupField label="Old price (₹, crossed out)">
                  <input className={adminInputClassName} inputMode="numeric" placeholder="Optional" value={form.originalPrice} onChange={(changeEvent) => changeOldPrice(changeEvent.target.value)} />
                </PopupField>
                <PopupField label="Discount (%)">
                  <input
                    className={adminInputClassName}
                    inputMode="numeric"
                    placeholder={form.originalPrice ? "0" : "Add an old price first"}
                    disabled={!form.originalPrice}
                    value={form.discountPercent}
                    onChange={(changeEvent) => changeDiscount(changeEvent.target.value)}
                  />
                </PopupField>
                <PopupField label="Selling price (₹)" isMissing={isMissing("Selling price")}>
                  <input className={adminInputClassName} inputMode="numeric" value={form.price} onChange={(changeEvent) => changePrice(changeEvent.target.value)} autoFocus={!product} />
                </PopupField>
                {form.category === "Milk" ? (
                  <PopupField label="Subscription price (₹ a day)">
                    <input
                      className={adminInputClassName}
                      inputMode="numeric"
                      placeholder="Optional"
                      value={form.subscriptionPrice}
                      onChange={(changeEvent) => setForm({ ...form, subscriptionPrice: onlyDigits(changeEvent.target.value) })}
                    />
                  </PopupField>
                ) : (
                  <p className={styles["admin-product-one-time-note"]}>One-time only (subscriptions are for milk)</p>
                )}
              </div>
              {priceNumber > 0 && oldPriceNumber > priceNumber && (
                <p className={styles["admin-product-saving-line"]}>
                  Customers save ₹{oldPriceNumber - priceNumber} ({Math.round((1 - priceNumber / oldPriceNumber) * 100)}% off)
                </p>
              )}
            </fieldset>
            )}

            <fieldset className={styles["admin-product-popup-group"]}>
              <legend className={styles["admin-product-group-title"]}>Stock</legend>
              <div className={styles["admin-product-stock-buttons"]} role="group" aria-label="Stock">
                {(Object.keys(STOCK_LABELS) as StockLevel[]).map((stock) => (
                  <button
                    key={stock}
                    type="button"
                    aria-pressed={stockShown === stock}
                    disabled={hasCounts}
                    className={`${styles["admin-product-stock-button"]} ${stockShown === stock ? styles[`admin-product-stock-button-${stock}`] : ""}`}
                    onClick={() => setForm({ ...form, stock, isRestocked: isOutOfStock ? stock !== "out" : false })}
                  >
                    {stock === "out" ? "Not in stock" : STOCK_LABELS[stock]}
                  </button>
                ))}
              </div>
              {!isOutOfStock && form.stock === "out" && product && !hasCounts && (
                <p className={styles["admin-product-stock-warning"]}>Saving marks it out of stock: the website shows it as Sold out.</p>
              )}
              {/* How many are in stock, per pack size */}
              {product && (
                <>
                  <div className={`${styles["admin-product-field-grid"]} ${styles["admin-product-stock-count-grid"]}`}>
                    {stockSizes.map((size) => (
                      <PopupField key={size.key} label={`${size.label} in stock`}>
                        <input
                          className={adminInputClassName}
                          inputMode="numeric"
                          placeholder="Not counted"
                          value={countTexts[size.key] ?? ""}
                          onChange={(changeEvent) => setCountTexts({ ...countTexts, [size.key]: onlyDigits(changeEvent.target.value) })}
                        />
                      </PopupField>
                    ))}
                  </div>
                  <p className={styles["admin-product-stock-count-note"]}>
                    With a number, paid orders lower it and the stock label above follows it (Low at 5 or less). Leave it empty to set the label by hand.
                  </p>
                </>
              )}
            </fieldset>

            <fieldset className={styles["admin-product-popup-group"]}>
              <legend className={styles["admin-product-group-title"]}>Details</legend>
              <div className={styles["admin-product-field-grid"]}>
                <PopupField label="Product name" isWide isMissing={isMissing("Product name")}>
                  <input className={adminInputClassName} value={form.name} onChange={(changeEvent) => setForm({ ...form, name: changeEvent.target.value })} />
                </PopupField>
                {/* With a page the pack comes from its "Pack shown first" (milk: its pack) */}
                {!hasPageForm && (
                  <PopupField label="Pack" isMissing={isMissing("Pack")}>
                    <input className={adminInputClassName} placeholder="e.g. 1 L pouch, 500 g" value={form.packSize} onChange={(changeEvent) => setForm({ ...form, packSize: changeEvent.target.value })} />
                  </PopupField>
                )}
                <PopupField label="Category">
                  {/* The categories, and "+ Add new category…" */}
                  <CategoryPicker value={form.category} onChange={(category) => setForm((latestForm) => ({ ...latestForm, category }))} />
                </PopupField>
              </div>
            </fieldset>

            <div className={styles["admin-product-option-row"]}>
              <span>
                <span className={styles["admin-product-option-title"]}>Sell on the website</span>
                <span className={styles["admin-product-option-detail"]}>Off: shows as Sold out with a Notify me button</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.isVisible && stockShown !== "out"}
                aria-label="Sell on the website"
                disabled={stockShown === "out"}
                className={`${styles["admin-product-switch"]} ${form.isVisible && stockShown !== "out" ? styles["admin-product-switch-on"] : ""}`}
                onClick={() => setForm({ ...form, isVisible: !form.isVisible })}
              >
                <span className={styles["admin-product-switch-knob"]} />
              </button>
            </div>
            <label className={styles["admin-product-checkbox-row"]}>
              <input type="checkbox" checked={form.showOnBestSellers} onChange={(changeEvent) => setForm({ ...form, showOnBestSellers: changeEvent.target.checked })} />
              Show in Best Sellers on the landing page
            </label>
          </div>
        </div>

        {/* The website page's fields (description, packs, information …); name and photo come from above */}
        {hasPageForm && (
          <ProductPageForm
            editingPage={page}
            onClose={onClose}
            showToast={showToast}
            embedded={{
              registerSave: (savePage) => {
                pageSaveRef.current = savePage;
              },
              onSaved: (savedPage) => {
                savedPageRef.current = savedPage;
              },
              canChangePrices: isOwner,
              newKind: newProduct?.kind,
              category: form.category,
              name: form.name,
              photo: form.imageSource
                ? { imageSource: form.imageSource, imageWidth: form.imageWidth ?? 400, imageHeight: form.imageHeight ?? 400 }
                : undefined,
            }}
          />
        )}

        {isPageProblem && (
          <p className={styles["admin-product-save-problem"]} role="alert">
            Fill in the details listed above to {product ? "save" : "add the product"}.
          </p>
        )}
        {/* (With a website page, its list above already names these) */}
        {hasTriedSaving && missingFields.length > 0 && !hasPageForm && (
          <p className={styles["admin-product-save-problem"]} role="alert">
            Fill in {missingFields.join(", ").replace(/, ([^,]*)$/, " and $1")} to {product ? "save" : "add the product"}.
          </p>
        )}

        {isDeleteAsked && product ? (
          // Delete asks once more before the product is gone
          <div className={`${styles["admin-product-popup-buttons"]} ${styles["admin-product-delete-confirm"]}`} role="alert">
            <p className={styles["admin-product-delete-question"]}>
              Delete {product.name} · {product.packSize}? It{page ? " and its website page" : ""} will be removed from the panel
              and the website.{page && isStartingProductPage(page.slug) ? "" : " This cannot be undone."}
            </p>
            <button type="button" className={sharedStyles["admin-dialog-cancel"]} onClick={() => setIsDeleteAsked(false)}>
              Keep it
            </button>
            <button
              type="button"
              className={styles["admin-product-delete-yes"]}
              onClick={() => {
                deleteProductAndPage(product.productId, page);
                showToast(`${product.name} · ${product.packSize} deleted`);
                onClose();
              }}
            >
              Yes, delete
            </button>
          </div>
        ) : (
          <div className={styles["admin-product-popup-buttons"]}>
            {product && canDelete && (
              <button type="button" className={styles["admin-product-delete-button"]} onClick={() => setIsDeleteAsked(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7" />
                </svg>
                Delete product
              </button>
            )}
            <button type="button" className={sharedStyles["admin-dialog-cancel"]} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={sharedStyles["admin-dialog-submit"]}>
              {product ? (isOutOfStock && form.isRestocked ? "Save & notify manager" : "Save changes") : "Add product"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

// isMissing: left empty when Save was pressed (red box and a short note)
function PopupField({ label, children, isWide, isMissing }: { label: string; children: ReactNode; isWide?: boolean; isMissing?: boolean }) {
  return (
    <label
      className={`${sharedStyles["admin-dialog-field"]} ${isWide ? styles["admin-product-field-wide"] : ""} ${isMissing ? styles["admin-product-field-missing"] : ""}`}
    >
      <span className={sharedStyles["admin-dialog-label"]}>{label}</span>
      {children}
      {isMissing && <span className={styles["admin-product-field-problem"]}>Required</span>}
    </label>
  );
}
