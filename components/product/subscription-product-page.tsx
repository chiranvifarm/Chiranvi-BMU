"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteFooter from "@/components/footer/site-footer";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import {
  addProductToCart,
  changeCartItemQuantity,
  rememberPendingCartProduct,
  setCartSubscription,
  useCartItems,
  type CartProduct,
} from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import { ROW_SIZE, productRowFor, useProductRows } from "@/store/admin-product-rows-store";
import type { DeliveryStepIcon, PictureFit, SubscriptionPlanSetting, SubscriptionProductPage as SubscriptionPageData } from "./product-page-data";
import { ProductCardTile, SoldOutNotice, useProductCards, useSoldOutPanelCardId } from "./all-products-page";
import oneTimeStyles from "./one-time-product-page.module.css";
import styles from "./subscription-product-page.module.css";

/*
  Subscription product page template (milk, and every subscription product added in the Chiranvi Panel).
  It draws one entry of product-page-data.ts / the panel; the layout is the milk page's design:
  - left: the picture, a customer review and the three delivery steps (fixed while the right side scrolls);
  - right: name, price, Add Quantity, and "Choose your plan" (Subscribe & save plans, or One-time purchase
    with a bill: product + delivery charge = total, and Checkout to Cart);
  - below: "Fast selling products" (a different row for each tab).
  Every plan amount is worked out from the quantity in the cart (1 before it is in the cart), so the totals
  change as soon as the quantity changes. Plans are a percentage off the one-time price, rounded to whole
  rupees per unit (5% of ₹95 → ₹90).
*/

type SubscriptionPlan = SubscriptionPlanSetting & { pricePerUnit: number };

// Indian number format with the rupee sign, e.g. ₹31,320
function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// How big the picture is in its area (sized by width, or by height when no width is given)
function pictureFitStyle(fit: PictureFit): CSSProperties {
  return fit.widthPercent
    ? { width: `${fit.widthPercent}%`, height: "auto", maxHeight: `${fit.heightPercent}%` }
    : { width: "auto", height: `${fit.heightPercent}%` };
}

/*
  The order cut-off countdown ("Order within 3 hrs 14 min for your first bottle tomorrow by 7 AM").
  After the cut-off the countdown runs to the same time tomorrow and the first delivery comes the day after
  tomorrow. It uses the browser's clock, so it is only shown once the page has loaded there.
*/
function subscribeToClock(onTick: () => void) {
  const clockTimer = window.setInterval(onTick, 30000);
  return () => window.clearInterval(clockTimer);
}

function getCurrentMinute() {
  return Math.floor(Date.now() / 60000);
}

function describeOrderCutoff(currentMinute: number, cutoffHour: number) {
  const now = new Date(currentMinute * 60000);
  const cutoff = new Date(now);
  cutoff.setHours(cutoffHour, 0, 0, 0);
  const isAfterCutoff = now >= cutoff;
  if (isAfterCutoff) cutoff.setDate(cutoff.getDate() + 1);
  const minutesLeft = Math.max(1, Math.round((cutoff.getTime() - now.getTime()) / 60000));
  const hoursLeft = Math.floor(minutesLeft / 60);
  const timeLeft =
    hoursLeft > 0 ? `${hoursLeft} ${hoursLeft === 1 ? "hr" : "hrs"} ${minutesLeft % 60} min` : `${minutesLeft} min`;
  return { timeLeft, deliveryDay: isAfterCutoff ? "the day after tomorrow" : "tomorrow" };
}

const starOutline = "M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17.1 6.4 20l1.1-6.2-4.6-4.4 6.3-.9z";

// Five filled stars (the design shows full ratings everywhere on this page)
function FiveStars({ className }: { className: string }) {
  return (
    <span className={className} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((starNumber) => (
        <svg key={starNumber} viewBox="0 0 24 24">
          <path d={starOutline} />
        </svg>
      ))}
    </span>
  );
}

