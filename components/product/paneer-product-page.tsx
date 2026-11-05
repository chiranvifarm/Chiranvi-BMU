"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, rememberPendingCartProduct, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import styles from "./paneer-product-page.module.css";

/*
  Paneer product page (/products/fresh-cow-paneer), from the design. One-time purchase only, laid out like
  the ghee page:
  - left: the paneer box on the landing hero's gold ring and green panel, a customer review and the
    "Order by 9 PM - Made at 4 AM - At your door" steps; fixed under the navigation bar while the right
    side scrolls;
  - right: name, price of the chosen pack, pack sizes (200 g / 500 g / 1 kg), quantity, Add to cart,
    Buy now, and how much more to add for free delivery (free from ₹499);
  - below: Product information, Nutrition facts and Fast selling products.
*/

type PaneerPack = {
  packId: string;
  label: string; // "500 g"
  grams: number;
  price: number;
  originalPrice?: number; // crossed-out old price, only where the design shows one
  isMostPopular?: boolean;
};

// Prices from the design (change them here)
const paneerPacks: PaneerPack[] = [
  { packId: "200-g", label: "200 g", grams: 200, price: 149 },
  { packId: "500-g", label: "500 g", grams: 500, price: 349, originalPrice: 399, isMostPopular: true },
  { packId: "1-kg", label: "1 kg", grams: 1000, price: 649 },
];

// Orders of this much or more get free delivery (design: "Add ₹150 more" on a ₹349 pack)
const freeDeliveryFromAmount = 499;

const paneerName = "A2 Desi Paneer";
// Upscaled twice (lanczos + light sharpen) so the label text stays crisp at the large size
const paneerImage = { imageSource: "/images/products/a2-desi-gir-paneer-box.webp", imageWidth: 3712, imageHeight: 2728 };

// Price per 100 g: exact with paise under the price (₹69.80), and to the nearest 50 paise on the pack
// cards like the design (₹74.5, ₹70, ₹65)
function pricePer100Grams(pack: PaneerPack) {
  return (pack.price / pack.grams) * 100;
}

function formatPricePer100GramsExact(pack: PaneerPack) {
  return pricePer100Grams(pack).toFixed(2);
}

function formatPricePer100GramsShort(pack: PaneerPack) {
  return String(Math.round(pricePer100Grams(pack) * 2) / 2);
}

