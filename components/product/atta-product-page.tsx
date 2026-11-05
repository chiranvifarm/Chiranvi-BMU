"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsLoggedIn } from "@/components/login/login-status";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { addProductToCart, rememberPendingCartProduct, type CartProduct } from "@/store/cart-store";
import { getDiscountPercent } from "@/store/products-store";
import styles from "./atta-product-page.module.css";

/*
  Whole wheat atta product page (/products/whole-wheat-atta), from the design. One-time purchase only, laid
  out like the ghee, paneer and butter pages:
  - left: the atta pack on the landing hero's gold ring and green panel, a customer review and the
    "Order by 9 PM - Milled fresh - At your door" steps; fixed under the navigation bar while the right
    side scrolls;
  - right: name, price of the chosen pack, pack sizes (1 kg / 2 kg / 5 kg, priced per kg), quantity,
    Add to cart, Buy now, and how much more to add for free delivery (free from ₹499);
  - below: Product information, Nutrition facts and Fast selling products.
*/

type AttaPack = {
  packId: string;
  label: string; // "5 kg"
  kilograms: number;
  price: number;
  originalPrice?: number; // crossed-out old price, only where the design shows one
  isBestValue?: boolean;
};

// Prices from the design (change them here)
const attaPacks: AttaPack[] = [
  { packId: "1-kg", label: "1 kg", kilograms: 1, price: 79 },
  { packId: "2-kg", label: "2 kg", kilograms: 2, price: 149 },
  { packId: "5-kg", label: "5 kg", kilograms: 5, price: 329, originalPrice: 399, isBestValue: true },
];

// Orders of this much or more get free delivery (design: "Add ₹170 more" on a ₹329 pack)
const freeDeliveryFromAmount = 499;

const attaName = "Whole Wheat Atta";
// The picture sent, with its white background removed so the ring and green panel show around it
const attaImage = { imageSource: "/images/products/whole-wheat-atta-pack.webp", imageWidth: 1984, imageHeight: 1806 };

// Price per kg: exact with paise under the price (₹65.80), whole rupees on the pack cards like the
// design (₹79, ₹75, ₹66)
function pricePerKilogram(pack: AttaPack) {
  return pack.price / pack.kilograms;
}

// Each pack size is its own line in the cart
function toCartProduct(pack: AttaPack): CartProduct {
  return {
    productId: `whole-wheat-atta-${pack.packId}`,
    name: attaName,
    ...attaImage,
    packSize: `${pack.label} pouch`,
    price: pack.price,
    // The cart always shows an old price; without one it is the same as the price
    originalPrice: pack.originalPrice ?? pack.price,
  };
}

const productHighlights = ["Stone-ground", "100% whole wheat", "No maida", "Lab-tested"];

// Product information table from the design ([add address] and [add number] still to be filled in)
const productInformation = [
  { label: "Ingredients", value: "100% whole wheat" },
  { label: "Net quantity", value: "1 kg / 2 kg / 5 kg" },
  { label: "Shelf life", value: "Best within 3 months" },
  { label: "Storage", value: "Cool, dry place" },
  { label: "Country of origin", value: "India" },
  { label: "Manufactured by", value: "Chiranvi Farm, [add address]" },
  { label: "FSSAI Lic. No.", value: "[add number]" },
];

const nutritionFacts = [
  { label: "Energy", value: "340 kcal" },
  { label: "Protein", value: "12 g" },
  { label: "Total fat", value: "1.7 g" },
  { label: "Carbohydrate", value: "72 g" },
  { label: "Dietary fibre", value: "11 g" },
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
function AttaCartButtons({ pack, quantity }: { pack: AttaPack; quantity: number }) {
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
            className={styles[buttonLabel === "Add to cart" ? "atta-add-to-cart-button" : "atta-buy-now-button"]}
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
        className={styles["atta-add-to-cart-button"]}
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
        className={styles["atta-buy-now-button"]}
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["atta-add-to-cart-icon"]}>
      <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </svg>
  );
}

