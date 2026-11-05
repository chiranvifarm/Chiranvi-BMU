"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteFooter from "@/components/footer/site-footer";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, changeCartItemQuantity, rememberPendingCartProduct, useCartItems, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent, useShopProducts } from "@/store/products-store";
import { ROW_SIZE, productRowFor, useProductRows } from "@/store/admin-product-rows-store";
import { FREE_DELIVERY_FROM } from "./product-page-data";
import type { DeliveryStepIcon, OneTimePack, OneTimeProductPage as OneTimePageData, PictureFit } from "./product-page-data";
import { ProductCardTile, SoldOutNotice, useProductCards, useSoldOutPanelCardId } from "./all-products-page";
import styles from "./one-time-product-page.module.css";

/*
  One-time purchase product page template (ghee, paneer, butter, atta, batter, and every one-time product
  added in the Chiranvi Panel). It draws one entry of product-page-data.ts / the panel:
  - left: the picture(s) on the landing hero's gold ring and green panel, a customer review and the three
    delivery steps; fixed under the navigation bar while the right side scrolls;
  - right: name, price of the chosen pack, pack sizes, Add to cart (then "− n +"), Buy now, and free delivery
    (always, or "Add ₹X more" until the order reaches the product's amount);
  - below: Product information, Nutrition facts and Fast selling products.
*/

// Indian number format with the rupee sign, e.g. ₹1,399
function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// How big each picture is in its area (sized by width, or by height when no width is given)
function pictureFitStyle(fit: PictureFit): CSSProperties {
  return fit.widthPercent
    ? { width: `${fit.widthPercent}%`, height: "auto", maxHeight: `${fit.heightPercent}%` }
    : { width: "auto", height: `${fit.heightPercent}%` };
}

/*
  The line under the price ("₹69.80 per 100 g · Inclusive of all taxes" / "About 20 idlis · incl. all taxes")
  and on each pack card ("₹70 / 100 g" / "About 20 idlis").
*/
function describePriceHeadline(page: OneTimePageData, pack: OneTimePack) {
  const breakdown = page.priceBreakdown;
  if (breakdown.kind === "item-count") return `About ${pack.itemCount ?? 0} ${breakdown.itemLabel} · ${breakdown.taxNote}`;
  const perUnit = (pack.price / pack.size) * breakdown.unitSize;
  const amount = breakdown.headlineDecimals === 2 ? perUnit.toFixed(2) : String(Math.round(perUnit));
  return `₹${amount} per ${breakdown.unitLabel} · ${breakdown.taxNote}`;
}

function describePackCardBreakdown(page: OneTimePageData, pack: OneTimePack) {
  const breakdown = page.priceBreakdown;
  if (breakdown.kind === "item-count") return `About ${pack.itemCount ?? 0} ${breakdown.itemLabel}`;
  const perUnit = (pack.price / pack.size) * breakdown.unitSize;
  const amount = breakdown.cardRounding === "half" ? Math.round(perUnit * 2) / 2 : Math.round(perUnit);
  return `₹${amount} / ${breakdown.unitLabel}`;
}

