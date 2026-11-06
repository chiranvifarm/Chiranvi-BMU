"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProductCardTile, useProductCards, type ProductCard } from "@/components/product/all-products-page";
import { useAutoProductRows, useProductRows } from "@/store/admin-product-rows-store";
import { isAvailableToOrder, useShopProducts } from "@/store/products-store";
import styles from "./best-sellers-section.module.css";

/*
  Landing page section below Shop By Category: "Best Sellers" heading and six product cards.
  Which products, and in what order, is set in the Chiranvi Panel (store/products-store.ts: marked for Best
  Sellers); each is shown with the same card as the All products page (components/product/all-products-page.tsx):
  picture with tag and heart, name, pack, rating, price with the old price crossed out, and
  - milk: "View product" (subscription or one-time is chosen on its page);
  - others: ADD → "− n +";
  - switched off or out of stock in the panel: "Out of stock" on the picture and Notify me.
  Clicking anywhere else on a card opens the product page.
  Scroll reveal: when the section scrolls into view, the heading and all the cards fade and
  slide up together.
*/

// The section always shows this many cards (one full row in the design)
const BEST_SELLERS_COUNT = 6;

/*
  The Best Sellers cards: the panel's Best Sellers, in its order, as product cards. When fewer than six are
  marked (or a marked product is no longer sold), other products fill the row: first from categories not
  shown yet (so the row is not all milk), in the All products page's order.
  Automatic on (Products & pricing → Product rows): the most ordered products of the last 30 days instead.
*/
function useBestSellerCards(): ProductCard[] {
  const productCards = useProductCards();
  const isAutomatic = useProductRows().isAutomatic;
  const autoBestSellers = useAutoProductRows().bestSellers;
  const handPickedCards = useShopProducts()
    .filter((product) => product.showOnBestSellers)
    .sort((first, second) => (first.bestSellerOrder ?? 99) - (second.bestSellerOrder ?? 99))
    .flatMap((product) => {
      const card = productCards.find((productCard) => productCard.slug === product.productId);
      // Switched off or out of stock in the panel: shown as out of stock here too
      return card ? [{ ...card, isSoldOut: card.isSoldOut || !isAvailableToOrder(product) }] : [];
    });
  const autoCards = autoBestSellers.flatMap((slug) => productCards.filter((card) => card.slug === slug));
  const markedCards = (isAutomatic && autoCards.length > 0 ? autoCards : handPickedCards).slice(0, BEST_SELLERS_COUNT);
  const rowCards: ProductCard[] = [...markedCards];
  const unusedCards = productCards.filter((card) => card.hasPage && !markedCards.some((marked) => marked.slug === card.slug));
  // Each round adds the first product of every category still missing from the row, then any other
  while (rowCards.length < BEST_SELLERS_COUNT && unusedCards.length > 0) {
    const nextIndex = unusedCards.findIndex((card) => !rowCards.some((shown) => shown.category === card.category));
    rowCards.push(unusedCards.splice(nextIndex === -1 ? 0 : nextIndex, 1)[0]);
  }
  return rowCards;
}

/*
  placement "landing-page"   - the landing page section (centred heading with lines, six cards in a row,
                               scroll reveal).
  placement "account-orders" - under "My Orders" on the account dashboard (design): heading on the left
                               with "View all Products" on the right (the way to see more) and one row of
                               five cards (four on phones, two per row). No scroll reveal there.
  placement "cart"           - under the empty cart: same cards as the landing page, but the heading is
                               "Fast Selling Products" on the left (lined up with the first card).
*/
export default function BestSellersSection({
  placement = "landing-page",
}: {
  placement?: "landing-page" | "account-orders" | "cart";
}) {
  const bestSellerCards = useBestSellerCards();
  const isOnAccountOrdersPage = placement === "account-orders";
  const sectionRef = useRef<HTMLElement>(null);
  // "visible": shown normally (also the server-rendered state, so nothing is hidden without JavaScript).
  // "waiting": hidden, ready to animate. "revealed": animated into view.
  const [revealState, setRevealState] = useState<"visible" | "waiting" | "revealed">("visible");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || isOnAccountOrdersPage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already clearly on screen when the page opens (not just peeking in at the bottom): just show it.
    if (section.getBoundingClientRect().top < window.innerHeight - 100) return;

    setRevealState("waiting");
    const revealObserver = new IntersectionObserver(
      ([sectionVisibility]) => {
        if (sectionVisibility.isIntersecting) {
          setRevealState("revealed");
          revealObserver.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    revealObserver.observe(section);
    return () => revealObserver.disconnect();
  }, [isOnAccountOrdersPage]);

  return (
    <section
      ref={sectionRef}
      className={`${styles["best-sellers-section"]} ${
        isOnAccountOrdersPage ? styles["best-sellers-section-on-account-orders"] : ""
      } ${revealState === "visible" ? "" : styles[`best-sellers-section-${revealState}`]}`}
      aria-labelledby="best-sellers-heading"
    >
      {isOnAccountOrdersPage ? (
        <div className={styles["best-sellers-account-heading-row"]}>
          <h2 id="best-sellers-heading" className={styles["best-sellers-account-heading"]}>
            Best Sellers
          </h2>
          <Link href="/products" className={styles["best-sellers-view-all-link"]}>
            View all Products
          </Link>
        </div>
      ) : placement === "cart" ? (
        <h2 id="best-sellers-heading" className={styles["best-sellers-cart-heading"]}>
          Fast Selling Products
        </h2>
      ) : (
        <h2 id="best-sellers-heading" className={styles["best-sellers-heading"]}>
          {/* Decorative line and dash on both sides of the heading */}
          <span className={styles["best-sellers-heading-decoration"]} aria-hidden="true" />
          Best Sellers
          <span
            className={`${styles["best-sellers-heading-decoration"]} ${styles["best-sellers-heading-decoration-right"]}`}
            aria-hidden="true"
          />
        </h2>
      )}

      <ul className={styles["best-sellers-product-list"]}>
        {bestSellerCards.map((card) => (
          <ProductCardTile key={card.cardId} card={card} />
        ))}
      </ul>
    </section>
  );
}
