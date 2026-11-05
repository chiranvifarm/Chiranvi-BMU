"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
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
import styles from "./milk-product-page.module.css";

/*
  Milk product page (/products/a2-desi-milk), from the design:
  - left: the bottle, a customer review and the "Order by 9 PM - Milked at 5 AM - At your door" steps;
  - right: name, price, Add to Cart, and "Choose your plan" (Subscribe & save, 3 / 6 / 12 months);
  - below: "Fast selling products" (five cards with the category pictures).
  Every plan amount is worked out from the number of bottles in the cart (1 when milk is not in the
  cart yet), so the totals change as soon as the quantity changes.
  "One-time purchase" swaps the plans for a bill (milk + delivery charge = total) and Checkout to Cart.
*/

// Prices from the design, for this page only (the landing page keeps the panel's prices).
// Later the Chiranvi Panel will set these, so the admin can change them.
const milkProduct: CartProduct = {
  productId: "a2-desi-milk",
  name: "A2 Desi Cow Milk",
  // Same bottle as the landing hero, with a see-through background so the ring and green show around it
  imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp",
  imageWidth: 1188,
  imageHeight: 2312,
  packSize: "1 litre glass bottle",
  price: 95,
  originalPrice: 110,
};

type SubscriptionPlan = {
  planId: string;
  label: string;
  months: number;
  days: number; // one bottle per chosen quantity is delivered every one of these days
  percentOff: number; // off the one-time price per litre
  pricePerLitre: number;
  tag?: "Most popular" | "Best value";
  // The design shows "2L daily" for 3 months and "you save ₹…" for the longer plans
  showsSavingInDetails: boolean;
};

/*
  Each plan is a percentage off the one-time price (₹95), rounded to whole rupees per litre so every
  total is in whole rupees: 5% → ₹90, 8% → ₹87, 13% → ₹83. If the one-time price changes, the plans follow.
*/
function priceAfterPercentOff(percentOff: number) {
  return Math.round(milkProduct.price * (1 - percentOff / 100));
}

const subscriptionPlans: SubscriptionPlan[] = (
  [
    { planId: "3-months", label: "3 Months", months: 3, days: 90, percentOff: 5, showsSavingInDetails: false },
    { planId: "6-months", label: "6 Months", months: 6, days: 180, percentOff: 8, tag: "Most popular", showsSavingInDetails: true },
    { planId: "12-months", label: "12 Months", months: 12, days: 365, percentOff: 13, tag: "Best value", showsSavingInDetails: true },
  ] satisfies Omit<SubscriptionPlan, "pricePerLitre">[]
).map((plan) => ({ ...plan, pricePerLitre: priceAfterPercentOff(plan.percentOff) }));

// One-time purchase delivery charge from the design (once per order, whatever the quantity)
const oneTimeDeliveryCharge = 30;

// Biggest plan discount, e.g. "Subscribe & save up to 13%"
const biggestPlanSavingPercent = Math.max(...subscriptionPlans.map((plan) => plan.percentOff));

/*
  Fast selling products: five items with the pictures the site already uses; the row changes with the tab.
  "View Product" opens /products/<productId> (ids from the product list where the product is in it; like on
  the landing page, they open "not found" until their pages are made).
*/
// Subscribe & save: the landing page's Best Sellers products (names, pictures and rating count from there)
const subscriptionFastSellingProducts = [
  { productId: "a2-desi-milk", name: "A2 Desi Milk", imageSource: "/images/products/a2-cow-milk-1-litre-bottle.webp", imageWidth: 232, imageHeight: 500, ratingCount: "7,105" },
  { productId: "a2-desi-ghee", name: "A2 Desi Ghee", imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204, ratingCount: "7,105" },
  { productId: "fresh-cow-paneer", name: "Fresh Cow Paneer", imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 3712, imageHeight: 2728, ratingCount: "7,105" },
  { productId: "moringa-powder", name: "Moringa Powder", imageSource: "/images/products/moringa-leaves-powder-pouch.webp", imageWidth: 336, imageHeight: 516, ratingCount: "7,105" },
  { productId: "turmeric-powder", name: "Turmeric Powder", imageSource: "/images/products/turmeric-powder-pouch.webp", imageWidth: 360, imageHeight: 548, ratingCount: "7,105" },
];