// Each pack size is its own line in the cart
function toCartProduct(page: OneTimePageData, pack: OneTimePack): CartProduct {
  const picture = page.pictures[0];
  return {
    productId: `${page.slug}-${pack.packId}`,
    name: page.name,
    imageSource: picture?.imageSource ?? "",
    imageWidth: picture?.imageWidth ?? 400,
    imageHeight: picture?.imageHeight ?? 400,
    packSize: `${pack.label} ${page.cartPackWord}`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
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
      <svg viewBox="0 0 24 24" style={{ fill: "#ffffff", stroke: "none" }}>
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

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["one-time-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

/*
  The row of five products under the page, set in the Chiranvi Panel (Products & pricing → Product rows, or
  this page's own order in Edit page; store/admin-product-rows-store.ts):
    - "Fast selling products" on most pages; "View all" opens All products.
    - "You may also like" on the noodles, pasta and macaroni pages; "View all" opens Pasta & Noodles.
  The product's own card is left out on its own page (clicking it would only open this page again). When
  fewer than five are left (a product deleted in the panel), the next products of the All products page
  fill the row (for "You may also like": only noodles, pasta, macaroni, milk and ghee).
*/
const YOU_MAY_ALSO_LIKE_EXTRA_CATEGORIES = ["Noodles", "Pasta", "Macaroni", "Milk", "Ghee"];

export function FastSellingRow({ currentSlug, override }: { currentSlug: string; override?: string[] }) {
  const allCards = useProductCards();
  const { slugs, isYouMayAlsoLike } = productRowFor(currentSlug, useProductRows(), override);
  const listedCards = slugs.flatMap((slug) => allCards.filter((card) => card.slug === slug));
  const extraCards = allCards
    .filter(
      (card) =>
        card.hasPage &&
        card.slug !== currentSlug &&
        !listedCards.some((listed) => listed.slug === card.slug) &&
        (!isYouMayAlsoLike || YOU_MAY_ALSO_LIKE_EXTRA_CATEGORIES.includes(card.category)),
    )
    // "You may also like": other noodles, pasta and macaroni fill empty places before milk and ghee
    .sort((first, second) =>
      isYouMayAlsoLike ? Number(["Milk", "Ghee"].includes(first.category)) - Number(["Milk", "Ghee"].includes(second.category)) : 0,
    );
  const rowCards = [...listedCards, ...extraCards].slice(0, ROW_SIZE);
  const recommendedSlugs = isYouMayAlsoLike;
  return (
    <section className={styles["fast-selling-section"]} aria-labelledby="fast-selling-heading">
      <div className={styles["fast-selling-heading-row"]}>
        <h2 id="fast-selling-heading" className={styles["fast-selling-heading"]}>
          {recommendedSlugs ? "You may also like" : "Fast selling products"}
        </h2>
        <Link href={recommendedSlugs ? `/products?category=${encodeURIComponent("Pasta & Noodles")}` : "/products"} className={styles["fast-selling-view-all-link"]}>
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

export default function OneTimeProductPage({ page }: { page: OneTimePageData }) {
  const [chosenPackId, setChosenPackId] = useState(page.defaultPackId);
  // A pack turned off on Products & pricing, or sold out: its stock count is 0. It shows Out of stock
  const shopProducts = useShopProducts();
  const isPackOff = (packId: string) => shopProducts.some((product) => product.stockCounts?.[`${page.slug}-${packId}`] === 0);
  const chosenPack =
    page.packs.find((pack) => pack.packId === chosenPackId && !isPackOff(pack.packId)) ??
    page.packs.find((pack) => !isPackOff(pack.packId)) ??
    page.packs[0];
  /*
    Quantity: the chosen pack's number in the cart. Not in the cart: "Add to cart" (adds one); then
    "− n +" changes the cart, and − at 1 takes it out, back to "Add to cart". Not logged in, Add to cart
    goes to the login with one pack remembered (the login adds it and comes back here). The customer then
    checks out from the cart: Buy now or the cart icon, then Cart → Select address → Pay now.
    Buy now works only once the chosen pack is in the cart: before that it is greyed, and a click makes
    Add to cart shake and glow with an "Add to cart first" tip (like Add Quantity on the milk page).
  */
  const isLoggedIn = useIsLoggedIn();
  // Switched off or out of stock in the panel: it cannot be ordered (its card id, for Notify me)
  const soldOutPanelCardId = useSoldOutPanelCardId(page);
  const cartItems = useCartItems();
  const chosenPackCartProduct = chosenPack ? toCartProduct(page, chosenPack) : null;
  const router = useRouter();
  const chosenPackCartId = chosenPackCartProduct?.productId ?? "";
  const quantityInCart = cartItems.find((cartItem) => cartItem.productId === chosenPackCartId)?.quantity ?? 0;
  const isChosenPackInCart = quantityInCart > 0;
  // How many times Buy now was clicked before Add to cart; each new value restarts the hint animation
  const [addToCartHintCount, setAddToCartHintCount] = useState(0);
  const buyRowRef = useRef<HTMLDivElement>(null);
  function buyNow() {
    if (!isChosenPackInCart) {
      setAddToCartHintCount((count) => count + 1);
      buyRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    router.push("/cart");
  }
  function addChosenPackToCart() {
    if (!chosenPackCartProduct) return;
    addProductToCart(chosenPackCartProduct);
    setAddToCartHintCount(0);
  }
  // Free delivery is for the whole order, not each product (as the cart works it out): what is in the cart
  // (empty bar before the first product is added) against the one free delivery amount (₹500)
  const orderAmount = cartItems.reduce((sum, cartItem) => sum + cartItem.price * cartItem.quantity, 0);
  const freeDeliveryFromAmount = page.freeDelivery.kind === "from" ? FREE_DELIVERY_FROM : 0;
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryFromAmount - orderAmount);
  const freeDeliveryProgressPercent =
    freeDeliveryFromAmount > 0 ? Math.min(100, (orderAmount / freeDeliveryFromAmount) * 100) : 100;

  /*
    The left column (picture, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const pictureAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pictureArea = pictureAreaRef.current;
    if (!pictureArea) return;
    const heightObserver = new ResizeObserver(() => {
      pictureArea.style.setProperty("--one-time-picture-stage-height", `${pictureArea.offsetHeight}px`);
    });
    heightObserver.observe(pictureArea);
    return () => heightObserver.disconnect();
  }, []);

  const badgeColourClass = page.badge.colour === "green" ? "" : styles[`one-time-badge-${page.badge.colour}`];
  const quantityWord = page.quantityWord;

  return (
    <div className={styles["one-time-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["one-time-product-page-content"]}>
        <div className={styles["one-time-product-columns"]}>
          {/* Left: picture(s), review and delivery steps */}
          <div className={styles["one-time-product-left-column"]}>
            <div ref={pictureAreaRef} className={styles["one-time-picture-area"]}>
              {page.pictures.map((picture) => (
                <Image
                  key={picture.imageSource}
                  src={picture.imageSource}
                  alt={picture.alt}
                  width={picture.imageWidth}
                  height={picture.imageHeight}
                  sizes={page.pictures.length > 1 ? "(max-width: 800px) 35vw, 220px" : "(max-width: 800px) 70vw, 420px"}
                  unoptimized={picture.isServedAsIs}
                  priority
                  className={`${styles["one-time-picture"]} ${page.hasPictureShadow ? styles["one-time-picture-with-shadow"] : ""}`}
                  style={pictureFitStyle(page.pictureFit)}
                />
              ))}
            </div>

            {/* No review text (a product added without one): no review box */}
            {page.review.quote && (
              <figure className={styles["one-time-review-card"]}>
                <FiveStars className={styles["one-time-review-stars"]} />
                <blockquote className={styles["one-time-review-quote"]}>&ldquo;{page.review.quote}&rdquo;</blockquote>
                <figcaption className={styles["one-time-review-author"]}>
                  <span className={styles["one-time-review-author-name"]}>{page.review.name}</span>
                  {page.review.area && <span className={styles["one-time-review-author-area"]}>, {page.review.area}</span>}
                  <span className={styles["one-time-review-author-area"]}> · </span>
                  <span className={styles["one-time-review-verified"]}>✓ Verified buyer</span>
                </figcaption>
              </figure>
            )}

            <ol className={styles["one-time-delivery-steps-card"]} aria-label={`How your ${page.name} reaches you`}>
              {page.deliverySteps.map((step) => (
                <li key={step.title} className={styles["one-time-delivery-step"]}>
                  <span className={styles["one-time-delivery-step-icon"]} aria-hidden="true">
                    <DeliveryStepIconPicture icon={step.icon} />
                  </span>
                  <span className={styles["one-time-delivery-step-title"]}>{step.title}</span>
                  <span className={styles["one-time-delivery-step-detail"]}>{step.detail}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity, the buttons and free delivery */}
          <div className={styles["one-time-product-right-column"]}>
            {page.badge.text && <span className={`${styles["one-time-badge"]} ${badgeColourClass}`}>{page.badge.text}</span>}
            <h1 className={styles["one-time-product-name"]}>{page.name}</h1>
            <p className={styles["one-time-product-tagline"]}>{page.tagline}</p>
            <p className={styles["one-time-product-description"]}>{page.description}</p>

            <p className={styles["one-time-product-rating"]}>
              <FiveStars className={styles["one-time-product-rating-stars"]} />
              <span className={styles["one-time-product-rating-score"]}>{page.rating.score}</span>
              <span className={styles["one-time-product-rating-count"]}>
                {page.rating.count}
                {page.ratingNote ? " ·" : ""}
              </span>
              {page.ratingNote && <span className={styles["one-time-product-rating-note"]}>{page.ratingNote}</span>}
            </p>

            <ul className={styles["one-time-product-highlights"]}>
              {page.highlights.map((highlight) => (
                <li key={highlight} className={styles["one-time-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {chosenPack && (
              <>
                {/* Price of the chosen pack */}
                <p className={styles["one-time-price-row"]}>
                  <span className={styles["one-time-price"]}>{formatRupees(chosenPack.price)}</span>
                  <span className={styles["one-time-price-unit"]}>/ {chosenPack.label}</span>
                  {chosenPack.originalPrice && chosenPack.originalPrice > chosenPack.price && (
                    <>
                      <s className={styles["one-time-original-price"]}>
                        <span className={styles["one-time-visually-hidden"]}>Was </span>
                        {formatRupees(chosenPack.originalPrice)}
                      </s>
                      <span className={styles["one-time-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                    </>
                  )}
                </p>
                <p className={styles["one-time-price-breakdown"]}>{describePriceHeadline(page, chosenPack)}</p>
              </>
            )}

            {/* Choose Your Pack Size */}
            <fieldset className={styles["one-time-pack-sizes"]}>
              <legend className={styles["one-time-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["one-time-pack-size-options"]}>
                {page.packs.map((pack) => {
                  const isOff = isPackOff(pack.packId);
                  const isChosen = pack.packId === chosenPack?.packId && !isOff;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["one-time-pack-size-option"]} ${isChosen ? styles["one-time-pack-size-option-chosen"] : ""} ${
                        isOff ? styles["one-time-pack-size-option-off"] : ""
                      }`}
                    >
                      {pack.tag && !isOff && (
                        <span
                          className={`${styles["one-time-pack-tag"]} ${pack.tag === "Best value" ? styles["one-time-pack-tag-best-value"] : ""}`}
                        >
                          {pack.tag}
                        </span>
                      )}
                      <input
                        type="radio"
                        name="one-time-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        disabled={isOff}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["one-time-visually-hidden"]}
                      />
                      <span className={styles["one-time-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["one-time-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      {isOff ? (
                        <span className={styles["one-time-pack-size-out-of-stock"]}>Out of stock</span>
                      ) : (
                        <span className={styles["one-time-pack-size-breakdown"]}>{describePackCardBreakdown(page, pack)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {page.note.text && (
              <p className={`${styles["one-time-note"]} ${page.note.tone === "warning" ? styles["one-time-note-warning"] : ""}`}>
                {page.note.tone === "fresh" && <span className={styles["one-time-note-dot"]} aria-hidden="true" />}
                {page.note.text}
              </p>
            )}

            {/* Out of stock in the panel: no quantity or ordering, only Notify me */}
            {soldOutPanelCardId ? (
              <SoldOutNotice cardId={chosenPackCartId} panelCardId={soldOutPanelCardId} />
            ) : (
            <>
            {/* Quantity: Add to cart (then "− n +") and Buy now */}
            <p className={styles["one-time-section-label"]}>Quantity</p>
            <div ref={buyRowRef} className={styles["one-time-buy-row"]}>
              {/* Buy now clicked first: a tip above Add to cart (it fades after a few seconds) */}
              {!isChosenPackInCart && addToCartHintCount > 0 && (
                <span key={`add-to-cart-tip-${addToCartHintCount}`} className={styles["one-time-add-to-cart-tip"]} role="status">
                  Add to cart first
                </span>
              )}
              {isChosenPackInCart ? (
                <div className={styles["one-time-quantity-control"]} role="group" aria-label={`Number of ${quantityWord.many}`}>
                  <button
                    type="button"
                    aria-label={`One ${quantityWord.one} fewer`}
                    className={styles["one-time-quantity-minus-button"]}
                    onClick={() => changeCartItemQuantity(chosenPackCartId, -1)}
                  >
                    −
                  </button>
                  <span className={styles["one-time-quantity"]} aria-live="polite">
                    {quantityInCart}
                  </span>
                  <button
                    type="button"
                    aria-label={`One ${quantityWord.one} more`}
                    className={styles["one-time-quantity-plus-button"]}
                    onClick={() => changeCartItemQuantity(chosenPackCartId, 1)}
                  >
                    +
                  </button>
                </div>
              ) : isLoggedIn ? (
                <button
                  key={`add-to-cart-button-${addToCartHintCount}`}
                  type="button"
                  className={`${styles["one-time-add-to-cart-button"]} ${addToCartHintCount > 0 ? styles["one-time-add-to-cart-attention"] : ""}`}
                  onClick={addChosenPackToCart}
                >
                  <CartIcon />
                  Add to cart
                </button>
              ) : (
                <Link
                  href="/login"
                  className={styles["one-time-add-to-cart-button"]}
                  onPointerDown={() => chosenPackCartProduct && rememberPendingCartProduct(chosenPackCartProduct)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && chosenPackCartProduct) rememberPendingCartProduct(chosenPackCartProduct);
                  }}
                >
                  <CartIcon />
                  Add to cart
                </Link>
              )}
              {/* Buy now: the cart, once the pack is in it (greyed until then; a click shows the hint) */}
              <button
                type="button"
                aria-disabled={!isChosenPackInCart}
                className={`${styles["one-time-buy-now-button"]} ${isChosenPackInCart ? "" : styles["one-time-buy-now-button-waiting"]}`}
                onClick={buyNow}
              >
                Buy now
              </button>
            </div>

            {/* Free delivery: how much more to add, or that this order already has it */}
            <p className={styles["one-time-free-delivery-note"]} aria-live="polite">
              {amountLeftForFreeDelivery > 0 ? (
                <>
                  Add <strong className={styles["one-time-free-delivery-amount-left"]}>{formatRupees(amountLeftForFreeDelivery)} more</strong>{" "}
                  for free delivery
                </>
              ) : (
                <>
                  ✓ <strong>Free delivery</strong> on this order
                </>
              )}
            </p>
            <span className={styles["one-time-free-delivery-track"]} aria-hidden="true">
              <span
                className={`${styles["one-time-free-delivery-progress"]} ${
                  amountLeftForFreeDelivery === 0 ? styles["one-time-free-delivery-progress-reached"] : ""
                }`}
                style={{ width: `${freeDeliveryProgressPercent}%` }}
              />
            </span>
            </>
            )}
          </div>
        </div>

        {/* Product information and Nutrition facts (each left out when the product has none) */}
        {(page.productInformation.length > 0 || page.nutritionFacts.length > 0) && (
        <div className={styles["one-time-information-row"]}>
          {page.productInformation.length > 0 && (
          <section className={styles["one-time-product-information"]} aria-labelledby="one-time-product-information-heading">
            <h2 id="one-time-product-information-heading" className={styles["one-time-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["one-time-product-information-table"]}>
              {page.productInformation.map((row) => (
                <div key={row.label} className={styles["one-time-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
          )}

          {page.nutritionFacts.length > 0 && (
          <section className={styles["one-time-nutrition-facts"]} aria-labelledby="one-time-nutrition-facts-heading">
            <div className={styles["one-time-nutrition-facts-header"]}>
              <h2 id="one-time-nutrition-facts-heading">Nutrition facts</h2>
              <span>{page.nutritionBasis}</span>
            </div>
            <dl className={styles["one-time-nutrition-facts-list"]}>
              {page.nutritionFacts.map((row) => (
                <div key={row.label} className={styles["one-time-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["one-time-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
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