// Each pack size is its own line in the cart
function toCartProduct(pack: PaneerPack): CartProduct {
  return {
    productId: `fresh-cow-paneer-${pack.packId}`,
    name: paneerName,
    ...paneerImage,
    packSize: `${pack.label} pack`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
}

const productHighlights = ["Freshly Made", "Rich & Creamy", "No starch", "A2 Cow Milk"];

// Product information table from the design ([add address] and [add number] still to be filled in)
const productInformation = [
  { label: "Ingredients", value: "Cow milk, citric acid" },
  { label: "Net quantity", value: "200 g / 500 g / 1 kg" },
  { label: "Shelf life", value: "Best within 3 days" },
  { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const nutritionFacts = [
  { label: "Energy", value: "265 kcal" },
  { label: "Protein", value: "18 g" },
  { label: "Total fat", value: "20 g" },
  { label: "Carbohydrate", value: "3.4 g" },
  { label: "Calcium", value: "208 mg" },
];

// Fast selling products: the design's five items (same row as the ghee page).
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
function PaneerCartButtons({ pack, quantity }: { pack: PaneerPack; quantity: number }) {
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
            className={styles[buttonLabel === "Add to cart" ? "paneer-add-to-cart-button" : "paneer-buy-now-button"]}
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
        className={styles["paneer-add-to-cart-button"]}
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
        className={styles["paneer-buy-now-button"]}
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["paneer-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

export default function PaneerProductPage() {
  const [chosenPackId, setChosenPackId] = useState("500-g");
  const chosenPack = paneerPacks.find((pack) => pack.packId === chosenPackId) ?? paneerPacks[1];
  const [quantity, setQuantity] = useState(1);
  // Free delivery: the chosen pack × quantity against ₹499; the bar fills up as the order grows
  const orderAmount = chosenPack.price * quantity;
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryFromAmount - orderAmount);
  const freeDeliveryProgressPercent = Math.min(100, (orderAmount / freeDeliveryFromAmount) * 100);

  /*
    The left column (box, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const boxAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const boxArea = boxAreaRef.current;
    if (!boxArea) return;
    const heightObserver = new ResizeObserver(() => {
      boxArea.style.setProperty("--paneer-box-stage-height", `${boxArea.offsetHeight}px`);
    });
    heightObserver.observe(boxArea);
    return () => heightObserver.disconnect();
  }, []);

  return (
    <div className={styles["paneer-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["paneer-product-page-content"]}>
        <div className={styles["paneer-product-columns"]}>
          {/* Left: box, review and delivery steps */}
          <div className={styles["paneer-product-left-column"]}>
            <div ref={boxAreaRef} className={styles["paneer-box-image-area"]}>
              {/* unoptimized: served as the sharp, upscaled file it is (Next would re-compress it at quality 75) */}
              <Image
                src={paneerImage.imageSource}
                alt="Chiranvi Farm fresh and natural paneer box"
                width={paneerImage.imageWidth}
                height={paneerImage.imageHeight}
                unoptimized
                priority
                className={styles["paneer-box-image"]}
              />
            </div>

            <figure className={styles["paneer-review-card"]}>
              <FiveStars className={styles["paneer-review-stars"]} />
              <blockquote className={styles["paneer-review-quote"]}>
                &ldquo;So soft it melts in the gravy. My kids won&rsquo;t eat packet paneer any more.&rdquo;
              </blockquote>
              <figcaption className={styles["paneer-review-author"]}>
                <span className={styles["paneer-review-author-name"]}>Arjun K.</span>
                <span className={styles["paneer-review-author-area"]}>, Whitefield · </span>
                <span className={styles["paneer-review-verified"]}>✓ Verified buyer</span>
              </figcaption>
            </figure>

            <ol className={styles["paneer-delivery-steps-card"]} aria-label="How your paneer reaches you">
              <li className={styles["paneer-delivery-step"]}>
                <span className={styles["paneer-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["paneer-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["paneer-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["paneer-delivery-step"]}>
                <span className={styles["paneer-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M4 10h16M10 14h4" />
                  </svg>
                </span>
                <span className={styles["paneer-delivery-step-title"]}>Made at 4 AM</span>
                <span className={styles["paneer-delivery-step-detail"]}>From fresh milk</span>
              </li>
              <li className={styles["paneer-delivery-step"]}>
                <span className={styles["paneer-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["paneer-delivery-step-title"]}>At your door</span>
                <span className={styles["paneer-delivery-step-detail"]}>By 7 AM</span>
              </li>
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity, the buttons and free delivery */}
          <div className={styles["paneer-product-right-column"]}>
            <span className={styles["paneer-fresh-daily-badge"]}>Fresh daily</span>
            <h1 className={styles["paneer-product-name"]}>{paneerName}</h1>
            <p className={styles["paneer-product-tagline"]}>Soft, Creamy &amp; Made Fresh</p>
            <p className={styles["paneer-product-description"]}>
              Made from fresh A2 cow milk, our soft and creamy paneer brings natural goodness and authentic taste to
              your everyday meals. No added starch, no fillers, just wholesome dairy goodness.
            </p>

            <p className={styles["paneer-product-rating"]}>
              <FiveStars className={styles["paneer-product-rating-stars"]} />
              <span className={styles["paneer-product-rating-score"]}>4.7</span>
              <span className={styles["paneer-product-rating-count"]}>1.2K ·</span>
              <span className={styles["paneer-product-farm-fresh"]}>Farm Fresh</span>
            </p>

            <ul className={styles["paneer-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["paneer-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {/* Price of the chosen pack */}
            <p className={styles["paneer-price-row"]}>
              <span className={styles["paneer-price"]}>{formatRupees(chosenPack.price)}</span>
              <span className={styles["paneer-price-unit"]}>/ {chosenPack.label}</span>
              {chosenPack.originalPrice && (
                <>
                  <s className={styles["paneer-original-price"]}>
                    <span className={styles["paneer-visually-hidden"]}>Was </span>
                    {formatRupees(chosenPack.originalPrice)}
                  </s>
                  <span className={styles["paneer-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                </>
              )}
            </p>
            <p className={styles["paneer-price-per-100-g"]}>
              ₹{formatPricePer100GramsExact(chosenPack)} per 100 g · Inclusive of all taxes
            </p>

            {/* Choose Your Pack Size */}
            <fieldset className={styles["paneer-pack-sizes"]}>
              <legend className={styles["paneer-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["paneer-pack-size-options"]}>
                {paneerPacks.map((pack) => {
                  const isChosen = pack.packId === chosenPack.packId;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["paneer-pack-size-option"]} ${isChosen ? styles["paneer-pack-size-option-chosen"] : ""}`}
                    >
                      {pack.isMostPopular && <span className={styles["paneer-most-popular-tag"]}>Most popular</span>}
                      <input
                        type="radio"
                        name="paneer-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["paneer-visually-hidden"]}
                      />
                      <span className={styles["paneer-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["paneer-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      <span className={styles["paneer-pack-size-per-100-g"]}>
                        ₹{formatPricePer100GramsShort(pack)} / 100 g
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className={styles["paneer-freshness-note"]}>
              <span className={styles["paneer-freshness-dot"]} aria-hidden="true" />
              Freshly prepared · Delivered chilled
            </p>

            {/* Quantity, Add to cart and Buy now */}
            <p className={styles["paneer-section-label"]}>Quantity</p>
            <div className={styles["paneer-buy-row"]}>
              <div className={styles["paneer-quantity-control"]} role="group" aria-label="Number of packs">
                <button
                  type="button"
                  aria-label="One pack fewer"
                  className={styles["paneer-quantity-minus-button"]}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className={styles["paneer-quantity"]} aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One pack more"
                  className={styles["paneer-quantity-plus-button"]}
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
              {/* key: "Added to cart" goes back to "Add to cart" when another pack is chosen */}
              <PaneerCartButtons key={chosenPack.packId} pack={chosenPack} quantity={quantity} />
            </div>

            {/* Free delivery from ₹499: how much more to add, or that this order already has it */}
            <p className={styles["paneer-free-delivery-note"]} aria-live="polite">
              {amountLeftForFreeDelivery > 0 ? (
                <>
                  Add <strong className={styles["paneer-free-delivery-amount-left"]}>{formatRupees(amountLeftForFreeDelivery)} more</strong>{" "}
                  for free delivery
                </>
              ) : (
                <>
                  ✓ <strong>Free delivery</strong> on this order
                </>
              )}
            </p>
            <span className={styles["paneer-free-delivery-track"]} aria-hidden="true">
              <span
                className={`${styles["paneer-free-delivery-progress"]} ${
                  amountLeftForFreeDelivery === 0 ? styles["paneer-free-delivery-progress-reached"] : ""
                }`}
                style={{ width: `${freeDeliveryProgressPercent}%` }}
              />
            </span>
          </div>
        </div>

        {/* Product information and Nutrition facts */}
        <div className={styles["paneer-information-row"]}>
          <section className={styles["paneer-product-information"]} aria-labelledby="paneer-product-information-heading">
            <h2 id="paneer-product-information-heading" className={styles["paneer-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["paneer-product-information-table"]}>
              {productInformation.map((row) => (
                <div key={row.label} className={styles["paneer-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles["paneer-nutrition-facts"]} aria-labelledby="paneer-nutrition-facts-heading">
            <div className={styles["paneer-nutrition-facts-header"]}>
              <h2 id="paneer-nutrition-facts-heading">Nutrition facts</h2>
              <span>per 100 g (approx.)</span>
            </div>
            <dl className={styles["paneer-nutrition-facts-list"]}>
              {nutritionFacts.map((row) => (
                <div key={row.label} className={styles["paneer-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["paneer-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
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