// One-time purchase: the design's five items
const oneTimeFastSellingProducts = [
  { productId: "a2-desi-ghee", name: "A2 Desi Ghee", imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204, ratingCount: "1,069" },
  { productId: "fresh-cow-paneer", name: "Fresh Cow Paneer", imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 3712, imageHeight: 2728, ratingCount: "982" },
  { productId: "batter-powder", name: "Batter Powder", imageSource: "/images/categories/batter-category-chiranvi-farm.webp", imageWidth: 372, imageHeight: 248, ratingCount: "764" },
  { productId: "whole-wheat-atta", name: "Flours", imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276, ratingCount: "1,106" },
  { productId: "desi-white-butter", name: "Desi White Butter", imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272, ratingCount: "646" },
];

const productHighlights = ["No Urea", "100% Raw Milk", "No Hormones", "No Preservatives"];

// Indian number format with the rupee sign, e.g. ₹31,320
function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// Totals for one plan: bottles, the plan price, the same bottles at the one-time price, and the saving.
function calculatePlan(plan: SubscriptionPlan, bottlesPerDay: number) {
  const bottleCount = plan.days * bottlesPerDay;
  const planTotal = bottleCount * plan.pricePerLitre;
  const oneTimeTotal = bottleCount * milkProduct.price;
  return { bottleCount, planTotal, oneTimeTotal, saving: oneTimeTotal - planTotal };
}

/*
  The order cut-off countdown ("Order within 3 hrs 14 min for your first bottle tomorrow by 7 AM").
  Orders close at 9 PM; after that the countdown runs to 9 PM tomorrow and the first bottle comes the
  day after tomorrow. It uses the browser's clock, so it is only shown once the page has loaded there.
*/
function subscribeToClock(onTick: () => void) {
  const clockTimer = window.setInterval(onTick, 30000);
  return () => window.clearInterval(clockTimer);
}

function getCurrentMinute() {
  return Math.floor(Date.now() / 60000);
}

