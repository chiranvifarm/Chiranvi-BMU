"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { rememberPageAfterLogin, useIsLoggedIn, useIsLoginStatusKnown, useLoggedInMobileNumber } from "@/components/login/login-status";
import SiteFooter from "@/components/footer/site-footer";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, changeCartItemQuantity, rememberPendingCartProduct, useCartItems, useCartLimitMessage, type CartProduct } from "@/store/cart-store";
import { useProductPages } from "@/store/product-pages-store";
import { askToBeNotified, isAvailableToOrder, useShopProducts, type ShopProduct } from "@/store/products-store";
import { toggleWishlistItem, useWishlist, type WishlistItem } from "@/store/wishlist-store";
import { SHOP_CATEGORIES, type ProductPage, type ShopCategory } from "./product-page-data";
import styles from "./all-products-page.module.css";

/*
  All products (/products), from the design: title, category filters with a small picture and a count,
  then one card per product. Only for logged-in visitors: anyone else is sent to the login, which then comes
  back to this page.
  - Products with a page (the six starting products and the ones added in the Chiranvi Panel): one card
    each, clicking anywhere on it opens the page.
  - Moringa powder has its own page. If that page is deleted in the panel, its card from the product list
    (store/products-store.ts) shows under "Powders" instead: that card does not open anything; ADD and the
    heart work. (Turmeric and Red Chilli powder are no longer sold; the panel can add them back.)
  - ADD puts that pack in the cart (then "− 1 +", and View cart under it); not logged in, it goes to the login first.
  - The heart saves the pack to the Wishlist (account → Wishlist); Notify me asks for a stock alert. Not
    logged in, both go to the login first (nothing is added without an account) and come back here.
  "View all products" and "Start Shopping" across the site lead here.
*/

export type ProductCard = {
  cardId: string; // the cart and wishlist id: same as the product page uses
  slug: string; // product page address: /products/<slug>
  hasPage: boolean;
  name: string;
  category: ShopCategory;
  packLabel: string;
  cartPackSize: string; // what the cart shows: "1 litre glass jar"
  cardNote?: string; // "· Bilona method"
  rating: { score: string; count: string };
  picture?: { imageSource: string; imageWidth: number; imageHeight: number; alt: string };
  price: number;
  originalPrice?: number;
  tag?: string; // on the picture: "Subscribe & save", "Best value", "Most popular"
  isSoldOut?: boolean;
  panelCardId?: string; // its card on the panel's Products & pricing (Notify me is kept there)
  isSubscription?: boolean; // milk: View product (subscription or one-time is chosen on its page)
};

// The powders shown before their own pages exist (ids in store/products-store.ts; the panel shows these too)
export const POWDER_PRODUCT_IDS = ["moringa-powder"];

