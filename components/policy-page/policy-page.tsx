"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import SiteFooter from "@/components/footer/site-footer";
import LandingZoomAndLayoutRunner from "@/components/landing/landing-zoom-and-layout-runner";
import LoginBottomSheet from "@/components/login/login-bottom-sheet";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import styles from "./policy-page.module.css";

/*
  Shared layout of the policy pages (Refund Policy, Privacy Policy), from the Refund page design:
  - green hero banner: the title and a short line on the left (gold bar under the title on phones);
    on the right a wide olive arc with the milk, paneer and ghee in white circles that take turns
    in the three places (no circles on phones);
  - "On this page" menu on the left (stays in view while scrolling, and stops with the last card;
    the section being read is highlighted, clicking an item scrolls to it), and the policy cards
    on the right;
  - then the shared site footer.
  Each page passes its own title, short line and cards.
*/

export type PolicySection = { id: string; title: string; iconPaths: string[]; content: ReactNode };

// Cream note with a gold bar on the left, inside a card
export function PolicyCallout({ children }: { children: ReactNode }) {
  return <p className={styles["policy-callout"]}>{children}</p>;
}

// Light green boxes, two per row (one per row on phones), each with a gold dot, a title and a line
export function PolicyPointCards({ points }: { points: { title: string; text: string }[] }) {
  return (
    <ul className={styles["policy-point-cards"]}>
      {points.map((point) => (
        <li key={point.title} className={styles["policy-point-card"]}>
          <span className={styles["policy-point-card-title"]}>{point.title}</span>
          <span className={styles["policy-point-card-text"]}>{point.text}</span>
        </li>
      ))}
    </ul>
  );
}

function PolicyIcon({ iconPaths }: { iconPaths: string[] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths.map((iconPath) => (
        <path key={iconPath} d={iconPath} />
      ))}
    </svg>
  );
}

export default function PolicyPage({
  title,
  description,
  sections,
}: {
  title: string;
  description: ReactNode;
  sections: PolicySection[];
}) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);

  // Highlight the section being read in the "On this page" menu.
  useEffect(() => {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visibleEntry) setActiveSectionId(visibleEntry.target.id);
      },
      { rootMargin: "-25% 0px -55% 0px" },
    );
    for (const section of sections) {
      const sectionElement = document.getElementById(section.id);
      if (sectionElement) sectionObserver.observe(sectionElement);
    }
    return () => sectionObserver.disconnect();
  }, [sections]);

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSectionId(sectionId);
  }

  return (
    <div className={styles["policy-page"]}>
      <LandingZoomAndLayoutRunner />

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      {/* Hero banner */}
      <section className={styles["policy-hero"]} aria-labelledby="policy-page-title">
        <span className={styles["policy-hero-arc"]} aria-hidden="true" />
        <span className={styles["policy-hero-dashed-circle"]} aria-hidden="true" />

        <div className={styles["policy-hero-text"]}>
          <h1 id="policy-page-title" className={styles["policy-hero-title"]}>
            {title}
          </h1>
          {/* Gold bar under the title: phone design only */}
          <span className={styles["policy-hero-title-bar"]} aria-hidden="true" />
          <p className={styles["policy-hero-description"]}>{description}</p>
        </div>

        <div className={styles["policy-hero-products"]} aria-hidden="true">
          <span className={`${styles["policy-hero-product-circle"]} ${styles["policy-hero-product-milk"]}`}>
            <Image
              src="/images/products/a2-cow-milk-1-litre-bottle.webp"
              alt=""
              width={232}
              height={500}
              sizes="80px"
            />
          </span>
          <span className={`${styles["policy-hero-product-circle"]} ${styles["policy-hero-product-paneer"]}`}>
            <Image src="/images/products/a2-desi-gir-paneer-box.webp" alt="" width={604} height={444} sizes="140px" />
          </span>
          <span className={`${styles["policy-hero-product-circle"]} ${styles["policy-hero-product-ghee"]}`}>
            <Image src="/images/products/desi-ghee-jar-chiranvi-farm.webp" alt="" width={1524} height={2204} sizes="100px" />
          </span>
        </div>
      </section>

      {/* "On this page" menu and the policy cards */}
      <div className={styles["policy-body"]}>
        <nav aria-label="On this page" className={styles["policy-contents"]}>
          <p className={styles["policy-contents-title"]}>On this page</p>
          <ol className={styles["policy-contents-list"]}>
            {sections.map((section, sectionIndex) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={activeSectionId === section.id ? "location" : undefined}
                  className={`${styles["policy-contents-link"]} ${
                    activeSectionId === section.id ? styles["policy-contents-link-active"] : ""
                  }`}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollToSection(section.id);
                  }}
                >
                  <span className={styles["policy-contents-number"]}>{String(sectionIndex + 1).padStart(2, "0")}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles["policy-sections"]}>
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className={styles["policy-card"]}
            >
              <div className={styles["policy-card-heading-row"]}>
                <span className={styles["policy-card-icon"]}>
                  <PolicyIcon iconPaths={section.iconPaths} />
                </span>
                <h2 id={`${section.id}-heading`} className={styles["policy-card-heading"]}>
                  {section.title}
                </h2>
              </div>
              <div className={styles["policy-card-text"]}>{section.content}</div>
            </section>
          ))}
        </div>
      </div>

      <SiteFooter />
      <LoginBottomSheet />
    </div>
  );
}
