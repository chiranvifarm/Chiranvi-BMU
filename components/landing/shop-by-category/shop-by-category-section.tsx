"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { rememberPageAfterLogin, useIsLoggedIn } from "@/components/login/login-status";
import styles from "./shop-by-category-section.module.css";

/*
  Landing page section below the purity promises: "Shop By Category" heading
  with seven round category pictures (Milk, Paneer, Ghee, Butter, Flours, Batter, Pasta & Noodles).
  Logged in, each category opens All products with that category's filter chosen (/products?category=Milk):
  Milk shows A2, Jersey and Skimmed milk; Ghee and Butter their A2 and Jersey kinds; the others one product.
  Logged out, every category leads to the login page first (logging in comes before shopping), which then
  comes back to that category.
  Scroll reveal: when the section scrolls into view, the heading and the seven
  categories fade and slide up together.
  Phones and tablets (3 a row): only the first two rows show, with "View more" under them for the rest
  ("View less" closes them again). Wide screens show them all, with no button.
*/

// Phones and tablets: two rows of three before "View more"
const CATEGORIES_SHOWN_FIRST = 6;

// Transparent product cut-outs; the circle's light gradient shows behind them.
// Milk and ghee reuse the hero's product images.
const productCategories = [
  { name: "Milk", imageSource: "/images/products/desi-cow-milk-bottle-chiranvi-farm.webp", imageWidth: 1188, imageHeight: 2312 },
  { name: "Paneer", imageSource: "/images/categories/paneer-category.webp", imageWidth: 428, imageHeight: 288 },
  { name: "Ghee", imageSource: "/images/products/desi-ghee-jar-chiranvi-farm.webp", imageWidth: 1524, imageHeight: 2204 },
  { name: "Butter", imageSource: "/images/categories/butter-category.webp", imageWidth: 412, imageHeight: 272 },
  { name: "Flours", imageSource: "/images/categories/flours-category-chiranvi-farm.webp", imageWidth: 412, imageHeight: 276 },
  { name: "Batter", imageSource: "/images/categories/batter-category-chiranvi-farm.webp", imageWidth: 372, imageHeight: 248 },
  // One circle for the three: opens All products showing Noodles, Pasta and Macaroni together
  { name: "Pasta & Noodles", imageSource: "/images/categories/pasta-noodles-category.webp", imageWidth: 420, imageHeight: 280 },
];

export default function ShopByCategorySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isLoggedIn = useIsLoggedIn();
  // "visible": shown normally (also the server-rendered state, so nothing is hidden without JavaScript).
  // "waiting": hidden, ready to animate. "revealed": animated into view.
  const [revealState, setRevealState] = useState<"visible" | "waiting" | "revealed">("visible");
  // Phones and tablets: the categories after the first two rows are shown
  const [isEveryCategoryShown, setIsEveryCategoryShown] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
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
      { threshold: 0.3 },
    );
    revealObserver.observe(section);
    return () => revealObserver.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`${styles["shop-by-category-section"]} ${
        revealState === "visible" ? "" : styles[`shop-by-category-section-${revealState}`]
      }`}
      aria-labelledby="shop-by-category-heading"
    >
      <h2 id="shop-by-category-heading" className={styles["shop-by-category-heading"]}>
        {/* Decorative line and dash on both sides of the heading */}
        <span className={styles["shop-by-category-heading-decoration"]} aria-hidden="true" />
        Shop By Category
        <span
          className={`${styles["shop-by-category-heading-decoration"]} ${styles["shop-by-category-heading-decoration-right"]}`}
          aria-hidden="true"
        />
      </h2>

      <ul
        id="shop-by-category-list"
        className={`${styles["shop-by-category-list"]} ${isEveryCategoryShown ? styles["shop-by-category-list-everything-shown"] : ""}`}
      >
        {productCategories.map((productCategory, categoryIndex) => {
          const categoryPictureAndName = (
            <>
              <span className={styles["shop-by-category-image-circle"]}>
                <Image
                  src={productCategory.imageSource}
                  alt=""
                  width={productCategory.imageWidth}
                  height={productCategory.imageHeight}
                  sizes="120px"
                  className={styles["shop-by-category-image"]}
                />
              </span>
              <span className={styles["shop-by-category-name"]}>{productCategory.name}</span>
            </>
          );
          // The category's name is the same as its filter on All products
          const categoryPagePath = `/products?category=${encodeURIComponent(productCategory.name)}`;
          return (
            <li
              key={productCategory.name}
              className={categoryIndex >= CATEGORIES_SHOWN_FIRST ? styles["shop-by-category-item-after-two-rows"] : undefined}
            >
              {isLoggedIn ? (
                <Link href={categoryPagePath} className={styles["shop-by-category-link"]}>
                  {categoryPictureAndName}
                </Link>
              ) : (
                <Link href="/login" className={styles["shop-by-category-link"]} onClick={() => rememberPageAfterLogin(categoryPagePath)}>
                  {categoryPictureAndName}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {/* Phones and tablets only: the rest of the categories */}
      {productCategories.length > CATEGORIES_SHOWN_FIRST && (
        <button
          type="button"
          aria-expanded={isEveryCategoryShown}
          aria-controls="shop-by-category-list"
          className={styles["shop-by-category-view-more-button"]}
          onClick={() => setIsEveryCategoryShown(!isEveryCategoryShown)}
        >
          {isEveryCategoryShown ? "View less" : "View more"}
          <svg viewBox="0 0 24 24" aria-hidden="true" className={isEveryCategoryShown ? styles["shop-by-category-view-more-arrow-up"] : undefined}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </section>
  );
}
