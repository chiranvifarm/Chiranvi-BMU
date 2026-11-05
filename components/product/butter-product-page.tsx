"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, rememberPendingCartProduct, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import styles from "./butter-product-page.module.css";

/*
  Butter product page (/products/desi-white-butter), from the design. One-time purchase only, laid out like
  the ghee and paneer pages:
  - left: the butter board on the landing hero's gold ring and green panel, a customer review and the
    "Order by 9 PM - Churned fresh - At your door" steps; fixed under the navigation bar while the right
    side scrolls;
  - right: name, price of the chosen pack, pack sizes (100 g / 250 g / 500 g), quantity, Add to cart,
    Buy now, and how much more to add for free delivery (free from ₹499, as on the paneer page);
  - below: Product information, Nutrition facts and Fast selling products.
*/

type ButterPack = {
  packId: string;
  label: string; // "500 g"
  grams: number;
  price: number;
  originalPrice?: number; // crossed-out old price, only where the design shows one
  isBestValue?: boolean;
};

// Prices from the design (change them here)
const butterPacks: ButterPack[] = [
  { packId: "100-g", label: "100 g", grams: 100, price: 129 },
  { packId: "250-g", label: "250 g", grams: 250, price: 279 },
  { packId: "500-g", label: "500 g", grams: 500, price: 499, originalPrice: 599, isBestValue: true },
];

// Orders of this much or more get free delivery (same as the paneer page)
const freeDeliveryFromAmount = 499;

const butterName = "A2 Desi Butter";
// The site's see-through butter picture (the one sent has a white background, which would hide the ring)
const butterImage = { imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272 };

// Price per 100 g: exact with paise under the price (₹99.80), whole rupees on the pack cards like the
// design (₹129, ₹112, ₹100)
function pricePer100Grams(pack: ButterPack) {
  return (pack.price / pack.grams) * 100;
}

