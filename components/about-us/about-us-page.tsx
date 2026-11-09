import Link from "next/link";
import SiteFooter from "@/components/footer/site-footer";
import LandingZoomAndLayoutRunner from "@/components/landing/landing-zoom-and-layout-runner";
import LoginBottomSheet from "@/components/login/login-bottom-sheet";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import AboutUsIcon, { type AboutUsIconName } from "./about-us-icon";
import styles from "./about-us-page.module.css";

/*
  The /about-us page ("About us" in the navigation bar and the site footer), from the design:
    1. About us: intro and the four farm numbers (cows, acres, natural, preservatives)
    2. Our story with the founder's quote, beside "From our cows to your cup" (the morning timeline)
    3. Our promise
    4. "We're a Truly Traditional Desi Dairy" with four cards
    5. Meet our team, the three big numbers, and the "Taste the difference" call to action
  Every word is real text (nothing is inside a picture), so it can be edited here and animated later.
  All the content is in the lists below.
*/

const farmNumbers: { icon: AboutUsIconName; iconWidth: number; iconHeight: number; value: string; label: string }[] = [
  { icon: "cow", iconWidth: 53.29, iconHeight: 38.43, value: "50+", label: "Desi A2 cows" },
  { icon: "barn", iconWidth: 42, iconHeight: 31, value: "10+", label: "Acres of open pasture" },
  { icon: "leaf", iconWidth: 30, iconHeight: 30, value: "100%", label: "Natural products" },
  { icon: "flask", iconWidth: 33.07, iconHeight: 38, value: "0%", label: "Preservatives" },
];

const storyHighlights: { icon: AboutUsIconName; title: string; note: string }[] = [
  { icon: "leaf", title: "Family-run", note: "since day one" },
  { icon: "churn", title: "Small batches", note: "made by hand" },
  { icon: "shield", title: "Lab tested", note: "for purity" },
];

const morningTimeline: { time: string; icon: AboutUsIconName; title: string; description: string }[] = [
  { time: "4:30 AM", icon: "sun", title: "Cows fed & cared for", description: "Fresh fodder, clean water and a gentle wash." },
  { time: "5:00 AM", icon: "drop", title: "Milking begins", description: "Hygienic, unhurried milking by our farm team." },
  {
    time: "5:45 AM",
    icon: "flask",
    title: "Filtered & quality checked",
    description: "Every batch is filtered and checked for purity.",
  },
  { time: "6:00 AM", icon: "bottle", title: "Chilled & bottled", description: "Cooled within minutes and sealed fresh." },
  { time: "6:15 AM", icon: "truck", title: "Out for delivery", description: "Our riders head out across the city." },
  { time: "7:00 AM", icon: "barn", title: "At your doorstep", description: "Fresh milk, ready for your morning tea." },
];

const promises: { icon: AboutUsIconName; title: string; description: string }[] = [
  { icon: "drop", title: "Pure A2 milk, always", description: "Only milk from our own desi cows. Never mixed, never diluted." },
  {
    icon: "sun",
    title: "At your door by morning",
    description: "Milked at dawn, chilled at once and delivered before 7:30 am.",
  },
  { icon: "shield", title: "Nothing added, ever", description: "No preservatives, no hormones, no adulteration. Just real food." },
];

const traditionalWays: { icon: AboutUsIconName; title: string; description: string }[] = [
  {
    icon: "leaf",
    title: "Grass-fed Desi Cows",
    description: "Our A2 cows graze freely on open pasture and eat natural, chemical-free feed.",
  },
  {
    icon: "drop",
    title: "Hygienic Milking",
    description: "Clean, gentle milking at dawn, filtered and chilled within minutes.",
  },
  {
    icon: "churn",
    title: "Traditional Methods",
    description: "Ghee and butter churned the bilona way, in small batches, by hand.",
  },
  {
    icon: "truck",
    title: "Same-day Delivery",
    description: "From our farm to your doorstep every morning, fresh and on time.",
  },
];

const teamMembers = [
  { role: "Founder", name: "Praveen", description: "Started Chiranvi to bring village-fresh A2 milk back to city homes." },
  {
    role: "Farm Manager",
    name: "[Name]",
    description: "Looks after our herd, the pasture and the morning milking every day.",
  },
];

const bigNumbers = [
  { value: "5K+", label: "Happy families" },
  { value: "50+", label: "Desi A2 cows" },
  { value: "500+", label: "Daily deliveries" },
];