export default function AttaProductPage() {
  const [chosenPackId, setChosenPackId] = useState("5-kg");
  const chosenPack = attaPacks.find((pack) => pack.packId === chosenPackId) ?? attaPacks[2];
  const [quantity, setQuantity] = useState(1);
  // Free delivery: the chosen pack × quantity against ₹499; the bar fills up as the order grows
  const orderAmount = chosenPack.price * quantity;
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryFromAmount - orderAmount);
  const freeDeliveryProgressPercent = Math.min(100, (orderAmount / freeDeliveryFromAmount) * 100);

  /*
    The left column (pack, review, delivery steps) is fixed under the navigation bar and fits the screen
    height, so only the right side scrolls; the picture area takes whatever height is left (see the CSS).
    Its gold ring is sized from that height, so the picture area's height is kept up to date here.
  */
  const packAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const packArea = packAreaRef.current;
    if (!packArea) return;
    const heightObserver = new ResizeObserver(() => {
      packArea.style.setProperty("--atta-pack-stage-height", `${packArea.offsetHeight}px`);
    });
    heightObserver.observe(packArea);
    return () => heightObserver.disconnect();
  }, []);

  return (
    <div className={styles["atta-product-page"]}>
      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <main className={styles["atta-product-page-content"]}>
        <div className={styles["atta-product-columns"]}>
          {/* Left: pack, review and delivery steps */}
          <div className={styles["atta-product-left-column"]}>
            <div ref={packAreaRef} className={styles["atta-pack-image-area"]}>
              <Image
                src={attaImage.imageSource}
                alt="Chiranvi Farm whole wheat atta pouch with a bowl of flour and wheat"
                width={attaImage.imageWidth}
                height={attaImage.imageHeight}
                sizes="(max-width: 800px) 80vw, 480px"
                priority
                className={styles["atta-pack-image"]}
              />
            </div>

            <figure className={styles["atta-review-card"]}>
              <FiveStars className={styles["atta-review-stars"]} />
              <blockquote className={styles["atta-review-quote"]}>
                &ldquo;Rotis stay soft even in the lunch box. You can smell the fresh wheat when you open the
                pack.&rdquo;
              </blockquote>
              <figcaption className={styles["atta-review-author"]}>
                <span className={styles["atta-review-author-name"]}>Kavya P.</span>
                <span className={styles["atta-review-author-area"]}>, Malleshwaram · </span>
                <span className={styles["atta-review-verified"]}>✓ Verified buyer</span>
              </figcaption>
            </figure>

            <ol className={styles["atta-delivery-steps-card"]} aria-label="How your atta reaches you">
              <li className={styles["atta-delivery-step"]}>
                <span className={styles["atta-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </span>
                <span className={styles["atta-delivery-step-title"]}>Order by 9 PM</span>
                <span className={styles["atta-delivery-step-detail"]}>Tonight</span>
              </li>
              <li className={styles["atta-delivery-step"]}>
                <span className={styles["atta-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="M4 10h16M10 14h4" />
                  </svg>
                </span>
                <span className={styles["atta-delivery-step-title"]}>Milled fresh</span>
                <span className={styles["atta-delivery-step-detail"]}>This week&rsquo;s batch</span>
              </li>
              <li className={styles["atta-delivery-step"]}>
                <span className={styles["atta-delivery-step-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5L12 4l8 6.5V20H4z" />
                    <path d="M10 20v-5h4v5" />
                  </svg>
                </span>
                <span className={styles["atta-delivery-step-title"]}>At your door</span>
                <span className={styles["atta-delivery-step-detail"]}>By tomorrow</span>
              </li>
            </ol>
          </div>

          {/* Right: details, price, pack sizes, quantity, the buttons and free delivery */}
          <div className={styles["atta-product-right-column"]}>
            <span className={styles["atta-fresh-from-the-chakki-badge"]}>Fresh from the chakki</span>
            <h1 className={styles["atta-product-name"]}>{attaName}</h1>
            <p className={styles["atta-product-tagline"]}>Traditional Chakki-Ground Goodness</p>
            <p className={styles["atta-product-description"]}>
              Made from carefully selected whole wheat grains and traditionally stone-ground to retain their natural
              goodness. Enjoy soft rotis, fluffy chapatis and delicious homemade parathas with wholesome flavour in
              every bite.
            </p>

            <p className={styles["atta-product-rating"]}>
              <FiveStars className={styles["atta-product-rating-stars"]} />
              <span className={styles["atta-product-rating-score"]}>4.7</span>
              <span className={styles["atta-product-rating-count"]}>(2.4K) ·</span>
              <span className={styles["atta-product-freshly-milled"]}>Freshly Milled</span>
            </p>

            <ul className={styles["atta-product-highlights"]}>
              {productHighlights.map((highlight) => (
                <li key={highlight} className={styles["atta-product-highlight"]}>
                  ✓ {highlight}
                </li>
              ))}
            </ul>

            {/* Price of the chosen pack */}
            <p className={styles["atta-price-row"]}>
              <span className={styles["atta-price"]}>{formatRupees(chosenPack.price)}</span>
              <span className={styles["atta-price-unit"]}>/ {chosenPack.label}</span>
              {chosenPack.originalPrice && (
                <>
                  <s className={styles["atta-original-price"]}>
                    <span className={styles["atta-visually-hidden"]}>Was </span>
                    {formatRupees(chosenPack.originalPrice)}
                  </s>
                  <span className={styles["atta-save-badge"]}>Save {getDiscountPercent(chosenPack)}%</span>
                </>
              )}
            </p>
            <p className={styles["atta-price-per-kg"]}>
              ₹{pricePerKilogram(chosenPack).toFixed(2)} per kg · Inclusive of all taxes
            </p>

            {/* Choose Your Pack Size */}
            <fieldset className={styles["atta-pack-sizes"]}>
              <legend className={styles["atta-section-label"]}>Choose Your Pack Size</legend>
              <div className={styles["atta-pack-size-options"]}>
                {attaPacks.map((pack) => {
                  const isChosen = pack.packId === chosenPack.packId;
                  return (
                    <label
                      key={pack.packId}
                      className={`${styles["atta-pack-size-option"]} ${isChosen ? styles["atta-pack-size-option-chosen"] : ""}`}
                    >
                      {pack.isBestValue && <span className={styles["atta-best-value-tag"]}>Best value</span>}
                      <input
                        type="radio"
                        name="atta-pack-size"
                        value={pack.packId}
                        checked={isChosen}
                        onChange={() => setChosenPackId(pack.packId)}
                        className={styles["atta-visually-hidden"]}
                      />
                      <span className={styles["atta-pack-size-label"]}>{pack.label}</span>
                      <span className={styles["atta-pack-size-price"]}>{formatRupees(pack.price)}</span>
                      <span className={styles["atta-pack-size-per-kg"]}>₹{Math.round(pricePerKilogram(pack))} / kg</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className={styles["atta-freshness-note"]}>
              <span className={styles["atta-freshness-dot"]} aria-hidden="true" />
              Milled this week · resealable zip pouch
            </p>

            {/* Quantity, Add to cart and Buy now */}
            <p className={styles["atta-section-label"]}>Quantity</p>
            <div className={styles["atta-buy-row"]}>
              <div className={styles["atta-quantity-control"]} role="group" aria-label="Number of packs">
                <button
                  type="button"
                  aria-label="One pack fewer"
                  className={styles["atta-quantity-minus-button"]}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  disabled={quantity === 1}
                >
                  −
                </button>
                <span className={styles["atta-quantity"]} aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="One pack more"
                  className={styles["atta-quantity-plus-button"]}
                  onClick={() => setQuantity((current) => current + 1)}
                >
                  +
                </button>
              </div>
              {/* key: "Added to cart" goes back to "Add to cart" when another pack is chosen */}
              <AttaCartButtons key={chosenPack.packId} pack={chosenPack} quantity={quantity} />
            </div>

            {/* Free delivery from ₹499: how much more to add, or that this order already has it */}
            <p className={styles["atta-free-delivery-note"]} aria-live="polite">
              {amountLeftForFreeDelivery > 0 ? (
                <>
                  Add <strong className={styles["atta-free-delivery-amount-left"]}>{formatRupees(amountLeftForFreeDelivery)} more</strong>{" "}
                  for free delivery
                </>
              ) : (
                <>
                  ✓ <strong>Free delivery</strong> on this order
                </>
              )}
            </p>
            <span className={styles["atta-free-delivery-track"]} aria-hidden="true">
              <span
                className={`${styles["atta-free-delivery-progress"]} ${
                  amountLeftForFreeDelivery === 0 ? styles["atta-free-delivery-progress-reached"] : ""
                }`}
                style={{ width: `${freeDeliveryProgressPercent}%` }}
              />
            </span>
          </div>
        </div>

        {/* Product information and Nutrition facts */}
        <div className={styles["atta-information-row"]}>
          <section className={styles["atta-product-information"]} aria-labelledby="atta-product-information-heading">
            <h2 id="atta-product-information-heading" className={styles["atta-information-heading"]}>
              Product information
            </h2>
            <dl className={styles["atta-product-information-table"]}>
              {productInformation.map((row) => (
                <div key={row.label} className={styles["atta-product-information-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles["atta-nutrition-facts"]} aria-labelledby="atta-nutrition-facts-heading">
            <div className={styles["atta-nutrition-facts-header"]}>
              <h2 id="atta-nutrition-facts-heading">Nutrition facts</h2>
              <span>per 100 g (approx.)</span>
            </div>
            <dl className={styles["atta-nutrition-facts-list"]}>
              {nutritionFacts.map((row) => (
                <div key={row.label} className={styles["atta-nutrition-facts-row"]}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles["atta-nutrition-facts-note"]}>Values are indicative. Refer to the pack label.</p>
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