function describeOrderCutoff(currentMinute: number) {
  const now = new Date(currentMinute * 60000);
  const cutoff = new Date(now);
  cutoff.setHours(21, 0, 0, 0);
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

/*
  "Add Quantity" (adds to the cart, the same way the landing page used to):
  - logged in: adds one bottle; then the button becomes "- quantity +" (at 0 it is Add Quantity again);
  - not logged in: goes to the login with the milk remembered, and the login adds it and comes back here.
*/
function MilkCartControl({
  isLoggedIn,
  quantityInCart,
  hintCount,
}: {
  isLoggedIn: boolean;
  quantityInCart: number;
  hintCount: number; // how many times "choose a quantity first" was shown; above 0 = Add Quantity draws attention
}) {
  const attentionClass = hintCount > 0 ? styles["milk-add-quantity-attention"] : "";
  if (quantityInCart > 0) {
    return (
      <div className={styles["milk-quantity-control"]} role="group" aria-label={`${milkProduct.name} quantity`}>
        <button
          type="button"
          aria-label="Remove one bottle"
          className={styles["milk-quantity-button"]}
          onClick={() => changeCartItemQuantity(milkProduct.productId, -1)}
        >
          −
        </button>
        <span className={styles["milk-quantity"]} aria-live="polite">
          {quantityInCart}
        </span>
        <button
          type="button"
          aria-label="Add one more bottle"
          className={styles["milk-quantity-button"]}
          onClick={() => changeCartItemQuantity(milkProduct.productId, 1)}
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
        className={`${styles["milk-add-to-cart-button"]} ${attentionClass}`}
        onClick={() => addProductToCart(milkProduct)}
      >
        Add Quantity
      </button>
    );
  }

  return (
    <Link
      key={hintCount}
      href="/login"
      className={`${styles["milk-add-to-cart-button"]} ${attentionClass}`}
      onPointerDown={() => rememberPendingCartProduct(milkProduct)}
      onKeyDown={(event) => {
        if (event.key === "Enter") rememberPendingCartProduct(milkProduct);
      }}
    >
      Add Quantity
    </Link>
  );
}

/*
  One-time purchase "Checkout to Cart": opens the cart page with the milk in it.
  - logged in: adds one bottle first if milk is not in the cart yet, then opens the cart;
  - not logged in: goes to the login with the milk remembered (the login adds it and comes back here).
*/
function CheckoutToCartButton({
  isLoggedIn,
  quantityInCart,
  onNeedQuantity,
}: {
  isLoggedIn: boolean;
  quantityInCart: number;
  onNeedQuantity: () => void;
}) {
  const router = useRouter();

  // No quantity chosen yet: greyed, and a click points to Add Quantity
  if (quantityInCart === 0) {
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          className={`${styles["milk-checkout-to-cart-button"]} ${styles["milk-button-waiting"]}`}
          onClick={onNeedQuantity}
        >
          Checkout to Cart
        </button>
        <p className={styles["milk-payment-note"]}>Choose how many bottles with Add Quantity above first.</p>
      </>
    );
  }

  if (!isLoggedIn) {
    return (
      <Link
        href="/login"
        className={styles["milk-checkout-to-cart-button"]}
        onPointerDown={() => rememberPendingCartProduct(milkProduct)}
        onKeyDown={(event) => {
          if (event.key === "Enter") rememberPendingCartProduct(milkProduct);
        }}
      >
        Checkout to Cart
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={styles["milk-checkout-to-cart-button"]}
      onClick={() => {
        // A one-time purchase now: a plan left waiting in the cart from "Start subscription" goes
        // (otherwise the cart would show that plan instead of the one-time milk)
        setCartSubscription(null);
        router.push("/cart");
      }}
    >
      Checkout to Cart
    </button>
  );
}

export default function MilkProductPage() {
  const isLoggedIn = useIsLoggedIn();
  const cartItems = useCartItems();
  const quantityInCart = cartItems.find((cartItem) => cartItem.productId === milkProduct.productId)?.quantity ?? 0;
  // Bottles every morning for the plans: the cart quantity, or 1 before milk is in the cart
  const bottlesPerDay = Math.max(1, quantityInCart);
  /*
    The left column (bottle, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the plan side scrolls; the bottle area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the bottle area's height is kept up to date here.
  */
  const bottleAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bottleArea = bottleAreaRef.current;
    if (!bottleArea) return;
    const heightObserver = new ResizeObserver(() => {
      bottleArea.style.setProperty("--milk-bottle-stage-height", `${bottleArea.offsetHeight}px`);
    });
    heightObserver.observe(bottleArea);
    return () => heightObserver.disconnect();
  }, []);

  const [purchaseType, setPurchaseType] = useState<"subscribe" | "one-time">("subscribe");
  // One-time purchase bill: the bottles at the one-time price, plus the delivery charge
  const oneTimeMilkTotal = bottlesPerDay * milkProduct.price;
  const [chosenPlanId, setChosenPlanId] = useState("6-months");
  const chosenPlan = subscriptionPlans.find((plan) => plan.planId === chosenPlanId) ?? subscriptionPlans[1];
  const chosenPlanTotals = calculatePlan(chosenPlan, bottlesPerDay);
  const router = useRouter();
  const currentMinute = useSyncExternalStore(subscribeToClock, getCurrentMinute, () => null);
  const orderCutoff = currentMinute === null ? null : describeOrderCutoff(currentMinute);

  /*
    Start subscription or Checkout to Cart before choosing a quantity: Add Quantity comes into view,
    shakes and glows, and a tip says to choose the bottles first (each click starts it again).
  */
  const [quantityHintCount, setQuantityHintCount] = useState(0);
  const addQuantityAreaRef = useRef<HTMLDivElement>(null);
  function showQuantityHint() {
    setQuantityHintCount((count) => count + 1);
    addQuantityAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /*
    Start subscription (after Add Quantity): the chosen plan goes to the cart, which checks it out
    (address, then Pay now). The quantity stays, so going back here still shows it; the cart takes the
    milk out of the one-time cart once the plan is paid (not bought twice).
  */
  function startSubscription() {
    if (quantityInCart === 0) {
      showQuantityHint();
      return;
    }
    setCartSubscription({
      product: milkProduct,
      planId: chosenPlan.planId,
      planName: chosenPlan.label,
      months: chosenPlan.months,
      days: chosenPlan.days,
      bottlesPerDay,
      pricePerLitre: chosenPlan.pricePerLitre,
      bottleCount: chosenPlanTotals.bottleCount,
      planTotal: chosenPlanTotals.planTotal,
      oneTimeTotal: chosenPlanTotals.oneTimeTotal,
    });
    router.push("/cart");
  }

  return (
    <div className={styles["milk-product-page"]}>
      {/* Green timings strip above the navigation bar (scrolls away; the bar stays at the top) */}
      <p className={styles["milk-delivery-timings-strip"]}>
        Order by 9 PM for delivery tomorrow by 7 AM · Free delivery on all subscriptions
      </p>

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["milk-product-page-content"]}>
        <div className={styles["milk-product-columns"]}>
          {/* Left: bottle, review and delivery steps */}
          <div className={styles["milk-product-left-column"]}>
            <div ref={bottleAreaRef} className={styles["milk-bottle-image-area"]}>
              <Image
                src={milkProduct.imageSource}
                alt="Chiranvi Farms Desi Cow Milk in a glass bottle"
                width={milkProduct.imageWidth}
                height={milkProduct.imageHeight}
                sizes="(max-width: 800px) 40vw, 200px"
                priority
                className={styles["milk-bottle-image"]}
              />
            </div>

            <figure className={styles["milk-review-card"]}>
              <FiveStars className={styles["milk-review-stars"]} />
              <blockquote className={styles["milk-review-quote"]}>
                &ldquo;Tastes like the milk we had in our village. Thick, fresh, and the morning delivery is always on
                time.&rdquo;
              </blockquote>
              {/* Design: "Subscriber for 8 months" on its own line, then the name and area */}
              <p className={styles["milk-review-subscriber-since"]}>Subscriber for 8 months</p>
              <figcaption className={styles["milk-review-author"]}>
                <span className={styles["milk-review-author-name"]}>Lakshmi R.</span>
                <span className={styles["milk-review-author-area"]}>, Basavanagudi</span>
              </figcaption>
            </figure>

            <ol className={styles["milk-delivery-steps-card"]} aria-label="How your milk reaches you">
              <li className={styles["milk-delivery-step"]}>
                <span className={styles["milk-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["milk-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["milk-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["milk-delivery-step"]}>
                <span className={styles["milk-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24" className={styles["milk-delivery-step-icon-filled"]}>
                    <path d="M12 3.5c-.4 0-.7.2-.9.5C9.4 6.6 6.5 10.6 6.5 14a5.5 5.5 0 0011 0c0-3.4-2.9-7.4-4.6-10-.2-.3-.5-.5-.9-.5z" />
                  </svg>
                </span>
                <span className={styles["milk-delivery-step-title"]}>Milked at 5 AM</span>
                <span className={styles["milk-delivery-step-detail"]}>Chilled within minutes</span>
              </li>
              <li className={styles["milk-delivery-step"]}>
                <span className={styles["milk-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["milk-delivery-step-title"]}>At your door</span>
                <span className={styles["milk-delivery-step-detail"]}>By 7 AM</span>
              </li>
            </ol>
          </div>

          {/* Right: product details, price, Add to Cart and the plans */}
          <div className={styles["milk-product-right-column"]}>
            <span className={styles["milk-best-seller-badge"]}>Best seller</span>
            <h1 className={styles["milk-product-name"]}>{milkProduct.name}</h1>
            <p className={styles["milk-product-tagline"]}>Fresh, Raw &amp; Unprocessed</p>
            <p className={styles["milk-product-description"]}>
              Pure A2 milk from our own desi cows, milked at dawn and delivered chilled the same morning. No
              adulteration, no preservatives, no hormones.
            </p>

            <p className={styles["milk-product-rating"]}>
              <FiveStars className={styles["milk-product-rating-stars"]} />
              <span className={styles["milk-product-rating-score"]}>4.8</span>
              <span className={styles["milk-product-rating-count"]}>(12.4k)</span>
              <span className={styles["milk-product-homes"]}>
                <strong>9.3k+ homes</strong> get it every morning
              </span>
            </p>

            <ul className={styles["milk-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["milk-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            <p className={styles["milk-price-row"]}>
              <span className={styles["milk-price"]}>₹{milkProduct.price}</span>
              <span className={styles["milk-price-unit"]}>/ litre</span>
              <s className={styles["milk-original-price"]}>
                <span className={styles["milk-visually-hidden"]}>Was </span>₹{milkProduct.originalPrice}
              </s>
              <span className={styles["milk-save-badge"]}>Save {getDiscountPercent(milkProduct)}%</span>
            </p>
            <p className={styles["milk-quantity-label"]}>
              <strong>Quantity</strong> · 1 litre glass bottle each
            </p>

            <div ref={addQuantityAreaRef} className={styles["milk-add-quantity-area"]}>
              <MilkCartControl
                isLoggedIn={isLoggedIn}
                quantityInCart={quantityInCart}
                hintCount={quantityInCart === 0 ? quantityHintCount : 0}
              />
              {quantityInCart === 0 && quantityHintCount > 0 && (
                <span key={quantityHintCount} className={styles["milk-add-quantity-tip"]} role="status">
                  Choose how many bottles first
                </span>
              )}
            </div>

            {/* Choose your plan */}
            <section className={styles["milk-plan-panel"]} aria-labelledby="milk-plan-heading">
              <h2 id="milk-plan-heading" className={styles["milk-plan-heading"]}>
                Choose your plan
              </h2>

              <div className={styles["milk-plan-tabs"]} role="tablist" aria-label="How to buy">
                <button
                  type="button"
                  role="tab"
                  aria-selected={purchaseType === "subscribe"}
                  className={`${styles["milk-plan-tab"]} ${purchaseType === "subscribe" ? styles["milk-plan-tab-selected"] : ""}`}
                  onClick={() => setPurchaseType("subscribe")}
                >
                  Subscribe &amp; save up to {biggestPlanSavingPercent}%
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={purchaseType === "one-time"}
                  className={`${styles["milk-plan-tab"]} ${purchaseType === "one-time" ? styles["milk-plan-tab-selected"] : ""}`}
                  onClick={() => setPurchaseType("one-time")}
                >
                  One-time purchase
                </button>
              </div>

              {purchaseType === "one-time" ? (
                <>
                  {/* One-time purchase: the bottles in the cart, the bill, and Checkout to Cart */}
                  <div className={styles["milk-one-time-summary"]}>
                    <div className={styles["milk-one-time-product-row"]}>
                      <span className={styles["milk-one-time-product-icon"]} aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M10 3h4v2.5l1.5 2V21h-7V7.5l1.5-2z" />
                          <path d="M8.5 12h7" />
                        </svg>
                      </span>
                      <span className={styles["milk-one-time-product-text"]}>
                        <strong>{milkProduct.name}</strong>
                        <span>
                          {bottlesPerDay} × {milkProduct.packSize}
                        </span>
                      </span>
                      <span className={styles["milk-one-time-product-amount"]}>{formatRupees(oneTimeMilkTotal)}</span>
                    </div>

                    <dl className={styles["milk-one-time-bill"]}>
                      <div className={styles["milk-one-time-bill-row"]}>
                        <dt>
                          Milk ({bottlesPerDay}L × ₹{milkProduct.price})
                        </dt>
                        <dd>{formatRupees(oneTimeMilkTotal)}</dd>
                      </div>
                      <div className={styles["milk-one-time-bill-row"]}>
                        <dt>Delivery charge</dt>
                        <dd>{formatRupees(oneTimeDeliveryCharge)}</dd>
                      </div>
                      <div className={`${styles["milk-one-time-bill-row"]} ${styles["milk-one-time-bill-total-row"]}`}>
                        <dt>Total</dt>
                        <dd>{formatRupees(oneTimeMilkTotal + oneTimeDeliveryCharge)}</dd>
                      </div>
                    </dl>
                  </div>

                  <p className={styles["milk-one-time-delivery-day"]}>
                    Delivered {orderCutoff?.deliveryDay ?? "tomorrow"} by 7 AM
                  </p>

                  <CheckoutToCartButton isLoggedIn={isLoggedIn} quantityInCart={quantityInCart} onNeedQuantity={showQuantityHint} />
                  <p className={styles["milk-plan-footnote"]}>100% safe · Free Delivery</p>
                </>
              ) : (
                <>
                  <fieldset className={styles["milk-plan-options"]}>
                    <legend className={styles["milk-visually-hidden"]}>Subscription length</legend>
                    {subscriptionPlans.map((plan) => {
                      const planTotals = calculatePlan(plan, bottlesPerDay);
                      const isChosen = plan.planId === chosenPlan.planId;
                      return (
                        <label
                          key={plan.planId}
                          className={`${styles["milk-plan-option"]} ${isChosen ? styles["milk-plan-option-chosen"] : ""}`}
                        >
                          {plan.tag && (
                            <span
                              className={`${styles["milk-plan-tag"]} ${
                                plan.tag === "Best value" ? styles["milk-plan-tag-best-value"] : ""
                              }`}
                            >
                              {plan.tag}
                            </span>
                          )}
                          <input
                            type="radio"
                            name="milk-subscription-plan"
                            value={plan.planId}
                            checked={isChosen}
                            onChange={() => setChosenPlanId(plan.planId)}
                            className={styles["milk-plan-radio"]}
                          />
                          <span className={styles["milk-plan-text"]}>
                            <span className={styles["milk-plan-label"]}>{plan.label}</span>
                            <span className={styles["milk-plan-details"]}>
                              ₹{plan.pricePerLitre} / litre · <strong>{plan.percentOff}% off</strong> ·{" "}
                              {plan.showsSavingInDetails ? (
                                <>
                                  <strong>{planTotals.bottleCount.toLocaleString("en-IN")} bottles</strong> · you save{" "}
                                  {formatRupees(planTotals.saving)}
                                </>
                              ) : (
                                <>
                                  {bottlesPerDay}L daily ·{" "}
                                  <strong>{planTotals.bottleCount.toLocaleString("en-IN")} bottles</strong>
                                </>
                              )}
                            </span>
                          </span>
                          <span className={styles["milk-plan-amounts"]}>
                            <span className={styles["milk-plan-total"]}>{formatRupees(planTotals.planTotal)}</span>
                            <s className={styles["milk-plan-one-time-total"]}>
                              <span className={styles["milk-visually-hidden"]}>Without a plan </span>
                              {formatRupees(planTotals.oneTimeTotal)}
                            </s>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  <div className={styles["milk-plan-summary"]}>
                    <span className={styles["milk-plan-summary-icon"]} aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M6 3.5h3v2l1 1.5v12.5H5V7l1-1.5zM15 3.5h3v2l1 1.5v12.5h-5V7l1-1.5z" />
                        <path d="M5 11h5M14 11h5" />
                      </svg>
                    </span>
                    <span className={styles["milk-plan-summary-text"]}>
                      <strong>
                        Your plan: {bottlesPerDay} × 1 L {bottlesPerDay === 1 ? "bottle" : "bottles"} every morning
                      </strong>
                      <span>
                        {chosenPlanTotals.bottleCount.toLocaleString("en-IN")} bottles over {chosenPlan.months} months
                      </span>
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-disabled={quantityInCart === 0 ? true : undefined}
                    className={`${styles["milk-start-subscription-button"]} ${quantityInCart === 0 ? styles["milk-button-waiting"] : ""}`}
                    onClick={startSubscription}
                  >
                    Start subscription @ {formatRupees(chosenPlanTotals.planTotal)}
                  </button>
                  {quantityInCart === 0 && (
                    <p className={styles["milk-payment-note"]}>Choose how many bottles with Add Quantity above first.</p>
                  )}
                  <p className={styles["milk-plan-footnote"]}>Pause anytime · Free Delivery</p>
                </>
              )}
            </section>

            {orderCutoff && (
              <p className={styles["milk-order-cutoff-strip"]}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.5v3h-7z" />
                  <circle cx="6.5" cy="17.5" r="1.8" />
                  <circle cx="17" cy="17.5" r="1.8" />
                </svg>
                Order within {orderCutoff.timeLeft} for your first bottle {orderCutoff.deliveryDay} by 7 AM
              </p>
            )}
          </div>
        </div>

        {/* Fast selling products */}
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

          <ul className={styles["fast-selling-product-list"]}>
            {(purchaseType === "one-time" ? oneTimeFastSellingProducts : subscriptionFastSellingProducts).map((product) => (
              <li key={product.productId} className={styles["fast-selling-card"]}>
                <div className={styles["fast-selling-image-area"]}>
                  <Image
                    src={product.imageSource}
                    alt={product.name}
                    width={product.imageWidth}
                    height={product.imageHeight}
                    sizes="200px"
                    className={styles["fast-selling-image"]}
                  />
                </div>
                <h3 className={styles["fast-selling-name"]}>{product.name}</h3>
                <p className={styles["fast-selling-rating"]}>
                  <FiveStars className={styles["fast-selling-stars"]} />
                  <span className={styles["fast-selling-rating-count"]}>({product.ratingCount})</span>
                </p>
                <Link
                  href={`/products/${product.productId}`}
                  aria-label={`View ${product.name}`}
                  className={styles["fast-selling-view-product-button"]}
                >
                  View Product
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