export default function AboutUsPage() {
  return (
    <div className={styles["about-us-page"]}>
      <LandingZoomAndLayoutRunner />

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      {/* 1. About us */}
      <section className={styles["about-us-hero"]} aria-labelledby="about-us-heading">
        <div className={styles["about-us-container"]}>
          <p className={styles["about-us-eyebrow"]}>Who we are</p>
          <h1 id="about-us-heading" className={styles["about-us-hero-heading"]}>
            About us
          </h1>
          <div className={styles["about-us-hero-intro"]}>
            <p className={styles["about-us-hero-text"]}>
              A family-run desi dairy where A2 cows graze <br />
              freely, milk is drawn at dawn, and every product <br />
              reaches your home fresh, pure and exactly <br />
              as nature intended.
            </p>
            <span className={styles["about-us-hero-line"]} aria-hidden="true" />
          </div>

          <ul className={styles["about-us-farm-numbers"]} aria-label="Our farm in numbers">
            {farmNumbers.map((farmNumber) => (
              <li key={farmNumber.label} className={styles["about-us-farm-number"]}>
                <span className={styles["about-us-farm-number-icon"]}>
                  <AboutUsIcon name={farmNumber.icon} width={farmNumber.iconWidth} height={farmNumber.iconHeight} />
                </span>
                <span>
                  <span className={styles["about-us-farm-number-value"]}>{farmNumber.value}</span>
                  <span className={styles["about-us-farm-number-label"]}>{farmNumber.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 2. Our story and the morning timeline */}
      <section className={`${styles["about-us-container"]} ${styles["about-us-story"]}`} aria-labelledby="about-us-story-heading">
        <div className={styles["about-us-story-text"]}>
          <p className={styles["about-us-eyebrow"]}>Our story</p>
          <h2 id="about-us-story-heading" className={styles["about-us-story-heading"]}>
            Real cows, real people,
            <br />
            <em className={styles["about-us-story-heading-highlight"]}>fresh every morning.</em>
          </h2>
          <p className={styles["about-us-story-paragraph"]}>
            Chiranvi began with a simple wish: to give our own family milk that tasted the way it did in our village.
            Today we care for a herd of indigenous A2 cows, let them graze freely, and follow the slow, traditional ways
            of dairy farming that big brands skip.
          </p>

          <figure className={styles["about-us-founder-note"]}>
            <span className={styles["about-us-founder-note-mark"]} aria-hidden="true">
              &ldquo;
            </span>
            <blockquote className={styles["about-us-founder-note-quote"]}>
              We only sell what we would happily serve at our own dinner table.
            </blockquote>
            <figcaption className={styles["about-us-founder-note-author"]}>Praveen, Founder, Chiranvi Farm</figcaption>
          </figure>

          <ul className={styles["about-us-story-highlights"]}>
            {storyHighlights.map((highlight) => (
              <li key={highlight.title} className={styles["about-us-story-highlight"]}>
                <span className={styles["about-us-story-highlight-icon"]}>
                  <AboutUsIcon name={highlight.icon} width={18} height={18} />
                </span>
                <span className={styles["about-us-story-highlight-title"]}>{highlight.title}</span>
                <span className={styles["about-us-story-highlight-note"]}>{highlight.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles["about-us-timeline"]}>
          <span className={styles["about-us-timeline-circle-outer"]} aria-hidden="true" />
          <span className={styles["about-us-timeline-circle-inner"]} aria-hidden="true" />
          <p className={styles["about-us-timeline-eyebrow"]}>A morning at the farm</p>
          <h2 className={styles["about-us-timeline-heading"]}>From our cows to your cup</h2>
          <p className={styles["about-us-timeline-subheading"]}>Every day, before most of the city wakes up.</p>
          <ol className={styles["about-us-timeline-steps"]}>
            {morningTimeline.map((step) => (
              <li key={step.time} className={styles["about-us-timeline-step"]}>
                <span className={styles["about-us-timeline-time"]}>{step.time}</span>
                <span className={styles["about-us-timeline-step-icon"]}>
                  <AboutUsIcon name={step.icon} width={20} height={20} />
                </span>
                <span>
                  <span className={styles["about-us-timeline-step-title"]}>{step.title}</span>
                  <span className={styles["about-us-timeline-step-description"]}>{step.description}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3. Our promise */}
      <section className={`${styles["about-us-container"]} ${styles["about-us-promise"]}`} aria-labelledby="about-us-promise-heading">
        <div className={styles["about-us-promise-intro"]}>
          <p className={`${styles["about-us-eyebrow"]} ${styles["about-us-eyebrow-with-line"]}`}>Our promise</p>
          <h2 id="about-us-promise-heading" className={styles["about-us-promise-heading"]}>
            Our Promise
            <br />
            Stays the Same
          </h2>
        </div>
        {promises.map((promise) => (
          <div key={promise.title} className={styles["about-us-promise-item"]}>
            <span className={styles["about-us-gold-icon-box"]}>
              <AboutUsIcon name={promise.icon} width={26} height={26} />
            </span>
            <h3 className={styles["about-us-card-title"]}>{promise.title}</h3>
            <p className={styles["about-us-card-text"]}>{promise.description}</p>
          </div>
        ))}
      </section>

      {/* 4. Truly traditional */}
      <section className={styles["about-us-traditional"]} aria-labelledby="about-us-traditional-heading">
        <h2 id="about-us-traditional-heading" className={styles["about-us-traditional-heading"]}>
          We&rsquo;re a <em className={styles["about-us-traditional-heading-highlight"]}>Truly Traditional</em> Desi Dairy{" "}
          <br />
          From Pasture to Your Doorstep
        </h2>
        <p className={styles["about-us-traditional-subheading"]}>
          We follow the slow, time-honoured ways of Indian dairy farming, so every drop{" "}
          <br />
          is as wholesome as the milk our grandparents grew up on.
        </p>
        <ul className={styles["about-us-traditional-cards"]}>
          {traditionalWays.map((way) => (
            <li key={way.title} className={styles["about-us-traditional-card"]}>
              <span className={styles["about-us-gold-icon-box"]}>
                <AboutUsIcon name={way.icon} width={28} height={28} />
              </span>
              <h3 className={styles["about-us-card-title"]}>{way.title}</h3>
              <p className={styles["about-us-card-text"]}>{way.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Meet our team */}
      <section className={styles["about-us-team"]} aria-labelledby="about-us-team-heading">
        <p className={`${styles["about-us-eyebrow"]} ${styles["about-us-team-eyebrow"]}`}>The people behind Chiranvi</p>
        <h2 id="about-us-team-heading" className={styles["about-us-team-heading"]}>
          Meet Our Team
        </h2>
        <p className={styles["about-us-team-subheading"]}>
          A small team of farmers, dairy experts and delivery partners who wake up before sunrise so your family can
          enjoy fresh, honest food every day.
        </p>
        <ul className={styles["about-us-team-cards"]}>
          {teamMembers.map((member, memberIndex) => (
            <li key={member.role} className={styles["about-us-team-card"]}>
              {/* Placeholder portrait until real photos are added */}
              <svg viewBox="0 0 175 175" className={styles["about-us-team-photo"]} aria-hidden="true">
                <defs>
                  <linearGradient id={`about-us-photo-${memberIndex}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#fbf3e4" />
                    <stop offset="1" stopColor="#f1e4c9" />
                  </linearGradient>
                  <clipPath id={`about-us-photo-clip-${memberIndex}`}>
                    <circle cx="87.5" cy="87.5" r="87.5" />
                  </clipPath>
                </defs>
                <circle cx="87.5" cy="87.5" r="87.5" fill={`url(#about-us-photo-${memberIndex})`} />
                <g clipPath={`url(#about-us-photo-clip-${memberIndex})`} fill="#abbb95">
                  <circle cx="87.5" cy="65" r="30" />
                  <ellipse cx="87.5" cy="152" rx="58" ry="46" />
                </g>
              </svg>
              <div>
                <p className={styles["about-us-team-role"]}>{member.role}</p>
                <h3 className={styles["about-us-team-name"]}>{member.name}</h3>
                <p className={styles["about-us-team-description"]}>{member.description}</p>
                <span className={styles["about-us-team-line"]} aria-hidden="true" />
                <p className={styles["about-us-team-farm"]}>Chiranvi Farm</p>
              </div>
            </li>
          ))}
        </ul>
        <ul className={styles["about-us-big-numbers"]} aria-label="Chiranvi in numbers">
          {bigNumbers.map((bigNumber) => (
            <li key={bigNumber.label} className={styles["about-us-big-number"]}>
              <span className={styles["about-us-big-number-value"]}>{bigNumber.value}</span>
              <span className={styles["about-us-big-number-label"]}>{bigNumber.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Call to action */}
      <section className={styles["about-us-call-to-action"]} aria-labelledby="about-us-call-to-action-heading">
        <h2 id="about-us-call-to-action-heading" className={styles["about-us-call-to-action-heading"]}>
          Taste the difference of real desi dairy
        </h2>
        <p className={styles["about-us-call-to-action-text"]}>
          Start with a trial pack or set up a daily milk subscription in under a minute.
        </p>
        <div className={styles["about-us-call-to-action-buttons"]}>
          <Link href="/products" className={styles["about-us-button-filled"]}>
            Shop Products
          </Link>
        </div>
      </section>

      <SiteFooter />
      <LoginBottomSheet />
    </div>
  );
}