// The icon in a delivery step's green circle
function DeliveryStepIconPicture({ icon }: { icon: DeliveryStepIcon }) {
  if (icon === "milk-drop") {
    return (
      <svg viewBox="0 0 24 24" className={styles["subscription-delivery-step-icon-filled"]}>
        <path d="M12 3.5c-.4 0-.7.2-.9.5C9.4 6.6 6.5 10.6 6.5 14a5.5 5.5 0 0011 0c0-3.4-2.9-7.4-4.6-10-.2-.3-.5-.5-.9-.5z" />
      </svg>
    );
  }
  if (icon === "box") {
    return (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16M10 14h4" />
      </svg>
    );
  }
  if (icon === "home") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 10.5L12 4l8 6.5V20H4z" />
        <path d="M10 20v-5h4v5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/*
  "Add Quantity" (adds to the cart):
  - logged in: adds one; then the button becomes "- quantity +" (at 0 it is Add Quantity again);
  - not logged in: goes to the login with the product remembered, and the login adds it and comes back here.
*/
function QuantityCartControl({
  page,
  cartProduct,
  isLoggedIn,
  quantityInCart,
  hintCount,
}: {
  page: SubscriptionPageData;
  cartProduct: CartProduct;
  isLoggedIn: boolean;
  quantityInCart: number;
  hintCount: number; // how many times "choose a quantity first" was shown; above 0 = Add Quantity draws attention
}) {
  const attentionClass = hintCount > 0 ? styles["subscription-add-quantity-attention"] : "";
  if (quantityInCart > 0) {
    return (
      <div className={styles["subscription-quantity-control"]} role="group" aria-label={`${page.name} quantity`}>
        <button
          type="button"
          aria-label={`Remove one ${page.itemWord.one}`}
          className={styles["subscription-quantity-button"]}
          onClick={() => changeCartItemQuantity(cartProduct.productId, -1)}
        >
          −
        </button>
        <span className={styles["subscription-quantity"]} aria-live="polite">
          {quantityInCart}
        </span>
        <button
          type="button"
          aria-label={`Add one more ${page.itemWord.one}`}
          className={styles["subscription-quantity-button"]}
          onClick={() => changeCartItemQuantity(cartProduct.productId, 1)}
        >
          +
        </button>
      </div>
    );
  }

  if (isLoggedIn) {
    return (
      <button
        key={hintCount}
        type="button"
        className={`${styles["subscription-add-to-cart-button"]} ${attentionClass}`}
        onClick={() => addProductToCart(cartProduct)}
      >
        Add Quantity
      </button>
    );
  }

  return (
    <Link
      key={hintCount}
      href="/login"
      className={`${styles["subscription-add-to-cart-button"]} ${attentionClass}`}
      onPointerDown={() => rememberPendingCartProduct(cartProduct)}
      onKeyDown={(event) => {
        if (event.key === "Enter") rememberPendingCartProduct(cartProduct);
      }}
    >
      Add Quantity
    </Link>
  );
}

/*
  One-time purchase "Checkout to Cart": opens the cart page with the product in it.
  - no quantity yet: greyed, and a click points to Add Quantity;
  - not logged in: goes to the login with the product remembered (the login adds it and comes back here).
*/
function CheckoutToCartButton({
  page,
  cartProduct,
  isLoggedIn,
  quantityInCart,
  onNeedQuantity,
}: {
  page: SubscriptionPageData;
  cartProduct: CartProduct;
  isLoggedIn: boolean;
  quantityInCart: number;
  onNeedQuantity: () => void;
}) {
  const router = useRouter();

  if (quantityInCart === 0) {
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          className={`${styles["subscription-checkout-to-cart-button"]} ${styles["subscription-button-waiting"]}`}
          onClick={onNeedQuantity}
        >
          Checkout to Cart
        </button>
        <p className={styles["subscription-payment-note"]}>Choose how many {page.itemWord.many} with Add Quantity above first.</p>
      </>
    );
  }

  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        className={styles["subscription-checkout-to-cart-button"]}
        onPointerDown={() => rememberPendingCartProduct(cartProduct)}
        onKeyDown={(event) => {
          if (event.key === "Enter") rememberPendingCartProduct(cartProduct);
        }}
      >
        Checkout to Cart
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={styles["subscription-checkout-to-cart-button"]}
      onClick={() => {
        // A one-time purchase now: a plan left waiting in the cart from "Start subscription" goes
        // (otherwise the cart would show that plan instead of the one-time items)
        setCartSubscription(null);
        router.push("/cart");
      }}
    >
      Checkout to Cart
    </button>
  );
}

