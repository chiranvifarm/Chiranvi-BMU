"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useIsLoginStatusKnown, useLoggedInMobileNumber } from "@/components/login/login-status";
import { useCustomerProfile, useIsCustomerProfileKnown } from "@/store/customer-profiles-store";
import styles from "./refer-a-friend-section.module.css";

/*
  Top part of the shared site footer (site-footer.tsx shows it on every page above the footer links):
  green "Good Milk. Good Health. Goodness Worth Sharing." banner
  with a short invite line and two app screens on the right (the purity screen with products,
  and the referral rewards screen).
  The app screens are pictures from the design; the products on the purity screen are the site's
  product images placed on top. "Claim Now" links to the products page until referrals exist.
  Scroll reveal: when the section scrolls into view, the banner fades and slides up.
  Line drawing: every time the section comes into view, the thin white lines draw themselves (top
  circle, then the long wave, then the bottom circle) and the leaf appears; when it leaves the screen
  they reset, so they draw again next time.
*/

export default function ReferAFriendSection() {
  const sectionRef = useRef<HTMLElement>(null);
  // The phone picture greets the logged-in customer by their first name. While their name is still being read it
  // stays empty (never a wrong "Friend" first); "Friend" only for visitors not logged in, or with no name saved yet.
  const loggedInMobileNumber = useLoggedInMobileNumber();
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const savedProfile = useCustomerProfile(loggedInMobileNumber);
  const isProfileKnown = useIsCustomerProfileKnown(loggedInMobileNumber);
  const isNameLoading = !isLoginStatusKnown || (Boolean(loggedInMobileNumber) && !isProfileKnown);
  const greetedName = isNameLoading ? "" : savedProfile?.firstName.trim() || "Friend";
  // "visible": shown normally (also the server-rendered state, so nothing is hidden without JavaScript).
  // "waiting": hidden, ready to animate. "revealed": animated into view.
  const [revealState, setRevealState] = useState<"visible" | "waiting" | "revealed">("visible");
  // White lines: "drawn" (server-rendered / reduced motion), "hidden" (off screen, ready) or "drawing".
  const [lineDrawState, setLineDrawState] = useState<"drawn" | "hidden" | "drawing">("drawn");

  // Draw the lines each time the section comes into view; reset them when it leaves.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lineObserver = new IntersectionObserver(
      ([sectionVisibility]) => setLineDrawState(sectionVisibility.isIntersecting ? "drawing" : "hidden"),
      { threshold: 0.35 },
    );
    lineObserver.observe(section);
    return () => lineObserver.disconnect();
  }, []);

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
      { threshold: 0.2 },
    );
    revealObserver.observe(section);
    return () => revealObserver.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`${styles["refer-a-friend-section"]} ${
        revealState === "visible" ? "" : styles[`refer-a-friend-section-${revealState}`]
      }`}
      aria-labelledby="refer-a-friend-heading"
    >
      <div className={`${styles["refer-a-friend-banner"]} ${styles[`refer-a-friend-lines-${lineDrawState}`]}`}>
        {/*
          Thin white line pattern traced from the design (drawn on the banner's 930 x 341 grid):
          a circle at the top, a long wave rising from the bottom towards the top right,
          and a circle edge at the bottom left. A small leaf sits on the right.
        */}
        <svg
          viewBox="0 0 930 341"
          preserveAspectRatio="xMidYMid slice"
          className={styles["refer-a-friend-background-line-pattern"]}
          aria-hidden="true"
        >
          {/* pathLength="1" lets the CSS draw each line from 0 to its full length, whatever its real length */}
          <circle cx="362" cy="-18" r="102" pathLength={1} className={styles["refer-a-friend-line-top-circle"]} />
          {/*
            Bottom-left circle edge (centre 31, 374, radius 123): only its top half is drawn, from the left
            over the top to the right, so the visible part starts drawing straight away (a full circle
            would first draw its hidden half below the banner).
          */}
          <path
            d="M-92 374A123 123 0 0 1 154 374"
            pathLength={1}
            className={styles["refer-a-friend-line-bottom-circle"]}
          />
          <path
            d="M228 341C300 300 382 302 452 268S560 196 604 168S760 58 870 84Q906 96 930 118"
            pathLength={1}
            className={styles["refer-a-friend-line-wave"]}
          />
        </svg>
        <svg viewBox="0 0 40 20" className={styles["refer-a-friend-background-leaf"]} aria-hidden="true">
          <path d="M1 18C8 4 24 1 39 2 33 14 19 20 1 18Z" />
        </svg>

        <div className={styles["refer-a-friend-text-block"]}>
          {/*
            Laptop / desktop: the heading and description are pictures exported from Figma (so they look
            exactly like the design); the real text stays in the page for screen readers and search,
            and is what phones show.
          */}
          <h2 id="refer-a-friend-heading" className={styles["refer-a-friend-heading"]}>
            <Image
              src="/images/refer-a-friend/refer-a-friend-heading-text.webp"
              alt=""
              width={1871}
              height={339}
              unoptimized
              className={styles["refer-a-friend-heading-image"]}
            />
            <span className={styles["refer-a-friend-text-for-phones"]}>
              Good Milk. Good Health.
              <br />
              <span className={styles["refer-a-friend-heading-highlight"]}>Goodness</span> Worth Sharing.
            </span>
          </h2>
          <p className={styles["refer-a-friend-description"]}>
            <Image
              src="/images/refer-a-friend/refer-a-friend-description-text-chiranvi-farm.webp"
              alt=""
              width={2144}
              height={191}
              unoptimized
              className={styles["refer-a-friend-description-image"]}
            />
            <span className={styles["refer-a-friend-text-for-phones"]}>
              Invite your friends to Chiranvi Farm! When they make their <br />
              first purchase, they&rsquo;ll remember you for a lifetime.
            </span>
          </p>
        </div>

        {/* Purity app screen, with the products drawn on top of its empty middle */}
        <div className={styles["refer-a-friend-purity-screen"]} aria-hidden="true">
          <Image
            src="/images/refer-a-friend/purity-promise-app-screen.webp"
            alt=""
            width={873}
            height={1228}
            // Mostly small text: served as the original file, so it is never resized or recompressed.
            unoptimized
            className={styles["refer-a-friend-screen-image"]}
          />
          <Image
            src="/images/products/desi-cow-milk-bottle-chiranvi-farm.webp"
            alt=""
            width={1188}
            height={2312}
            sizes="(max-width: 600px) 20vw, 120px"
            className={styles["refer-a-friend-purity-screen-milk-bottle"]}
          />
          <Image
            src="/images/products/desi-ghee-jar-chiranvi-farm.webp"
            alt=""
            width={1524}
            height={2204}
            sizes="(max-width: 600px) 40vw, 200px"
            className={styles["refer-a-friend-purity-screen-ghee-jar"]}
          />
          <Image
            src="/images/products/a2-desi-gir-paneer-box.webp"
            alt=""
            width={604}
            height={444}
            sizes="(max-width: 600px) 45vw, 220px"
            className={styles["refer-a-friend-purity-screen-paneer"]}
          />
        </div>

        {/* Referral rewards app screen */}
        <div className={styles["refer-a-friend-rewards-screen"]} aria-hidden="true">
          <Image
            src="/images/refer-a-friend/referral-rewards-app-screen-editable-text.webp"
            alt=""
            width={939}
            height={1656}
            // Mostly small text: served as the original file, so it is never resized or recompressed.
            unoptimized
            className={styles["refer-a-friend-screen-image"]}
          />
          {/* Text written over the picture (the picture has these areas left blank, so they can be edited) */}
          <span className={styles["refer-a-friend-rewards-screen-user-name"]}>{greetedName}</span>
          <span className={styles["refer-a-friend-rewards-screen-jersey-milk-label"]}>Jersey Milk</span>
          {/* A white patch hides the picture's "Total Refer 240" and "Worth rupees 12,800/-" (no made-up numbers) */}
          <span className={styles["refer-a-friend-rewards-screen-totals-cover"]} aria-hidden="true">
            {/*
              Around the invite card (in the white above and below it, never on it), like the banner's line art: thin
              circles, a wave and two small yellow flowers. The lines draw themselves with the banner's white lines,
              then the flowers open. The card sits on top, so nothing crosses it.
            */}
            <svg viewBox="0 0 100 52" className={styles["refer-a-friend-invite-decoration"]}>
              <circle cx="93" cy="3" r="7" pathLength={1} className={styles["refer-a-friend-invite-decoration-line"]} />
              <circle cx="80" cy="6.5" r="2.4" pathLength={1} className={styles["refer-a-friend-invite-decoration-line"]} />
              <path d="M0 47C14 41 26 51 42 46S70 40 84 45 96 49 100 44" pathLength={1} className={styles["refer-a-friend-invite-decoration-line"]} />
              <circle cx="6" cy="44.5" r="2.6" pathLength={1} className={styles["refer-a-friend-invite-decoration-line"]} />
              <g className={styles["refer-a-friend-invite-flower"]}>
                <ellipse cx="72" cy="5.8" rx="1.3" ry="2.2" />
                <ellipse cx="72" cy="5.8" rx="1.3" ry="2.2" transform="rotate(72 72 8)" />
                <ellipse cx="72" cy="5.8" rx="1.3" ry="2.2" transform="rotate(144 72 8)" />
                <ellipse cx="72" cy="5.8" rx="1.3" ry="2.2" transform="rotate(216 72 8)" />
                <ellipse cx="72" cy="5.8" rx="1.3" ry="2.2" transform="rotate(288 72 8)" />
                <circle cx="72" cy="8" r="1" className={styles["refer-a-friend-invite-flower-centre"]} />
              </g>
              <g className={styles["refer-a-friend-invite-flower"]}>
                <ellipse cx="90" cy="43.6" rx="1.6" ry="2.7" />
                <ellipse cx="90" cy="43.6" rx="1.6" ry="2.7" transform="rotate(72 90 46.3)" />
                <ellipse cx="90" cy="43.6" rx="1.6" ry="2.7" transform="rotate(144 90 46.3)" />
                <ellipse cx="90" cy="43.6" rx="1.6" ry="2.7" transform="rotate(216 90 46.3)" />
                <ellipse cx="90" cy="43.6" rx="1.6" ry="2.7" transform="rotate(288 90 46.3)" />
                <circle cx="90" cy="46.3" r="1.2" className={styles["refer-a-friend-invite-flower-centre"]} />
              </g>
            </svg>
            {/* In its place: a small invite card (gift icon, two lines), in the picture's greens */}
            <span className={styles["refer-a-friend-rewards-screen-invite-card"]}>
              <span className={styles["refer-a-friend-rewards-screen-invite-icon"]}>
                <svg viewBox="0 0 24 24">
                  <path d="M4 11h16v9H4z" />
                  <path d="M3 7h18v4H3z" />
                  <path d="M12 7v13" />
                  <path d="M12 7c-1.5-3-5-3.5-5.5-1.5S9 7 12 7c3 0 6-.5 5.5-1.5S13.5 4 12 7Z" />
                </svg>
              </span>
              <span className={styles["refer-a-friend-rewards-screen-invite-words"]}>
                <span className={styles["refer-a-friend-rewards-screen-invite-title"]}>Invite friends</span>
                <span className={styles["refer-a-friend-rewards-screen-invite-text"]}>Share the goodness of A2 milk</span>
              </span>
            </span>
          </span>
          <svg viewBox="0 0 24 24" className={styles["refer-a-friend-rewards-screen-menu-icon"]}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </div>
      </div>
    </section>
  );
}
