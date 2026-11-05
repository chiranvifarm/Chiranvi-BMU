"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, rememberPendingCartProduct, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import styles from "./ghee-product-page.module.css";

/*
  Ghee product page (/products/a2-desi-ghee), from the design. One-time purchase only (no subscription):
  - left: the jar on the landing hero's gold ring and green panel, a customer review and the
    "Order by 9 PM - Packed fresh - At your door" steps; fixed under the navigation bar while the right
    side scrolls (same as the milk page);
  - right: name, price of the chosen pack, pack sizes (250 ml / 500 ml / 1 litre), quantity,
    Add to cart and Buy now;
  - below: Product information, Nutrition facts and Fast selling products.
*/

type GheePack = {
  packId: string;
  label: string; // "250 ml"
  millilitres: number;
  price: number;
  originalPrice?: number; // crossed-out old price, only where the design shows one
  isBestValue?: boolean;
};

// Prices from the design for now; the real prices will be sent later (change them here).
const gheePacks: GheePack[] = [
  { packId: "250-ml", label: "250 ml", millilitres: 250, price: 699 },
  { packId: "500-ml", label: "500 ml", millilitres: 500, price: 1299 },
  { packId: "1-litre", label: "1 litre", millilitres: 1000, price: 1399, originalPrice: 1799, isBestValue: true },
];

const gheeName = "A2 Desi Cow Ghee";
const gheeImage = { imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204 };

// Price per 100 ml, rounded to whole rupees (e.g. ₹1,399 for 1 litre → ₹140)
function pricePer100Millilitres(pack: GheePack) {
  return Math.round((pack.price / pack.millilitres) * 100);
}