/*
  "Fast selling products": heading, View all, and the cards, on both the subscription and one-time tabs.
  The products and their order come from the Chiranvi Panel (Products & pricing → Product rows, or this
  page's own order in Edit page; store/admin-product-rows-store.ts).
  The product's own card is left out on its own page (its View product would only open this page again);
  when fewer than five are left, the next products of the All products page fill the row.
*/
function FastSellingRow({ currentSlug, override }: { currentSlug: string; override?: string[] }) {
  const allCards = useProductCards();
  const { slugs } = productRowFor(currentSlug, useProductRows(), override);
  const listedCards = slugs.flatMap((slug) => allCards.filter((card) => card.slug === slug));
  const extraCards = allCards.filter(
    (card) => card.hasPage && card.slug !== currentSlug && !listedCards.some((listed) => listed.slug === card.slug),
  );
  const rowCards = [...listedCards, ...extraCards].slice(0, ROW_SIZE);
  return (
    <section className={styles["fast-selling-section"]} aria-labelledby="fast-selling-heading">
      <div className={styles["fast-selling-heading-row"]}>
        <h2 id="fast-selling-heading" className={styles["fast-selling-heading"]}>
          Fast selling products
        </h2>
        <Link href="/products" className={styles["fast-selling-view-all-link"]}>
          View all Products
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>

      {/* The same priced cards as the All products page (milk: View product; others: ADD) */}
      <ul className={styles["fast-selling-product-list"]}>
        {rowCards.map((card) => (
          <ProductCardTile key={card.cardId} card={card} />
        ))}
      </ul>
    </section>
  );
}

// The 500 ml bottle's price: the one set in the Chiranvi Panel, otherwise half the 1 litre price, rounded up
function halfLitrePriceOf(page: SubscriptionPageData) {
  return page.halfLitrePrice && page.halfLitrePrice > 0 ? page.halfLitrePrice : Math.ceil(page.price / 2);
}

/*
  Milk in 500 ml bottles (pages with hasHalfLitreBottle): the same page with 500 ml wording and the 500 ml
  price (set in the Chiranvi Panel, or half the 1 litre price, rounded up). Plans, bills and the cart
  all use these values; 500 ml bottles are their own line in the cart.
*/
function toHalfLitrePage(page: SubscriptionPageData): SubscriptionPageData {
  return {
    ...page,
    price: halfLitrePriceOf(page),
    originalPrice: page.originalPrice ? Math.ceil(page.originalPrice / 2) : undefined,
    unitName: "500 ml", // "₹53 / 500 ml"
    unitShort: " × 500 ml", // "Milk (2 × 500 ml × ₹53)", "2 × 500 ml daily"
    packShort: "500 ml", // "1 × 500 ml bottle every morning"
    packSize: /^1 litre/.test(page.packSize) ? page.packSize.replace(/^1 litre/, "500 ml") : "500 ml bottle",
  };
}

