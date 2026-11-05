"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, rememberPendingCartProduct, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import styles from "./batter-product-page.module.css";

/*
  Idli & Dosa batter product page (/products/batter-powder, where the "Batter Powder" cards link), from the
  design. One-time purchase only, laid out like the ghee, paneer, butter and atta pages:
  - left: the Idli and Dosa pouches side by side on the landing hero's gold ring and green panel, a customer
    review and the "Order by 9 PM - Ground at 4 AM - At your door" steps; fixed under the navigation bar
    while the right side scrolls;
  - right: name, price of the chosen pack, pack sizes (500 g / 1 kg / 2 kg, each with about how many idlis
    it makes), quantity, Add to cart, Buy now, and how much more to add for free delivery (free from ₹499);
  - below: Product information, Nutrition facts and Fast selling products.
*/

type BatterPack = {
  packId: string;
  label: string; // "1 kg"
  price: number;
  originalPrice?: number; // crossed-out old price, only where the design shows one
  idliCount: number; // "About 20 idlis"
  isMostPopular?: boolean;
};

// Prices and idli counts from the design (change them here)
const batterPacks: BatterPack[] = [
  { packId: "500-g", label: "500 g", price: 59, idliCount: 10 },
  { packId: "1-kg", label: "1 kg", price: 99, originalPrice: 120, idliCount: 20, isMostPopular: true },
  { packId: "2-kg", label: "2 kg", price: 179, idliCount: 40 },
];

// Orders of this much or more get free delivery (design: "Add ₹400 more" on a ₹99 pack)
const freeDeliveryFromAmount = 499;

const batterName = "Idli & Dosa Batter";
// The two pouches sent, with their white backgrounds removed so the ring and green panel show around them,
// upscaled twice for sharp edges and text
const batterImages = [
  { imageSource: "/images/products/idli-batter-powder-pack.webp", imageWidth: 1808, imageHeight: 2744, alt: "Chiranvi Farm Idli batter powder pouch" },
  { imageSource: "/images/products/dosa-batter-powder-pack.webp", imageWidth: 1824, imageHeight: 2772, alt: "Chiranvi Farm Dosa batter powder pouch" },
];