// Small picture on each filter button (pictures the site already has)
const FILTER_PICTURES: Record<ShopCategory, { imageSource: string; imageWidth: number; imageHeight: number }> = {
  Milk: { imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  Paneer: { imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 3712, imageHeight: 2728 },
  Ghee: { imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204 },
  Butter: { imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272 },
  Flours: { imageSource: "/images/products/whole-wheat-atta-pack.webp", imageWidth: 1984, imageHeight: 1806 },
  Batter: { imageSource: "/images/products/idli-batter-powder-pack.webp", imageWidth: 1808, imageHeight: 2744 },
  Powders: { imageSource: "/images/products/turmeric-powder-pouch.webp", imageWidth: 360, imageHeight: 548 },
  Noodles: { imageSource: "/images/products/carrot-instant-noodles-pack.webp", imageWidth: 850, imageHeight: 1000 },
  Pasta: { imageSource: "/images/products/tomato-pasta-pack.webp", imageWidth: 714, imageHeight: 1000 },
  Macaroni: { imageSource: "/images/products/palak-macaroni-label.webp", imageWidth: 1000, imageHeight: 1000 },
  Others: { imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276 },
};

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// A product page's card on the panel's Products & pricing: the same address, or made with the page
function findPanelCardOfPage(page: ProductPage, shopProducts: ShopProduct[]) {
  return shopProducts.find((product) => product.productId === page.slug || page.panelCardIds?.includes(product.productId));
}

// The panel card's id when the product page is switched off or out of stock there (then it cannot be ordered)
export function useSoldOutPanelCardId(page: ProductPage) {
  const panelCard = findPanelCardOfPage(page, useShopProducts());
  return panelCard && !isAvailableToOrder(panelCard) ? panelCard.productId : null;
}

// Out only because no stock is left for one-time orders: its plans are still sold
export function useIsOutForOneTimeOnly(page: ProductPage) {
  const panelCard = findPanelCardOfPage(page, useShopProducts());
  return Boolean(panelCard?.isVisible && panelCard.stock === "out" && Object.keys(panelCard.stockCounts ?? {}).length > 0);
}

/*
  One card per product page: a one-time product shows its main pack (the one its page opens on, e.g.
  ghee 1 litre), a subscription product its one-time price per unit. The other sizes are chosen on the page.
*/
function toPageCards(pages: ProductPage[], shopProducts: ShopProduct[]): ProductCard[] {
  return pages
    .filter((page) => page.status === "published")
    .flatMap((page): ProductCard[] => {
      // Its card on the panel's Products & pricing: switched off or out of stock there shows Sold out here
      const panelCard = findPanelCardOfPage(page, shopProducts);
      const shared = {
        isSoldOut: panelCard ? !isAvailableToOrder(panelCard) : undefined,
        panelCardId: panelCard?.productId,
        slug: page.slug,
        hasPage: true,
        name: page.name,
        category: page.shopCategory ?? "Others",
        cardNote: page.cardNote,
        rating: page.rating,
        picture: page.pictures[0],
      };
      if (page.kind === "subscription") {
        // "1 litre" (the card note adds "· glass bottle")
        return [{ ...shared, cardId: page.slug, packLabel: `1 ${page.unitName}`, cartPackSize: page.packSize, price: page.price, originalPrice: page.originalPrice, tag: page.cardTag ?? "Subscribe & save", isSubscription: true }];
      }
      const pack = page.packs.find((onePack) => onePack.packId === page.defaultPackId) ?? page.packs[0];
      if (!pack) return [];
      return [
        {
          ...shared,
          cardId: `${page.slug}-${pack.packId}`,
          packLabel: pack.label,
          cartPackSize: `${pack.label} ${page.cartPackWord}`,
          price: pack.price,
          originalPrice: pack.originalPrice,
          tag: pack.tag,
        },
      ];
    });
}

// The powders, from the product list (their prices and stock change with the Chiranvi Panel)
function toPowderCards(shopProducts: ShopProduct[], pageSlugs: Set<string>): ProductCard[] {
  return POWDER_PRODUCT_IDS.flatMap((productId): ProductCard[] => {
    const product = shopProducts.find((shopProduct) => shopProduct.productId === productId);
    if (!product || pageSlugs.has(productId)) return []; // gone from the list, or it has its own page now
    return [
      {
        cardId: product.productId,
        slug: product.productId,
        hasPage: false,
        name: product.name,
        category: "Powders",
        packLabel: product.packSize,
        cartPackSize: product.packSize,
        // Placeholder rating, the same as the landing page's Best Sellers
        rating: { score: "4.5", count: "(7,105)" },
        picture: product.imageSource
          ? { imageSource: product.imageSource, imageWidth: product.imageWidth ?? 400, imageHeight: product.imageHeight ?? 400, alt: product.name }
          : undefined,
        price: product.price,
        originalPrice: product.originalPrice,
        isSoldOut: !isAvailableToOrder(product),
        panelCardId: product.productId,
      },
    ];
  });
}

/*
  Ragi flour has its own page (product-page-data.ts). This card shows only if that page is deleted in the
  panel, with the site's flours picture. (Jowar flour is no longer sold; the panel can add it back.)
*/
const FLOURS_PICTURE = { imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276 };
const UPCOMING_FLOUR_CARDS: ProductCard[] = [
  {
    cardId: "ragi-flour-1-kg",
    slug: "ragi-flour",
    hasPage: false,
    name: "Ragi Flour",
    category: "Flours",
    packLabel: "1 kg",
    cartPackSize: "1 kg pouch",
    cardNote: "stone-ground",
    rating: { score: "4.6", count: "(402)" },
    picture: { ...FLOURS_PICTURE, alt: "Chiranvi Farm Ragi Flour" },
    price: 119,
    originalPrice: 140,
    tag: "New",
  },
];

// The upcoming flours, until a page with the same address exists (then that page's card shows instead)
function toUpcomingFlourCards(pageSlugs: Set<string>) {
  return UPCOMING_FLOUR_CARDS.filter((card) => !pageSlugs.has(card.slug));
}

/*
  Logged out: the heart and Notify me go to the login first (nothing is saved without an account), and the
  login comes back to this page.
*/
function goToLoginAndBack(router: ReturnType<typeof useRouter>) {
  rememberPageAfterLogin(window.location.pathname + window.location.search);
  router.push("/login");
}

/*
  Notify me: for a card on the panel the request is kept in the database (the panel's "waiting" list, and
  "✓ We'll notify you" on every device); isLarge is the product page's bigger button. A card that is not on the
  panel yet (the upcoming flours) has nothing to wait on: its "✓ We'll notify you" lasts for the visit only.
*/
function NotifyMeButton({ panelCardId, isLoggedIn, isLarge = false }: { cardId: string; panelCardId?: string; isLoggedIn: boolean; isLarge?: boolean }) {
  const router = useRouter();
  const shopProducts = useShopProducts();
  const mobileNumber = useLoggedInMobileNumber();
  const [isRequestedHere, setIsRequestedHere] = useState(false);
  const isRequested = panelCardId
    ? Boolean(mobileNumber && shopProducts.find((product) => product.productId === panelCardId)?.waitingCustomers?.includes(mobileNumber.slice(-10)))
    : isRequestedHere;
  const sizeClass = isLarge ? styles["all-products-notify-large"] : "";

  if (isRequested) {
    return (
      <span className={`${styles["all-products-notify-done"]} ${sizeClass}`} role="status">
        ✓ We&rsquo;ll notify you
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles["all-products-notify-button"]} ${sizeClass}`}
      onClick={() => {
        if (!isLoggedIn) {
          goToLoginAndBack(router);
          return;
        }
        if (panelCardId && mobileNumber) {
          askToBeNotified(panelCardId, mobileNumber);
          return;
        }
        setIsRequestedHere(true);
      }}
    >
      Notify me
    </button>
  );
}

/*
  A product page whose card is switched off or out of stock in the panel: this box stands in place of the
  quantity and the ordering buttons, so it cannot be ordered; Notify me asks for a message when it is back.
*/
export function SoldOutNotice({ cardId, panelCardId }: { cardId: string; panelCardId: string }) {
  const isLoggedIn = useIsLoggedIn();
  return (
    <div className={styles["all-products-sold-out-notice"]} role="status">
      <div className={styles["all-products-sold-out-notice-words"]}>
        <span className={styles["all-products-sold-out-notice-badge"]}>Out of stock</span>
        <p className={styles["all-products-sold-out-notice-text"]}>This can&rsquo;t be ordered right now. Tap Notify me and we&rsquo;ll tell you when it&rsquo;s back.</p>
      </div>
      <NotifyMeButton cardId={cardId} panelCardId={panelCardId} isLoggedIn={isLoggedIn} isLarge />
    </div>
  );
}

function toCartProduct(card: ProductCard): CartProduct {
  return {
    productId: card.cardId,
    name: card.name,
    imageSource: card.picture?.imageSource ?? "",
    imageWidth: card.picture?.imageWidth ?? 400,
    imageHeight: card.picture?.imageHeight ?? 400,
    packSize: card.cartPackSize,
    price: card.price,
    originalPrice: card.originalPrice ?? card.price,
  };
}

function toWishlistItem(card: ProductCard): WishlistItem {
  return {
    itemId: card.cardId,
    slug: card.slug,
    name: card.name,
    packLabel: card.packLabel,
    price: card.price,
    originalPrice: card.originalPrice,
    imageSource: card.picture?.imageSource ?? "",
    imageWidth: card.picture?.imageWidth ?? 400,
    imageHeight: card.picture?.imageHeight ?? 400,
  };
}

// A click on the card opens the product page, unless it was on a button or link inside it
function openProductOnCardClick(event: MouseEvent<HTMLElement>, openPage: () => void) {
  if ((event.target as HTMLElement).closest("a, button")) return;
  openPage();
}

function HeartIcon({ isFilled }: { isFilled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={isFilled ? styles["all-products-heart-filled"] : ""}>
      <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["all-products-star"]}>
      <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.1 6.4 20l1.1-6.2-4.6-4.4 6.3-.9z" />
    </svg>
  );
}

// ADD, or "− n +" once that pack is in the cart
function CardCartControl({ card, quantityInCart, isLoggedIn }: { card: ProductCard; quantityInCart: number; isLoggedIn: boolean }) {
  const cartProduct = toCartProduct(card);
  if (quantityInCart > 0) {
    return (
      <div className={styles["all-products-quantity-control"]} role="group" aria-label={`${card.name} ${card.packLabel} quantity`}>
        <button type="button" aria-label="One fewer" onClick={() => changeCartItemQuantity(card.cardId, -1)}>
          −
        </button>
        <span aria-live="polite">{quantityInCart}</span>
        <button type="button" aria-label="One more" onClick={() => changeCartItemQuantity(card.cardId, 1)}>
          +
        </button>
      </div>
    );
  }
  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        className={styles["all-products-add-button"]}
        onPointerDown={() => rememberPendingCartProduct(cartProduct)}
        onKeyDown={(event) => {
          if (event.key === "Enter") rememberPendingCartProduct(cartProduct);
        }}
      >
        ADD
      </Link>
    );
  }
  return <AddButtonWithNightNotice cartProduct={cartProduct} />;
}

/*
  The 9 PM rule (0051_nine_pm_cut_off.sql): an order paid before 9 PM (India time) arrives the next morning; at
  9 PM or later, the morning after that. After 9 PM every ADD first says so in a pop-up: "Add to cart" goes on,
  "Not now" (or Escape, or the dimmed page) adds nothing.
*/
const NIGHT_CUTOFF_HOUR = 21;

// The time in India now: its hour, "10:15 PM", and the delivery day after 9 PM ("Wednesday, 11 November")
function nightOrderDetails() {
  const now = new Date();
  const hour = Number(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const timeNow = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  const deliveryDay = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return { isAfterCutoff: hour >= NIGHT_CUTOFF_HOUR, timeNow, deliveryDay };
}

// Where the pop-up goes: the outermost element that still has the site's fonts (app/layout.tsx sets them on a
// wrapper inside <body>), so it is above the page and in Poppins / Ubuntu
function popupHostOf(start: HTMLElement) {
  let host: HTMLElement = start;
  while (host.parentElement && getComputedStyle(host.parentElement).getPropertyValue("--font-poppins").trim()) host = host.parentElement;
  return host === start ? document.body : host;
}

function AddButtonWithNightNotice({ cartProduct }: { cartProduct: CartProduct }) {
  const [notice, setNotice] = useState<{ timeNow: string; deliveryDay: string; host: HTMLElement } | null>(null);

  function pressAdd(event: MouseEvent<HTMLButtonElement>) {
    const details = nightOrderDetails();
    if (details.isAfterCutoff) setNotice({ timeNow: details.timeNow, deliveryDay: details.deliveryDay, host: popupHostOf(event.currentTarget) });
    else addProductToCart(cartProduct);
  }

  // Escape closes it, like "Not now"
  useEffect(() => {
    if (!notice) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setNotice(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [notice]);

  return (
    <>
      <button type="button" className={styles["all-products-add-button"]} onClick={pressAdd}>
        ADD
      </button>
      {notice &&
        createPortal(
          <div className={styles["night-order-overlay"]} data-lenis-prevent>
            <button type="button" aria-label="Not now" className={styles["night-order-dimmed-page"]} onClick={() => setNotice(null)} />
            <div role="dialog" aria-modal="true" aria-labelledby="night-order-heading" className={styles["night-order-dialog"]}>
              <span className={styles["night-order-icon"]} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
                </svg>
              </span>
              <h2 id="night-order-heading" className={styles["night-order-heading"]}>
                Ordering after 9 PM?
              </h2>
              <p className={styles["night-order-text"]}>
                Orders placed before 9 PM arrive the next morning. It&apos;s <strong>{notice.timeNow}</strong> now, so yours will
                arrive on
              </p>
              <p className={styles["night-order-day"]}>
                {notice.deliveryDay}
                <span>by 7 AM</span>
              </p>
              <p className={styles["night-order-product"]}>
                {cartProduct.name} · {cartProduct.packSize}
              </p>
              <div className={styles["night-order-buttons"]}>
                <button type="button" className={styles["night-order-cancel-button"]} onClick={() => setNotice(null)}>
                  Not now
                </button>
                <button
                  type="button"
                  autoFocus
                  className={styles["night-order-add-button"]}
                  onClick={() => {
                    addProductToCart(cartProduct);
                    setNotice(null);
                  }}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>,
          notice.host,
        )}
    </>
  );
}

// Every product card, in the All products page's order (also used by the product pages' Fast selling row)
export function useProductCards() {
  const productPages = useProductPages();
  const shopProducts = useShopProducts();
  return useMemo(() => {
    const pageSlugs = new Set(productPages.map((page) => page.slug));
    const pageCards = toPageCards(productPages, shopProducts);
    // The upcoming flours sit right after the other flours (atta)
    const lastFlourIndex = pageCards.map((card) => card.category).lastIndexOf("Flours");
    const flourCards = toUpcomingFlourCards(pageSlugs);
    const withFlours =
      lastFlourIndex === -1 ? [...pageCards, ...flourCards] : [...pageCards.slice(0, lastFlourIndex + 1), ...flourCards, ...pageCards.slice(lastFlourIndex + 1)];
    return [...withFlours, ...toPowderCards(shopProducts, pageSlugs)];
  }, [productPages, shopProducts]);
}

/*
  One product card (All products page and the product pages' Fast selling row): picture with tag and heart,
  name, pack, rating, price, and the button:
  - milk (bought by subscription or one-time): "View product", to choose on its page;
  - others: ADD → "− n +";
  - out of stock (milk too): Notify me.
  Clicking anywhere else on the card opens the product page (when it has one).
*/
export function ProductCardTile({ card }: { card: ProductCard }) {
  const router = useRouter();
  const cartItems = useCartItems();
  const wishlist = useWishlist();
  const isLoggedIn = useIsLoggedIn();
  const picture = card.picture;
  const quantityInCart = cartItems.find((cartItem) => cartItem.productId === card.cardId)?.quantity ?? 0;
  const isHearted = wishlist.some((item) => item.itemId === card.cardId);
  // No page yet (the powders, Ragi and Jowar flour): the card does not open anything
  const openPage = () => {
    if (card.hasPage) router.push(`/products/${card.slug}`);
  };

  return (
    <li
      className={`${styles["all-products-card"]} ${quantityInCart > 0 && !card.isSubscription ? styles["all-products-card-in-cart"] : ""} ${
        card.hasPage ? "" : styles["all-products-card-without-page"]
      }`}
      onClick={(event) => openProductOnCardClick(event, openPage)}
    >
      <div className={styles["all-products-picture-area"]}>
        {card.tag && (
          <span
            className={`${styles["all-products-tag"]} ${card.tag === "Subscribe & save" ? styles["all-products-tag-green"] : ""} ${
              card.tag === "New" ? styles["all-products-tag-new"] : ""
            }`}
          >
            {card.tag}
          </span>
        )}
        {card.isSoldOut && <span className={styles["all-products-out-of-stock"]}>Out of stock</span>}
        <button
          type="button"
          aria-pressed={isHearted}
          aria-label={isHearted ? `Remove ${card.name} ${card.packLabel} from wishlist` : `Add ${card.name} ${card.packLabel} to wishlist`}
          className={styles["all-products-heart-button"]}
          onClick={() => (isLoggedIn ? toggleWishlistItem(toWishlistItem(card)) : goToLoginAndBack(router))}
        >
          <HeartIcon isFilled={isHearted} />
        </button>
        {picture && (
          <Image
            src={picture.imageSource}
            alt={picture.alt}
            width={picture.imageWidth}
            height={picture.imageHeight}
            sizes="(max-width: 800px) 45vw, 220px"
            className={styles["all-products-picture"]}
          />
        )}
      </div>

      {/* The name is a real link, so the card can be opened from the keyboard too */}
      <h3 className={styles["all-products-name"]}>
        {card.hasPage ? <Link href={`/products/${card.slug}`}>{card.name}</Link> : card.name}
      </h3>
      <p className={styles["all-products-pack"]}>
        {card.packLabel}
        {card.cardNote ? ` · ${card.cardNote}` : ""}
      </p>
      <p className={styles["all-products-rating"]}>
        <StarIcon />
        <strong>{card.rating.score}</strong> {card.rating.count}
      </p>
      <div className={styles["all-products-price-row"]}>
        <p className={styles["all-products-price"]}>
          {formatRupees(card.price)}
          {card.originalPrice && card.originalPrice > card.price && (
            <s>
              <span className={styles["all-products-visually-hidden"]}>Was </span>
              {formatRupees(card.originalPrice)}
            </s>
          )}
        </p>
        {card.isSoldOut ? (
          <NotifyMeButton cardId={card.cardId} panelCardId={card.panelCardId} isLoggedIn={isLoggedIn} />
        ) : card.isSubscription ? (
          <Link href={`/products/${card.slug}`} className={styles["all-products-add-button"]}>
            View product
          </Link>
        ) : (
          <div className={styles["all-products-cart-actions"]}>
            <CardCartControl card={card} quantityInCart={quantityInCart} isLoggedIn={isLoggedIn} />
            {/* In the cart: a way straight to it, beside "− n +" (under it on phones) */}
            {quantityInCart > 0 && (
              <Link href="/cart" className={styles["all-products-view-cart-button"]}>
                View cart
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/*
  The home page's "Pasta & Noodles" circle opens /products?category=Pasta & Noodles: the Noodles, Pasta and
  Macaroni cards together, with those three filters shown as chosen. Tapping one filter then shows only it.
*/
const PASTA_AND_NOODLES = "Pasta & Noodles";
const PASTA_AND_NOODLES_CATEGORIES: ShopCategory[] = ["Noodles", "Pasta", "Macaroni"];
type ChosenCategory = ShopCategory | "All" | typeof PASTA_AND_NOODLES;

// startingCategory: from /products?category=Milk (Shop by Category on the home page); missing: All
export default function AllProductsPage({ startingCategory }: { startingCategory?: ShopCategory | typeof PASTA_AND_NOODLES }) {
  const cartLimitMessage = useCartLimitMessage();
  const [chosenCategory, setChosenCategory] = useState<ChosenCategory>(startingCategory ?? "All");
  const cards = useProductCards();
  const categoriesWithCards = SHOP_CATEGORIES.filter((category) => cards.some((card) => card.category === category));
  const isCategoryChosen = (category: ShopCategory) =>
    chosenCategory === category || (chosenCategory === PASTA_AND_NOODLES && PASTA_AND_NOODLES_CATEGORIES.includes(category));
  const shownCards = chosenCategory === "All" ? cards : cards.filter((card) => isCategoryChosen(card.category));
  const isLoggedIn = useIsLoggedIn();
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const router = useRouter();

  // Not logged in: log in first, then come back to this page. Waits until the saved login has been read.
  useEffect(() => {
    if (!isLoginStatusKnown || isLoggedIn) return;
    rememberPageAfterLogin(window.location.pathname + window.location.search);
    router.replace("/login");
  }, [isLoginStatusKnown, isLoggedIn, router]);

  // Nothing is shown until the visitor is known to be logged in
  if (!isLoggedIn) return null;

  return (
    <div className={styles["all-products-page"]}>
      {cartLimitMessage && (
        <p role="status" className={styles["all-products-cart-limit-message"]}>
          {cartLimitMessage}
        </p>
      )}
      <SiteNavigationPlacement />

      <main className={styles["all-products-page-content"]}>
        <h1 className={styles["all-products-title"]}>All products</h1>
        <p className={styles["all-products-description"]}>
          Fresh from our farm: milk, ghee, paneer, butter, flours, batter, powders, pasta and noodles. Delivered by 7 AM.
        </p>

        {/* Category filters */}
        <div className={styles["all-products-filters"]} role="group" aria-label="Show category">
          <button
            type="button"
            aria-pressed={chosenCategory === "All"}
            className={`${styles["all-products-filter"]} ${chosenCategory === "All" ? styles["all-products-filter-chosen"] : ""}`}
            onClick={() => setChosenCategory("All")}
          >
            All <span className={styles["all-products-filter-count"]}>{cards.length}</span>
          </button>
          {categoriesWithCards.map((category) => {
            const picture = FILTER_PICTURES[category];
            return (
              <button
                key={category}
                type="button"
                aria-pressed={isCategoryChosen(category)}
                className={`${styles["all-products-filter"]} ${isCategoryChosen(category) ? styles["all-products-filter-chosen"] : ""}`}
                onClick={() => setChosenCategory(category)}
              >
                <span className={styles["all-products-filter-picture"]} aria-hidden="true">
                  <Image src={picture.imageSource} alt="" width={picture.imageWidth} height={picture.imageHeight} sizes="40px" />
                </span>
                {category}
                <span className={styles["all-products-filter-count"]}>{cards.filter((card) => card.category === category).length}</span>
              </button>
            );
          })}
        </div>

        <p className={styles["all-products-showing"]}>
          Showing <strong>{shownCards.length}</strong> of {cards.length} products
        </p>

        <ul className={styles["all-products-grid"]}>
          {shownCards.map((card) => (
            <ProductCardTile key={card.cardId} card={card} />
          ))}
        </ul>
      </main>

      {/* Shared site footer with the Refer a Friend banner (same as the landing page) */}
      <SiteFooter />
    </div>
  );
}