// Each pack size is its own line in the cart
function toCartProduct(pack: GheePack): CartProduct {
  return {
    productId: `a2-desi-ghee-${pack.packId}`,
    name: gheeName,
    ...gheeImage,
    packSize: `${pack.label} glass jar`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
}

const productHighlights = ["Lab-tested", "Bilona method", "No preservatives", "Glass jar"];

// Product information table from the design ([add address] and [add number] still to be filled in)
const productInformation = [
  { label: "Ingredients", value: "Milk fat from A2 desi cow milk" },
  { label: "Net quantity", value: "250 ml / 500 ml / 1 litre" },
  { label: "Shelf life", value: "Best within 9 months" },
  { label: "Storage", value: "Keep at room temperature" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const nutritionFacts = [
  { label: "Energy", value: "897 kcal" },
  { label: "Protein", value: "0 g" },
  { label: "Total fat", value: "99.7 g" },
  { label: "Saturated fat", value: "61 g" },
  { label: "Carbohydrate", value: "0 g" },
];

// Fast selling products: the design's five items (same as the milk page's one-time row).
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
  - not logged in: both go to the login with one jar of the chosen pack remembered (the login adds it
    and comes back here).
*/
function GheeCartButtons({ pack, quantity }: { pack: GheePack; quantity: number }) {
  const isLoggedIn = useIsLoggedIn();
  const router = useRouter();
  const [isAdded, setIsAdded] = useState(false);

  function addChosenPackToCart() {
    for (let jarNumber = 0; jarNumber < quantity; jarNumber++) addProductToCart(toCartProduct(pack));
  }

  if (!isLoggedIn) {
    return (
      <>
        {(["Add to cart", "Buy now"] as const).map((buttonLabel) => (
          <Link
            key={buttonLabel}
            href="/login"
            className={styles[buttonLabel === "Add to cart" ? "ghee-add-to-cart-button" : "ghee-buy-now-button"]}
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
        className={styles["ghee-add-to-cart-button"]}
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
        className={styles["ghee-buy-now-button"]}
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["ghee-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

export default function GheeProductPage() {
  const [chosenPackId, setChosenPackId] = useState("1-litre");
  const chosenPack = gheePacks.find((pack) => pack.packId === chosenPackId) ?? gheePacks[2];
  const [quantity, setQuantity] = useState(1);

  /*
    The left column (jar, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the jar area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the jar area's height is kept up to date here.
  */
  const jarAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const jarArea = jarAreaRef.current;
    if (!jarArea) return;
    const heightObserver = new ResizeObserver(() => {
      jarArea.style.setProperty("--ghee-jar-stage-height", `${jarArea.offsetHeight}px`);
    });
    heightObserver.observe(jarArea);
    return () => heightObserver.disconnect();
  }, []);

  return (
    <div className={styles["ghee-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["ghee-product-page-content"]}>
        <div className={styles["ghee-product-columns"]}>
          {/* Left: jar, review and delivery steps */}
          <div className={styles["ghee-product-left-column"]}>
            <div ref={jarAreaRef} className={styles["ghee-jar-image-area"]}>
              <Image
                src={gheeImage.imageSource}
                alt="Chiranvi Farms Desi Ghee in a glass jar"
                width={gheeImage.imageWidth}
                height={gheeImage.imageHeight}
                sizes="(max-width: 800px) 60vw, 360px"
                priority
                className={styles["ghee-jar-image"]}
              />
            </div>

            <figure className={styles["ghee-review-card"]}>
              <FiveStars className={styles["ghee-review-stars"]} />
              <blockquote className={styles["ghee-review-quote"]}>
                &ldquo;Smells exactly like the ghee my mother made. Lovely grainy texture, and it lasts us a whole
                month.&rdquo;
              </blockquote>
              <figcaption className={styles["ghee-review-author"]}>
                <span className={styles["ghee-review-author-name"]}>Priya R.</span>
                <span className={styles["ghee-review-author-area"]}>, Jayanagar · </span>
                <span className={styles["ghee-review-verified"]}>✓ Verified buyer</span>
              </figcaption>
            </figure>

            <ol className={styles["ghee-delivery-steps-card"]} aria-label="How your ghee reaches you">
              <li className={styles["ghee-delivery-step"]}>
                <span className={styles["ghee-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["ghee-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["ghee-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["ghee-delivery-step"]}>
                <span className={styles["ghee-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M4 10h16M10 14h4" />
                  </svg>
                </span>
                <span className={styles["ghee-delivery-step-title"]}>Packed fresh</span>
                <span className={styles["ghee-delivery-step-detail"]}>From this week&rsquo;s batch</span>
              </li>
              <li className={styles["ghee-delivery-step"]}>
                <span className={styles["ghee-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["ghee-delivery-step-title"]}>At your door</span>
                <span className={styles["ghee-delivery-step-detail"]}>By 7 AM</span>
              </li>
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity and the buttons */}
          <div className={styles["ghee-product-right-column"]}>
            <span className={styles["ghee-farm-favourite-badge"]}>Farm favourite</span>
            <h1 className={styles["ghee-product-name"]}>{gheeName}</h1>
            <p className={styles["ghee-product-tagline"]}>Traditional Bilona Ghee, Golden &amp; Pure</p>
            <p className={styles["ghee-product-description"]}>
              Made from desi cow curd using the traditional bilona method, our ghee is slowly heated to develop its
              rich aroma, golden colour and authentic taste. A wholesome touch for everyday cooking and traditional
              recipes.
            </p>

            <p className={styles["ghee-product-rating"]}>
              <FiveStars className={styles["ghee-product-rating-stars"]} />
              <span className={styles["ghee-product-rating-score"]}>4.8</span>
              <span className={styles["ghee-product-rating-count"]}>(1.5K) ·</span>
              <span className={styles["ghee-product-crafted"]}>Crafted with care</span>
            </p>

            <ul className={styles["ghee-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["ghee-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {/* Price of the chosen pack */}
            <p className={styles["ghee-price-row"]}>
              <span className={styles["ghee-price"]}>{formatRupees(chosenPack.price)}</span>
              <span className={styles["ghee-price-unit"]}>/ {chosenPack.label}</span>
              {chosenPack.originalPrice && (
                <>
                  <s className={styles["ghee-original-price"]}>
                    <span className={styles["ghee-visually-hidden"]}>Was </span>
                    {formatRupees(chosenPack.originalPrice)}
                  </s>
                  <span className={styles["ghee-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                </>
              )}
            </p>
            <p className={styles["ghee-price-per-100-ml"]}>
              ₹{pricePer100Millilitres(chosenPack)} per 100 ml · incl. all taxes
            </p>

            {/* Choose Your Pack Size */}
            <fieldset className={styles["ghee-pack-sizes"]}>
              <legend className={styles["ghee-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["ghee-pack-size-options"]}>
                {gheePacks.map((pack) => {
                  const isChosen = pack.packId === chosenPack.packId;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["ghee-pack-size-option"]} ${isChosen ? styles["ghee-pack-size-option-chosen"] : ""}`}
                    >
                      {pack.isBestValue && <span className={styles["ghee-best-value-tag"]}>Best value</span>}
                      <input
                        type="radio"
                        name="ghee-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["ghee-visually-hidden"]}
                      />
                      <span className={styles["ghee-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["ghee-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      <span className={styles["ghee-pack-size-per-100-ml"]}>₹{pricePer100Millilitres(pack)} / 100 ml</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className={styles["ghee-stock-note"]}>Only 18 jars left in Batch #4542</p>

            {/* Quantity, Add to cart and Buy now */}
            <p className={styles["ghee-section-label"]}>Quantity</p>
            <div className={styles["ghee-buy-row"]}>
              <div className={styles["ghee-quantity-control"]} role="group" aria-label="Number of jars">
                <button
                  type="button"
                  aria-label="One jar fewer"
                  className={styles["ghee-quantity-minus-button"]}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className={styles["ghee-quantity"]} aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One jar more"
                  className={styles["ghee-quantity-plus-button"]}
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
              {/* key: "Added to cart" goes back to "Add to cart" when another pack is chosen */}
              <GheeCartButtons key={chosenPack.packId} pack={chosenPack} quantity={quantity} />
            </div>

            <p className={styles["ghee-free-delivery-note"]}>
              ✓ <strong>Free delivery</strong> on this order
            </p>
            <span className={styles["ghee-free-delivery-bar"]} aria-hidden="true" />
          </div>
        </div>

        {/* Product information and Nutrition facts */}
        <div className={styles["ghee-information-row"]}>
          <section className={styles["ghee-product-information"]} aria-labelledby="ghee-product-information-heading">
            <h2 id="ghee-product-information-heading" className={styles["ghee-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["ghee-product-information-table"]}>
              {productInformation.map((row) => (
                <div key={row.label} className={styles["ghee-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles["ghee-nutrition-facts"]} aria-labelledby="ghee-nutrition-facts-heading">
            <div className={styles["ghee-nutrition-facts-header"]}>
              <h2 id="ghee-nutrition-facts-heading">Nutrition facts</h2>
              <span>per 100 g (approx.)</span>
            </div>
            <dl className={styles["ghee-nutrition-facts-list"]}>
              {nutritionFacts.map((row) => (
                <div key={row.label} className={styles["ghee-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["ghee-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
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