// Each pack size is its own line in the cart
function toCartProduct(pack: ButterPack): CartProduct {
  return {
    productId: `desi-white-butter-${pack.packId}`,
    name: butterName,
    ...butterImage,
    packSize: `${pack.label} pack`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
}

const productHighlights = ["Hand-churned", "Unsalted", "No preservatives", "Lab-tested"];

// Product information table from the design ([add address] and [add number] still to be filled in)
const productInformation = [
  { label: "Ingredients", value: "Cream from desi cow curd" },
  { label: "Net quantity", value: "100 g / 250 g / 500 g" },
  { label: "Shelf life", value: "Best within 7 days" },
  { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const nutritionFacts = [
  { label: "Energy", value: "720 kcal" },
  { label: "Protein", value: "0.9 g" },
  { label: "Total fat", value: "80 g" },
  { label: "Saturated fat", value: "51 g" },
  { label: "Carbohydrate", value: "0.6 g" },
];

// Fast selling products: the design's five items (same row as the ghee and paneer pages).
// "View Product" opens /products/<productId>; pages not made yet open "not found".
const fastSellingProducts = [
  { productId: "a2-desi-ghee", name: "A2 Desi Ghee", imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204, ratingCount: "1,069" },
  { productId: "fresh-cow-paneer", name: "Fresh Cow Paneer", imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 3712, imageHeight: 2728, ratingCount: "982" },
  { productId: "batter-powder", name: "Batter Powder", imageSource: "/images/categories/batter-category-chiranvi-farm.webp", imageWidth: 372, imageHeight: 248, ratingCount: "764" },
  { productId: "whole-wheat-atta", name: "Flours", imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276, ratingCount: "1,106" },
  { productId: "desi-white-butter", name: "Desi White Butter", imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272, ratingCount: "646" },
];

// Indian number format with the rupee sign, e.g. ₹1,399
function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
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
  Add to cart and Buy now (both add the chosen pack, as many as the quantity):
  - Add to cart stays on the page; Buy now then opens the cart (Pay now there starts the checkout);
  - not logged in: both go to the login with one pack of the chosen size remembered (the login adds it
    and comes back here).
*/
function ButterCartButtons({ pack, quantity }: { pack: ButterPack; quantity: number }) {
  const isLoggedIn = useIsLoggedIn();
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(false);

  function addChosenPackToCart() {
    for (let packNumber = 0; packNumber < quantity; packNumber++) addProductToCart(toCartProduct(pack));
  }

  if (!isLoggedIn) {
    return (
      <>
        {(["Add to cart", "Buy now"] as const).map((buttonLabel) => (
          <Link
            key={buttonLabel}
            href="/login"
            className={styles[buttonLabel === "Add to cart" ? "butter-add-to-cart-button" : "butter-buy-now-button"]}
            onPointerDown={() => rememberPendingCartProduct(toCartProduct(pack))}
            onKeyDown={(event) => {
              if (event.key === "Enter") rememberPendingCartProduct(toCartProduct(pack));
            }}
          >
            {buttonLabel === "Add to cart" && <CartIcon />}
            {buttonLabel}
          </Link>
        ))}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles["butter-add-to-cart-button"]}
        onClick={() => {
          addChosenPackToCart();
          setIsAdded(true);
        }}
      >
        <CartIcon />
        {isAdded ? "Added to cart" : "Add to cart"}
      </button>
      <button
        type="button"
        className={styles["butter-buy-now-button"]}
        onClick={() => {
          addChosenPackToCart();
          router.push("/cart");
        }}
      >
        Buy now
      </button>
    </>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["butter-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

export default function ButterProductPage() {
  const [chosenPackId, setChosenPackId] = useState("500-g");
  const chosenPack = butterPacks.find((pack) => pack.packId === chosenPackId) ?? butterPacks[2];
  const [quantity, setQuantity] = useState(1);
  // Free delivery: the chosen pack × quantity against ₹499; the bar fills up as the order grows
  const orderAmount = chosenPack.price * quantity;
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryFromAmount - orderAmount);
  const freeDeliveryProgressPercent = Math.min(100, (orderAmount / freeDeliveryFromAmount) * 100);

  /*
    The left column (board, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const boardAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const boardArea = boardAreaRef.current;
    if (!boardArea) return;
    const heightObserver = new ResizeObserver(() => {
      boardArea.style.setProperty("--butter-board-stage-height", `${boardArea.offsetHeight}px`);
    });
    heightObserver.observe(boardArea);
    return () => heightObserver.disconnect();
  }, []);

  return (
    <div className={styles["butter-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["butter-product-page-content"]}>
        <div className={styles["butter-product-columns"]}>
          {/* Left: board, review and delivery steps */}
          <div className={styles["butter-product-left-column"]}>
            <div ref={boardAreaRef} className={styles["butter-board-image-area"]}>
              <Image
                src={butterImage.imageSource}
                alt="Chiranvi Farm desi white butter on a wooden board"
                width={butterImage.imageWidth}
                height={butterImage.imageHeight}
                sizes="(max-width: 800px) 70vw, 420px"
                priority
                className={styles["butter-board-image"]}
              />
            </div>

            <figure className={styles["butter-review-card"]}>
              <FiveStars className={styles["butter-review-stars"]} />
              <blockquote className={styles["butter-review-quote"]}>
                &ldquo;Tastes just like the makkhan at my nani&rsquo;s house. Perfect on hot parathas.&rdquo;
              </blockquote>
              <figcaption className={styles["butter-review-author"]}>
                <span className={styles["butter-review-author-name"]}>Rohit M.</span>
                <span className={styles["butter-review-author-area"]}>, Koramangala · </span>
                <span className={styles["butter-review-verified"]}>✓ Verified buyer</span>
              </figcaption>
            </figure>

            <ol className={styles["butter-delivery-steps-card"]} aria-label="How your butter reaches you">
              <li className={styles["butter-delivery-step"]}>
                <span className={styles["butter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["butter-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["butter-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["butter-delivery-step"]}>
                <span className={styles["butter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M4 10h16M10 14h4" />
                  </svg>
                </span>
                <span className={styles["butter-delivery-step-title"]}>Churned fresh</span>
                <span className={styles["butter-delivery-step-detail"]}>This week&rsquo;s batch</span>
              </li>
              <li className={styles["butter-delivery-step"]}>
                <span className={styles["butter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["butter-delivery-step-title"]}>At your door</span>
                <span className={styles["butter-delivery-step-detail"]}>By 7 AM</span>
              </li>
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity, the buttons and free delivery */}
          <div className={styles["butter-product-right-column"]}>
            <span className={styles["butter-traditional-goodness-badge"]}>Traditional goodness</span>
            <h1 className={styles["butter-product-name"]}>{butterName}</h1>
            <p className={styles["butter-product-tagline"]}>Pure from Desi Cow Milk</p>
            <p className={styles["butter-product-description"]}>
              Enjoy the soft, creamy taste of traditional makkhan, carefully churned from desi cow curd. With its rich
              texture and authentic flavour, it brings a touch of farm-fresh goodness to your breakfast, rotis and
              favourite homemade recipes.
            </p>

            <p className={styles["butter-product-rating"]}>
              <FiveStars className={styles["butter-product-rating-stars"]} />
              <span className={styles["butter-product-rating-score"]}>4.8</span>
              <span className={styles["butter-product-rating-count"]}>(1.1K) ·</span>
              <span className={styles["butter-product-freshly-churned"]}>Freshly Churned</span>
            </p>

            <ul className={styles["butter-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["butter-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {/* Price of the chosen pack */}
            <p className={styles["butter-price-row"]}>
              <span className={styles["butter-price"]}>{formatRupees(chosenPack.price)}</span>
              <span className={styles["butter-price-unit"]}>/ {chosenPack.label}</span>
              {chosenPack.originalPrice && (
                <>
                  <s className={styles["butter-original-price"]}>
                    <span className={styles["butter-visually-hidden"]}>Was </span>
                    {formatRupees(chosenPack.originalPrice)}
                  </s>
                  <span className={styles["butter-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                </>
              )}
            </p>
            <p className={styles["butter-price-per-100-g"]}>
              ₹{pricePer100Grams(chosenPack).toFixed(2)} per 100 g · Inclusive of all taxes
            </p>

            {/* Choose Your Pack Size */}
            <fieldset className={styles["butter-pack-sizes"]}>
              <legend className={styles["butter-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["butter-pack-size-options"]}>
                {butterPacks.map((pack) => {
                  const isChosen = pack.packId === chosenPack.packId;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["butter-pack-size-option"]} ${isChosen ? styles["butter-pack-size-option-chosen"] : ""}`}
                    >
                      {pack.isBestValue && <span className={styles["butter-best-value-tag"]}>Best value</span>}
                      <input
                        type="radio"
                        name="butter-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["butter-visually-hidden"]}
                      />
                      <span className={styles["butter-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["butter-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      <span className={styles["butter-pack-size-per-100-g"]}>
                        ₹{Math.round(pricePer100Grams(pack))} / 100 g
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className={styles["butter-freshness-note"]}>
              <span className={styles["butter-freshness-dot"]} aria-hidden="true" />
              Churned this week · keep refrigerated
            </p>

            {/* Quantity, Add to cart and Buy now */}
            <p className={styles["butter-section-label"]}>Quantity</p>
            <div className={styles["butter-buy-row"]}>
              <div className={styles["butter-quantity-control"]} role="group" aria-label="Number of packs">
                <button
                  type="button"
                  aria-label="One pack fewer"
                  className={styles["butter-quantity-minus-button"]}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className={styles["butter-quantity"]} aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One pack more"
                  className={styles["butter-quantity-plus-button"]}
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
              {/* key: "Added to cart" goes back to "Add to cart" when another pack is chosen */}
              <ButterCartButtons key={chosenPack.packId} pack={chosenPack} quantity={quantity} />
            </div>

            {/* Free delivery from ₹499: how much more to add, or that this order already has it */}
            <p className={styles["butter-free-delivery-note"]} aria-live="polite">
              {amountLeftForFreeDelivery > 0 ? (
                <>
                  Add <strong className={styles["butter-free-delivery-amount-left"]}>{formatRupees(amountLeftForFreeDelivery)} more</strong>{" "}
                  for free delivery
                </>
              ) : (
                <>
                  ✓ <strong>Free delivery</strong> on this order
                </>
              )}
            </p>
            <span className={styles["butter-free-delivery-track"]} aria-hidden="true">
              <span
                className={`${styles["butter-free-delivery-progress"]} ${
                  amountLeftForFreeDelivery === 0 ? styles["butter-free-delivery-progress-reached"] : ""
                }`}
                style={{ width: `${freeDeliveryProgressPercent}%` }}
              />
            </span>
          </div>
        </div>

        {/* Product information and Nutrition facts */}
        <div className={styles["butter-information-row"]}>
          <section className={styles["butter-product-information"]} aria-labelledby="butter-product-information-heading">
            <h2 id="butter-product-information-heading" className={styles["butter-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["butter-product-information-table"]}>
              {productInformation.map((row) => (
                <div key={row.label} className={styles["butter-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles["butter-nutrition-facts"]} aria-labelledby="butter-nutrition-facts-heading">
            <div className={styles["butter-nutrition-facts-header"]}>
              <h2 id="butter-nutrition-facts-heading">Nutrition facts</h2>
              <span>per 100 g (approx.)</span>
            </div>
            <dl className={styles["butter-nutrition-facts-list"]}>
              {nutritionFacts.map((row) => (
                <div key={row.label} className={styles["butter-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["butter-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
          </section>
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
            {fastSellingProducts.map((product) => (
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
