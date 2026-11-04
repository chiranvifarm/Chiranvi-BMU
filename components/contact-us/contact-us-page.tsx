import SiteFooter from "@/components/footer/site-footer";
import LandingZoomAndLayoutRunner from "@/components/landing/landing-zoom-and-layout-runner";
import LoginBottomSheet from "@/components/login/login-bottom-sheet";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import ContactUsFaq from "./contact-us-faq";
import ContactUsForm from "./contact-us-form";
import styles from "./contact-us-page.module.css";

/*
  The /contact-us page ("Contact" in the site footer opens it), from the design:
  the navigation bar, the "We'd love to hear from you." hero with four contact cards (call,
  WhatsApp, email, farm address), the "How can we help?" form, the frequently asked questions,
  then the shared site footer.
*/

const contactPhoneNumber = "+91 9902881718";
const contactEmail = "support@chiranvifarm.com";

export default function ContactUsPage() {
  return (
    <div className={styles["contact-us-page"]}>
      <LandingZoomAndLayoutRunner />

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      <div className={styles["contact-us-content"]}>
        <section className={styles["contact-us-hero"]} aria-labelledby="contact-us-heading">
          <p className={`${styles["contact-us-eyebrow"]} ${styles["contact-us-eyebrow-logo-yellow"]}`}>Contact us</p>
          <h1 id="contact-us-heading" className={styles["contact-us-heading"]}>
            We&rsquo;d love to hear
            <br />
            from <em className={styles["contact-us-heading-highlight"]}>you.</em>
          </h1>
          <p className={styles["contact-us-intro"]}>
            Questions about your subscription, a farm visit or bulk orders?{" "}
            <br />
            Our team replies within a few hours, every day of the week.
          </p>

          <ul className={styles["contact-us-cards"]} aria-label="Ways to reach us">
            <li>
              <a href="tel:+919902881718" className={styles["contact-us-card"]}>
                <span className={styles["contact-us-card-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
                    <path d="M14.05 2a9 9 0 0 1 8 7.94" />
                    <path d="M14.05 6A5 5 0 0 1 18 10" />
                  </svg>
                </span>
                <span className={styles["contact-us-card-title"]}>{contactPhoneNumber}</span>
                <span className={styles["contact-us-card-note"]}>Mon–Sun · 6 AM – 9 PM</span>
              </a>
            </li>
            <li>
              <a
                href="https://wa.me/919902881718"
                target="_blank"
                rel="noopener noreferrer"
                className={styles["contact-us-card"]}
              >
                <span className={styles["contact-us-card-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                    <path
                      transform="translate(7.6 7.4) scale(0.4)"
                      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"
                      strokeWidth="4.5"
                    />
                  </svg>
                </span>
                <span className={styles["contact-us-card-title"]}>{contactPhoneNumber}</span>
                <span className={styles["contact-us-card-note"]}>Quick replies for orders</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${contactEmail}`} className={styles["contact-us-card"]}>
                <span className={styles["contact-us-card-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="2" y="4" width="20" height="16" rx="1.5" />
                    <path d="m22 7-10 6.5L2 7" />
                    <circle cx="20" cy="19" r="3.2" className={styles["contact-us-card-icon-dot"]} />
                  </svg>
                </span>
                {/* On narrow cards the address breaks after the @ rather than in the middle of a word */}
                <span className={styles["contact-us-card-title"]}>
                  {contactEmail.split("@")[0]}@<wbr />
                  {contactEmail.split("@")[1]}
                </span>
                <span className={styles["contact-us-card-note"]}>We reply within 24 hours</span>
              </a>
            </li>
            <li>
              <a
                href="https://www.google.com/maps/search/?api=1&query=Chiranvi+Farm%2C+Channapattana%2C+Bengaluru+South+district%2C+Karnataka+562160"
                target="_blank"
                rel="noopener noreferrer"
                className={styles["contact-us-card"]}
              >
                <span className={styles["contact-us-card-icon"]} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <span className={styles["contact-us-card-address"]}>
                  Chiranvi Farm, Channapattana,
                  <br />
                  Bengaluru South district, Karnataka-562160
                </span>
              </a>
            </li>
          </ul>
        </section>

        <ContactUsForm />
        <ContactUsFaq />
      </div>

      <SiteFooter />
      <LoginBottomSheet />
    </div>
  );
}