export default function SubscriptionProductPage({ page: fullPage }: { page: SubscriptionPageData }) {
  // Bottle size (milk): 1 litre or 500 ml; the page below shows the chosen size's values
  const [isHalfLitreChosen, setIsHalfLitreChosen] = useState(false);
  const isHalfLitre = fullPage.hasHalfLitreBottle === true && isHalfLitreChosen;
  const page = useMemo(() => (isHalfLitre ? toHalfLitrePage(fullPage) : fullPage), [fullPage, isHalfLitre]);

  // What goes in the cart: one unit at the one-time price (the cart always shows an old price)
  const cartProduct: CartProduct = useMemo(
    () => ({
      productId: isHalfLitre ? `${page.slug}-half-litre` : page.slug,
      name: page.name,
      imageSource: page.pictures[0]?.imageSource ?? "",
      imageWidth: page.pictures[0]?.imageWidth ?? 400,
      imageHeight: page.pictures[0]?.imageHeight ?? 400,
      packSize: page.packSize,
      price: page.price,
      originalPrice: page.originalPrice ?? page.price,
    }),
    [page, isHalfLitre],
  );
  const plans: SubscriptionPlan[] = useMemo(
    () => page.plans.map((plan) => ({ ...plan, pricePerUnit: Math.round(page.price * (1 - plan.percentOff / 100)) })),
    [page],
  );
  // Biggest plan discount, e.g. "Subscribe & save up to 13%"
  const biggestPlanSavingPercent = Math.max(0, ...plans.map((plan) => plan.percentOff));

  const isLoggedIn = useIsLoggedIn();
  // Switched off or out of stock in the panel: it cannot be ordered (its card id, for Notify me)
  const soldOutPanelCardId = useSoldOutPanelCardId(fullPage);
  const cartItems = useCartItems();
  const quantityInCart = cartItems.find((cartItem) => cartItem.productId === cartProduct.productId)?.quantity ?? 0;
  // Units every morning for the plans: the cart quantity, or 1 before the product is in the cart
  const unitsPerDay = Math.max(1, quantityInCart);

  // Totals for one plan: deliveries, the plan price, the same at the one-time price, and the saving
  function calculatePlan(plan: SubscriptionPlan) {
    const itemCount = plan.days * unitsPerDay;
    const planTotal = itemCount * plan.pricePerUnit;
    const oneTimeTotal = itemCount * page.price;
    return { itemCount, planTotal, oneTimeTotal, saving: oneTimeTotal - planTotal };
  }

  /*
    The left column (picture, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the plan side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const pictureAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pictureArea = pictureAreaRef.current;
    if (!pictureArea) return;
    const heightObserver = new ResizeObserver(() => {
      pictureArea.style.setProperty("--subscription-picture-stage-height", `${pictureArea.offsetHeight}px`);
    });
    heightObserver.observe(pictureArea);
    return () => heightObserver.disconnect();
  }, []);

  const [purchaseType, setPurchaseType] = useState<"subscribe" | "one-time">("subscribe");
  // One-time purchase bill: the units at the one-time price, plus the delivery charge
  const oneTimeItemsTotal = unitsPerDay * page.price;
  const [chosenPlanId, setChosenPlanId] = useState(page.defaultPlanId);
  const chosenPlan = plans.find((plan) => plan.planId === chosenPlanId) ?? plans[0];
  const chosenPlanTotals = chosenPlan ? calculatePlan(chosenPlan) : null;
  const router = useRouter();
  const currentMinute = useSyncExternalStore(subscribeToClock, getCurrentMinute, () => null);
  const orderCutoff = currentMinute === null ? null : describeOrderCutoff(currentMinute, page.orderCutoffHour);

  /*
    Start subscription or Checkout to Cart before choosing a quantity: Add Quantity comes into view,
    shakes and glows, and a tip says to choose the quantity first (each click starts it again).
  */
  const [quantityHintCount, setQuantityHintCount] = useState(0);
  const addQuantityAreaRef = useRef<HTMLDivElement>(null);
  function showQuantityHint() {
    setQuantityHintCount((count) => count + 1);
    addQuantityAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /*
    Start subscription (after Add Quantity): the chosen plan goes to the cart, which checks it out
    (address, then Pay now). The units chosen with Add Quantity stay in the cart while the plan waits; the
    cart page takes them out once the plan is paid (not bought twice).
  */
  function startSubscription() {
    if (quantityInCart === 0 || !chosenPlan || !chosenPlanTotals) {
      showQuantityHint();
      return;
    }
    setCartSubscription({
      product: cartProduct,
      planId: chosenPlan.planId,
      planName: chosenPlan.label,
      months: chosenPlan.months,
      days: chosenPlan.days,
      bottlesPerDay: unitsPerDay,
      pricePerLitre: chosenPlan.pricePerUnit,
      bottleCount: chosenPlanTotals.itemCount,
      planTotal: chosenPlanTotals.planTotal,
      oneTimeTotal: chosenPlanTotals.oneTimeTotal,
      bottleLabel: page.packShort,
      unitName: page.unitName,
    });
    router.push("/cart");
  }

  const badgeColourClass = page.badge.colour === "grey" ? "" : styles[`subscription-badge-${page.badge.colour}`];

  return (
    <div className={styles["subscription-product-page"]}>
      {/* Green timings strip above the navigation bar (scrolls away; the bar stays at the top) */}
      {page.timingsStripText && <p className={styles["subscription-delivery-timings-strip"]}>{page.timingsStripText}</p>}

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["subscription-product-page-content"]}>
        <div className={styles["subscription-product-columns"]}>
          {/* Left: picture, review and delivery steps */}
          <div className={styles["subscription-product-left-column"]}>
            <div ref={pictureAreaRef} className={styles["subscription-picture-area"]}>
              {page.pictures.map((picture) => (
                <Image
                  key={picture.imageSource}
                  src={picture.imageSource}
                  alt={picture.alt}
                  width={picture.imageWidth}
                  height={picture.imageHeight}
                  sizes="(max-width: 800px) 40vw, 200px"
                  unoptimized={picture.isServedAsIs}
                  priority
                  className={styles["subscription-picture"]}
                  style={pictureFitStyle(page.pictureFit)}
                />
              ))}
            </div>

            {/* No review text (a product added without one): no review box */}
            {page.review.quote && (
              <figure className={styles["subscription-review-card"]}>
                <FiveStars className={styles["subscription-review-stars"]} />
                <blockquote className={styles["subscription-review-quote"]}>&ldquo;{page.review.quote}&rdquo;</blockquote>
                {/* Design: "Subscriber for 8 months" on its own line, then the name and area */}
                {page.review.subscriberSince && <p className={styles["subscription-review-subscriber-since"]}>{page.review.subscriberSince}</p>}
                <figcaption className={styles["subscription-review-author"]}>
                  <span className={styles["subscription-review-author-name"]}>{page.review.name}</span>
                  {page.review.area && <span className={styles["subscription-review-author-area"]}>, {page.review.area}</span>}
                </figcaption>
              </figure>
            )}

            <ol className={styles["subscription-delivery-steps-card"]} aria-label={`How your ${page.name} reaches you`}>
              {page.deliverySteps.map((step) => (
                <li key={step.title} className={styles["subscription-delivery-step"]}>
                  <span className={styles["subscription-delivery-step-icon"]} aria-hidden="true">
                    <DeliveryStepIconPicture icon={step.icon} />
                  </span>
                  <span className={styles["subscription-delivery-step-title"]}>{step.title}</span>
                  <span className={styles["subscription-delivery-step-detail"]}>{step.detail}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Right: product details, price, Add Quantity and the plans */}
          <div className={styles["subscription-product-right-column"]}>
            {page.badge.text && <span className={`${styles["subscription-badge"]} ${badgeColourClass}`}>{page.badge.text}</span>}
            <h1 className={styles["subscription-product-name"]}>{page.name}</h1>
            <p className={styles["subscription-product-tagline"]}>{page.tagline}</p>
            <p className={styles["subscription-product-description"]}>{page.description}</p>

            <p className={styles["subscription-product-rating"]}>
              <FiveStars className={styles["subscription-product-rating-stars"]} />
              <span className={styles["subscription-product-rating-score"]}>{page.rating.score}</span>
              <span className={styles["subscription-product-rating-count"]}>{page.rating.count}</span>
              {(page.homesNote.bold || page.homesNote.rest) && (
                <span className={styles["subscription-product-homes"]}>
                  <strong>{page.homesNote.bold}</strong> {page.homesNote.rest}
                </span>
              )}
            </p>

            <ul className={styles["subscription-product-highlights"]}>
              {page.highlights.map((highlight) => (
                <li key={highlight} className={styles["subscription-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            <p className={styles["subscription-price-row"]}>
              <span className={styles["subscription-price"]}>₹{page.price}</span>
              <span className={styles["subscription-price-unit"]}>/ {page.unitName}</span>
              {page.originalPrice && page.originalPrice > page.price && (
                <>
                  <s className={styles["subscription-original-price"]}>
                    <span className={styles["subscription-visually-hidden"]}>Was </span>₹{page.originalPrice}
                  </s>
                  <span className={styles["subscription-save-badge"]}>Save {getDiscountPercent(cartProduct)}%</span>
                </>
              )}
            </p>
            {/* Bottle size (milk): 1 litre or 500 ml at half the price */}
            {fullPage.hasHalfLitreBottle && (
              <div className={styles["subscription-bottle-sizes"]} role="radiogroup" aria-label="Bottle size">
                {[
                  { isHalf: false, label: "1 litre", price: fullPage.price },
                  { isHalf: true, label: "500 ml", price: halfLitrePriceOf(fullPage) },
                ].map((size) => (
                  <button
                    key={size.label}
                    type="button"
                    role="radio"
                    aria-checked={isHalfLitre === size.isHalf}
                    className={`${styles["subscription-bottle-size"]} ${isHalfLitre === size.isHalf ? styles["subscription-bottle-size-chosen"] : ""}`}
                    onClick={() => setIsHalfLitreChosen(size.isHalf)}
                  >
                    <span className={styles["subscription-bottle-size-label"]}>{size.label}</span>
                    <span className={styles["subscription-bottle-size-price"]}>{formatRupees(size.price)}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Out of stock in the panel: no quantity, plans or ordering, only Notify me */}
            {soldOutPanelCardId ? (
              <SoldOutNotice cardId={cartProduct.productId} panelCardId={soldOutPanelCardId} />
            ) : (
            <>
            <p className={styles["subscription-quantity-label"]}>
              <strong>Quantity</strong> · {page.packSize} each
            </p>

            <div ref={addQuantityAreaRef} className={styles["subscription-add-quantity-area"]}>
              <QuantityCartControl
                page={page}
                cartProduct={cartProduct}
                isLoggedIn={isLoggedIn}
                quantityInCart={quantityInCart}
                hintCount={quantityInCart === 0 ? quantityHintCount : 0}
              />
              {quantityInCart === 0 && quantityHintCount > 0 && (
                <span key={quantityHintCount} className={styles["subscription-add-quantity-tip"]} role="status">
                  Choose how many {page.itemWord.many} first
                </span>
              )}
            </div>

            {/* Choose your plan */}
            <section className={styles["subscription-plan-panel"]} aria-labelledby="subscription-plan-heading">
              <h2 id="subscription-plan-heading" className={styles["subscription-plan-heading"]}>
                Choose your plan
              </h2>

              <div className={styles["subscription-plan-tabs"]} role="tablist" aria-label="How to buy">
                <button
                  type="button"
                  role="tab"
                  aria-selected={purchaseType === "subscribe"}
                  className={`${styles["subscription-plan-tab"]} ${purchaseType === "subscribe" ? styles["subscription-plan-tab-selected"] : ""}`}
                  onClick={() => setPurchaseType("subscribe")}
                >
                  Subscribe &amp; save up to {biggestPlanSavingPercent}%
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={purchaseType === "one-time"}
                  className={`${styles["subscription-plan-tab"]} ${purchaseType === "one-time" ? styles["subscription-plan-tab-selected"] : ""}`}
                  onClick={() => setPurchaseType("one-time")}
                >
                  One-time purchase
                </button>
              </div>

              {purchaseType === "one-time" ? (
                <>
                  {/* One-time purchase: the units in the cart, the bill, and Checkout to Cart */}
                  <div className={styles["subscription-one-time-summary"]}>
                    <div className={styles["subscription-one-time-product-row"]}>
                      <span className={styles["subscription-one-time-product-icon"]} aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M10 3h4v2.5l1.5 2V21h-7V7.5l1.5-2z" />
                          <path d="M8.5 12h7" />
                        </svg>
                      </span>
                      <span className={styles["subscription-one-time-product-text"]}>
                        <strong>{page.name}</strong>
                        <span>
                          {unitsPerDay} × {page.packSize}
                        </span>
                      </span>
                      <span className={styles["subscription-one-time-product-amount"]}>{formatRupees(oneTimeItemsTotal)}</span>
                    </div>

                    <dl className={styles["subscription-one-time-bill"]}>
                      <div className={styles["subscription-one-time-bill-row"]}>
                        <dt>
                          {page.billLabel} ({unitsPerDay}
                          {page.unitShort} × ₹{page.price})
                        </dt>
                        <dd>{formatRupees(oneTimeItemsTotal)}</dd>
                      </div>
                      <div className={styles["subscription-one-time-bill-row"]}>
                        <dt>Delivery charge</dt>
                        <dd>{formatRupees(page.oneTimeDeliveryCharge)}</dd>
                      </div>
                      <div className={`${styles["subscription-one-time-bill-row"]} ${styles["subscription-one-time-bill-total-row"]}`}>
                        <dt>Total</dt>
                        <dd>{formatRupees(oneTimeItemsTotal + page.oneTimeDeliveryCharge)}</dd>
                      </div>
                    </dl>
                  </div>

                  <p className={styles["subscription-one-time-delivery-day"]}>
                    Delivered {orderCutoff?.deliveryDay ?? "tomorrow"} by {page.deliveryByTime}
                  </p>

                  <CheckoutToCartButton
                    page={page}
                    cartProduct={cartProduct}
                    isLoggedIn={isLoggedIn}
                    quantityInCart={quantityInCart}
                    onNeedQuantity={showQuantityHint}
                  />
                  <p className={styles["subscription-plan-footnote"]}>100% safe · Free Delivery</p>
                </>
              ) : (
                <>
                  <fieldset className={styles["subscription-plan-options"]}>
                    <legend className={styles["subscription-visually-hidden"]}>Subscription length</legend>
                    {plans.map((plan) => {
                      const planTotals = calculatePlan(plan);
                      const isChosen = plan.planId === chosenPlan?.planId;
                      return (
                        <label
                          key={plan.planId}
                          className={`${styles["subscription-plan-option"]} ${isChosen ? styles["subscription-plan-option-chosen"] : ""}`}
                        >
                          {plan.tag && (
                            <span
                              className={`${styles["subscription-plan-tag"]} ${
                                plan.tag === "Best value" ? styles["subscription-plan-tag-best-value"] : ""
                              }`}
                            >
                              {plan.tag}
                            </span>
                          )}
                          <input
                            type="radio"
                            name="subscription-plan"
                            value={plan.planId}
                            checked={isChosen}
                            onChange={() => setChosenPlanId(plan.planId)}
                            className={styles["subscription-plan-radio"]}
                          />
                          <span className={styles["subscription-plan-text"]}>
                            <span className={styles["subscription-plan-label"]}>{plan.label}</span>
                            <span className={styles["subscription-plan-details"]}>
                              ₹{plan.pricePerUnit} / {page.unitName} · <strong>{plan.percentOff}% off</strong> ·{" "}
                              {plan.showsSavingInDetails ? (
                                <>
                                  <strong>
                                    {planTotals.itemCount.toLocaleString("en-IN")} {page.itemWord.many}
                                  </strong>{" "}
                                  · you save {formatRupees(planTotals.saving)}
                                </>
                              ) : (
                                <>
                                  {unitsPerDay}
                                  {page.unitShort} daily ·{" "}
                                  <strong>
                                    {planTotals.itemCount.toLocaleString("en-IN")} {page.itemWord.many}
                                  </strong>
                                </>
                              )}
                            </span>
                          </span>
                          <span className={styles["subscription-plan-amounts"]}>
                            <span className={styles["subscription-plan-total"]}>{formatRupees(planTotals.planTotal)}</span>
                            <s className={styles["subscription-plan-one-time-total"]}>
                              <span className={styles["subscription-visually-hidden"]}>Without a plan </span>
                              {formatRupees(planTotals.oneTimeTotal)}
                            </s>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  {chosenPlan && chosenPlanTotals && (
                    <div className={styles["subscription-plan-summary"]}>
                      <span className={styles["subscription-plan-summary-icon"]} aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M6 3.5h3v2l1 1.5v12.5H5V7l1-1.5zM15 3.5h3v2l1 1.5v12.5h-5V7l1-1.5z" />
                          <path d="M5 11h5M14 11h5" />
                        </svg>
                      </span>
                      <span className={styles["subscription-plan-summary-text"]}>
                        <strong>
                          Your plan: {unitsPerDay} × {page.packShort} {unitsPerDay === 1 ? page.itemWord.one : page.itemWord.many} every
                          morning
                        </strong>
                        <span>
                          {chosenPlanTotals.itemCount.toLocaleString("en-IN")} {page.itemWord.many} over {chosenPlan.months} months
                        </span>
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    aria-disabled={quantityInCart === 0 ? true : undefined}
                    className={`${styles["subscription-start-subscription-button"]} ${quantityInCart === 0 ? styles["subscription-button-waiting"] : ""}`}
                    onClick={startSubscription}
                  >
                    Start subscription @ {formatRupees(chosenPlanTotals?.planTotal ?? 0)}
                  </button>
                  {quantityInCart === 0 && (
                    <p className={styles["subscription-payment-note"]}>
                      Choose how many {page.itemWord.many} with Add Quantity above first.
                    </p>
                  )}
                  <p className={styles["subscription-plan-footnote"]}>Pause anytime · Free Delivery</p>
                </>
              )}
            </section>

            {orderCutoff && (
              <p className={styles["subscription-order-cutoff-strip"]}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7z" />
                  <circle cx="6.5" cy="17.5" r="1.8" />
                  <circle cx="17" cy="17.5" r="1.8" />
                </svg>
                Order within {orderCutoff.timeLeft} for your first {page.itemWord.one} {orderCutoff.deliveryDay} by{" "}
                {page.deliveryByTime}
              </p>
            )}
            </>
            )}
          </div>
        </div>

        {/* The same Product information and Nutrition facts tables as a one-time product */}
        {((page.productInformation?.length ?? 0) > 0 || (page.nutritionFacts?.length ?? 0) > 0) && (
          <div className={`${styles["subscription-information-tables"]} ${oneTimeStyles["one-time-information-row"]}`}>
            {(page.productInformation?.length ?? 0) > 0 && (
              <section className={oneTimeStyles["one-time-product-information"]} aria-labelledby="subscription-product-information-heading">
                <h2 id="subscription-product-information-heading" className={oneTimeStyles["one-time-information-heading"]}>
                  Product information
                </h2>
                <dl className={oneTimeStyles["one-time-product-information-table"]}>
                  {page.productInformation?.map((row) => (
                    <div key={row.label} className={oneTimeStyles["one-time-product-information-row"]}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {(page.nutritionFacts?.length ?? 0) > 0 && (
              <section className={oneTimeStyles["one-time-nutrition-facts"]} aria-labelledby="subscription-nutrition-facts-heading">
                <div className={oneTimeStyles["one-time-nutrition-facts-header"]}>
                  <h2 id="subscription-nutrition-facts-heading">Nutrition facts</h2>
                  <span>{page.nutritionBasis}</span>
                </div>
                <dl className={oneTimeStyles["one-time-nutrition-facts-list"]}>
                  {page.nutritionFacts?.map((row) => (
                    <div key={row.label} className={oneTimeStyles["one-time-nutrition-facts-row"]}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className={oneTimeStyles["one-time-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
              </section>
            )}
          </div>
        )}

        <FastSellingRow currentSlug={page.slug} override={page.productRowOverride} />
      </main>

      {/* Shared site footer with the Refer a Friend banner (same as the landing page) */}
      <SiteFooter />
    </div>
  );
}
