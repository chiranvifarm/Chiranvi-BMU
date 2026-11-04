import Image from "next/image";
import Link from "next/link";
import ReferAFriendSection from "./refer-a-friend-section";
import styles from "./site-footer.module.css";

/*
  Site footer, shared by every page: the "Refer a Friend" banner on top (one light grey panel
  with the footer), then logo, the farm's address and contact details, and copyright on the left; Product, Company and
  Subscription link columns; "Get in touch" with social media icons.
  Used on the landing page and Join Community, so a change here shows on both.
  Links that have no page yet point to "#".
*/

const footerLinkColumns = [
  {
    title: "Product",
    links: [
      { label: "Milk", href: "/products" },
      { label: "Butter", href: "/products" },
      { label: "Paneer", href: "/products" },
      { label: "Ghee", href: "/products" },
      { label: "Flours", href: "/products" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about-us" },
      { label: "Contact", href: "/contact-us" },
      { label: "Refund", href: "/refund" },
      { label: "Referral", href: "#" },
      { label: "Privacy policy", href: "/privacy-policy" },
    ],
  },
  {
    title: "Subscription",
    links: [
      { label: "Monthly plan", href: "#" },
      { label: "Daily plan", href: "#" },
      { label: "Cancellation", href: "#" },
      { label: "Review", href: "/reviews" },
      { label: "Terms", href: "#" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <>
      <ReferAFriendSection />
      <footer className={styles["site-footer"]}>
        <div className={styles["site-footer-content"]}>
          <div className={styles["site-footer-brand"]}>
            <Link href="/" className={styles["site-footer-logo-link"]}>
              <Image
                src="/images/brand/chiranvi-farm-logo.webp"
                alt="Chiranvi Farm"
                width={516}
                height={240}
                className={styles["site-footer-logo-image"]}
              />
            </Link>
            <p className={styles["site-footer-description"]}>
              Chiranvi Farm, Channapattana, Bengaluru South district, Karnataka-562160
              <br />
              Mobile number: <a href="tel:+919902881718">+91 9902881718</a>
              <br />
              Email: <a href="mailto:support@chiranvifarm.com">support@chiranvifarm.com</a>
            </p>
            <p className={styles["site-footer-copyright"]}>© 2026 Chiranvi Farm. All rights reserved.</p>
          </div>

          {footerLinkColumns.map((footerLinkColumn) => (
            <nav
              key={footerLinkColumn.title}
              aria-label={footerLinkColumn.title}
              className={styles["site-footer-link-column"]}
            >
              <h2 className={styles["site-footer-column-title"]}>{footerLinkColumn.title}</h2>
              <ul className={styles["site-footer-link-list"]}>
                {footerLinkColumn.links.map((footerLink) => (
                  <li key={footerLink.label}>
                    <Link href={footerLink.href} className={styles["site-footer-link"]}>
                      {footerLink.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className={styles["site-footer-contact-column"]}>
            <h2 className={styles["site-footer-column-title"]}>Get in touch</h2>
            <p className={styles["site-footer-contact-text"]}>
              Have a question?
              <br />
              We’d love to hear from you.
            </p>
            <div className={styles["site-footer-social-links"]}>
              <a href="#" aria-label="Instagram" className={styles["site-footer-social-link"]}>
                <svg viewBox="0 0 24 24" className={styles["site-footer-social-icon"]} aria-hidden="true">
                  <defs>
                    <linearGradient id="site-footer-instagram-gradient" x1="0" y1="1" x2="1" y2="0">
                      <stop offset="0" stopColor="#feda75" />
                      <stop offset="0.35" stopColor="#fa7e1e" />
                      <stop offset="0.65" stopColor="#d62976" />
                      <stop offset="1" stopColor="#4f5bd5" />
                    </linearGradient>
                  </defs>
                  <rect
                    x="2.5"
                    y="2.5"
                    width="19"
                    height="19"
                    rx="5.5"
                    fill="none"
                    stroke="url(#site-footer-instagram-gradient)"
                    strokeWidth="2.2"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="4.3"
                    fill="none"
                    stroke="url(#site-footer-instagram-gradient)"
                    strokeWidth="2.2"
                  />
                  <circle cx="17.4" cy="6.6" r="1.3" fill="#d62976" />
                </svg>
              </a>
              <a href="#" aria-label="WhatsApp" className={styles["site-footer-social-link"]}>
                <svg viewBox="0 0 24 24" className={styles["site-footer-social-icon"]} aria-hidden="true">
                  <path fill="#25d366" d="M12 1.5A10.4 10.4 0 0 0 3.1 17.3L1.6 22.5l5.4-1.4A10.4 10.4 0 1 0 12 1.5Z" />
                  <path
                    fill="#ffffff"
                    d="M8.6 6.7c-.2-.5-.4-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3l-1.9-.9c-.3-.1-.5-.2-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5.3-.5v-.5l-.8-2.2Z"
                  />
                </svg>
              </a>
              <a href="#" aria-label="Facebook" className={styles["site-footer-social-link"]}>
                <svg viewBox="0 0 24 24" className={styles["site-footer-social-icon"]} aria-hidden="true">
                  <rect x="1.5" y="1.5" width="21" height="21" rx="4" fill="#1877f2" />
                  <path
                    fill="#ffffff"
                    d="M16.6 22.5v-7.6h2.5l.4-3h-2.9V10c0-.9.3-1.5 1.5-1.5h1.6V5.8c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2h-2.6v3h2.6v7.6h3.1Z"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