// Each pack size is its own line in the cart (the cart shows the Idli pouch picture)
function toCartProduct(pack: BatterPack): CartProduct {
  const { imageSource, imageWidth, imageHeight } = batterImages[0];
  return {
    productId: `batter-powder-${pack.packId}`,
    name: batterName,
    imageSource,
    imageWidth,
    imageHeight,
    packSize: `${pack.label} pack`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
}

const productHighlights = ["Freshly Ground", "No soda", "Naturally Fermented", "No Added Preservatives"];

// Product information table from the design ([add address] and [add number] still to be filled in)
const productInformation = [
  { label: "Ingredients", value: "Rice, urad dal, methi seeds, salt" },
  { label: "Net quantity", value: "500 g / 1 kg / 2 kg" },
  { label: "Shelf life", value: "Best within 3 days" },
  { label: "Storage", value: "Refrigerate at 0 to 4 °C" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const nutritionFacts = [
  { label: "Energy", value: "120 kcal" },
  { label: "Protein", value: "4 g" },
  { label: "Total fat", value: "0.5 g" },
  { label: "Carbohydrate", value: "26 g" },
  { label: "Dietary fibre", value: "1.5 g" },
];

// Fast selling products: the design's five items (same row as the other product pages).
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
function BatterCartButtons({ pack, quantity }: { pack: BatterPack; quantity: number }) {
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
            className={styles[buttonLabel === "Add to cart" ? "batter-add-to-cart-button" : "batter-buy-now-button"]}
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
        className={styles["batter-add-to-cart-button"]}
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
        className={styles["batter-buy-now-button"]}
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["batter-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

export default function BatterProductPage() {
  const [chosenPackId, setChosenPackId] = useState("1-kg");
  const chosenPack = batterPacks.find((pack) => pack.packId === chosenPackId) ?? batterPacks[1];
  const [quantity, setQuantity] = useState(1);
  // Free delivery: the chosen pack × quantity against ₹499; the bar fills up as the order grows
  const orderAmount = chosenPack.price * quantity;
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryFromAmount - orderAmount);
  const freeDeliveryProgressPercent = Math.min(100, (orderAmount / freeDeliveryFromAmount) * 100);

  /*
    The left column (pouches, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const pouchesAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pouchesArea = pouchesAreaRef.current;
    if (!pouchesArea) return;
    const heightObserver = new ResizeObserver(() => {
      pouchesArea.style.setProperty("--batter-pouches-stage-height", `${pouchesArea.offsetHeight}px`);
    });
    heightObserver.observe(pouchesArea);
    return () => heightObserver.disconnect();
  }, []);

  return (
    <div className={styles["batter-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["batter-product-page-content"]}>
        <div className={styles["batter-product-columns"]}>
          {/* Left: pouches, review and delivery steps */}
          <div className={styles["batter-product-left-column"]}>
            <div ref={pouchesAreaRef} className={styles["batter-pouches-image-area"]}>
              {/* unoptimized: served as the sharp files they are (Next would re-compress them at quality 75) */}
              {batterImages.map((batterImage) => (
                <Image
                  key={batterImage.imageSource}
                  src={batterImage.imageSource}
                  alt={batterImage.alt}
                  width={batterImage.imageWidth}
                  height={batterImage.imageHeight}
                  unoptimized
                  priority
                  className={styles["batter-pouch-image"]}
                />
              ))}
            </div>

            <figure className={styles["batter-review-card"]}>
              <FiveStars className={styles["batter-review-stars"]} />
              <blockquote className={styles["batter-review-quote"]}>
                &ldquo;Soft idlis and crisp dosas, just like home. Saves me so much time on weekday mornings.&rdquo;
              </blockquote>
              <figcaption className={styles["batter-review-author"]}>
                <span className={styles["batter-review-author-name"]}>Lakshmi R.</span>
                <span className={styles["batter-review-author-area"]}>, Basavanagudi · </span>
                <span className={styles["batter-review-verified"]}>✓ Verified buyer</span>
              </figcaption>
            </figure>

            <ol className={styles["batter-delivery-steps-card"]} aria-label="How your batter reaches you">
              <li className={styles["batter-delivery-step"]}>
                <span className={styles["batter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["batter-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["batter-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["batter-delivery-step"]}>
                <span className={styles["batter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M4 10h16M10 14h4" />
                  </svg>
                </span>
                <span className={styles["batter-delivery-step-title"]}>Ground at 4 AM</span>
                <span className={styles["batter-delivery-step-detail"]}>Fresh batch</span>
              </li>
              <li className={styles["batter-delivery-step"]}>
                <span className={styles["batter-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["batter-delivery-step-title"]}>At your door</span>
                <span className={styles["batter-delivery-step-detail"]}>By 7 AM</span>
              </li>
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity, the buttons and free delivery */}
          <div className={styles["batter-product-right-column"]}>
            <span className={styles["batter-freshly-prepared-badge"]}>Freshly prepared</span>
            <h1 className={styles["batter-product-name"]}>{batterName}</h1>
            <p className={styles["batter-product-tagline"]}>Traditional Taste, Naturally Fermented</p>
            <p className={styles["batter-product-description"]}>
              Prepared with rice and urad dal, soaked, ground and naturally fermented for soft idlis and crispy golden
              dosas. Enjoy the comfort of traditional homemade breakfasts.
            </p>

            <p className={styles["batter-product-rating"]}>
              <FiveStars className={styles["batter-product-rating-stars"]} />
              <span className={styles["batter-product-rating-score"]}>4.8</span>
              <span className={styles["batter-product-rating-count"]}>(1.3K) ·</span>
              <span className={styles["batter-product-breakfasts-a-week"]}>1,500+ breakfasts a week</span>
            </p>

            <ul className={styles["batter-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["batter-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {/* Price of the chosen pack */}
            <p className={styles["batter-price-row"]}>
              <span className={styles["batter-price"]}>{formatRupees(chosenPack.price)}</span>
              <span className={styles["batter-price-unit"]}>/ {chosenPack.label}</span>
              {chosenPack.originalPrice && (
                <>
                  <s className={styles["batter-original-price"]}>
                    <span className={styles["batter-visually-hidden"]}>Was </span>
                    {formatRupees(chosenPack.originalPrice)}
                  </s>
                  <span className={styles["batter-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                </>
              )}
            </p>
            <p className={styles["batter-idli-count-note"]}>About {chosenPack.idliCount} idlis · incl. all taxes</p>

            {/* Choose Your Pack Size */}
            <fieldset className={styles["batter-pack-sizes"]}>
              <legend className={styles["batter-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["batter-pack-size-options"]}>
                {batterPacks.map((pack) => {
                  const isChosen = pack.packId === chosenPack.packId;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["batter-pack-size-option"]} ${isChosen ? styles["batter-pack-size-option-chosen"] : ""}`}
                    >
                      {pack.isMostPopular && <span className={styles["batter-most-popular-tag"]}>Most popular</span>}
                      <input
                        type="radio"
                        name="batter-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["batter-visually-hidden"]}
                      />
                      <span className={styles["batter-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["batter-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      <span className={styles["batter-pack-size-idli-count"]}>About {pack.idliCount} idlis</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className={styles["batter-freshness-note"]}>
              <span className={styles["batter-freshness-dot"]} aria-hidden="true" />
              Ground this morning · best within 3 days, refrigerated
            </p>

            {/* Quantity, Add to cart and Buy now */}
            <p className={styles["batter-section-label"]}>Quantity</p>
            <div className={styles["batter-buy-row"]}>
              <div className={styles["batter-quantity-control"]} role="group" aria-label="Number of packs">
                <button
                  type="button"
                  aria-label="One pack fewer"
                  className={styles["batter-quantity-minus-button"]}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className={styles["batter-quantity"]} aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One pack more"
                  className={styles["batter-quantity-plus-button"]}
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
              {/* key: "Added to cart" goes back to "Add to cart" when another pack is chosen */}
              <BatterCartButtons key={chosenPack.packId} pack={chosenPack} quantity={quantity} />
            </div>

            {/* Free delivery from ₹499: how much more to add, or that this order already has it */}
            <p className={styles["batter-free-delivery-note"]} aria-live="polite">
              {amountLeftForFreeDelivery > 0 ? (
                <>
                  Add <strong className={styles["batter-free-delivery-amount-left"]}>{formatRupees(amountLeftForFreeDelivery)} more</strong>{" "}
                  for free delivery
                </>
              ) : (
                <>
                  ✓ <strong>Free delivery</strong> on this order
                </>
              )}
            </p>
            <span className={styles["batter-free-delivery-track"]} aria-hidden="true">
              <span
                className={`${styles["batter-free-delivery-progress"]} ${
                  amountLeftForFreeDelivery === 0 ? styles["batter-free-delivery-progress-reached"] : ""
                }`}
                style={{ width: `${freeDeliveryProgressPercent}%` }}
              />
            </span>
          </div>
        </div>

        {/* Product information and Nutrition facts */}
        <div className={styles["batter-information-row"]}>
          <section className={styles["batter-product-information"]} aria-labelledby="batter-product-information-heading">
            <h2 id="batter-product-information-heading" className={styles["batter-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["batter-product-information-table"]}>
              {productInformation.map((row) => (
                <div key={row.label} className={styles["batter-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles["batter-nutrition-facts"]} aria-labelledby="batter-nutrition-facts-heading">
            <div className={styles["batter-nutrition-facts-header"]}>
              <h2 id="batter-nutrition-facts-heading">Nutrition facts</h2>
              <span>per 100 g (approx.)</span>
            </div>
            <dl className={styles["batter-nutrition-facts-list"]}>
              {nutritionFacts.map((row) => (
                <div key={row.label} className={styles["batter-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["batter-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
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
