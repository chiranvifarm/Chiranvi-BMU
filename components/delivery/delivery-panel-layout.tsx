"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { rememberPageAfterLogin } from "@/components/login/login-status";
import { getNameInitials } from "@/components/account/account-profile";
import {
  formatTime,
  markNotificationsSeen,
  setOnDuty,
  useAgentStops,
  useDeliveryAgentLogin,
  type AgentStops,
  type DeliveryAgentLogin,
} from "@/store/delivery-agent-store";
import styles from "./delivery-panel-layout.module.css";

/*
  Delivery Panel frame (/delivery and its pages), for delivery agents during their morning shift, mostly
  on a phone. Built from the written brief (no design yet), in the Chiranvi Panel's style.
  Who can open it: a number with the "Delivery agent" role (Roles & permissions). Logged-out visitors log
  in first and come back here; everyone else goes to their account.
  Sidebar: Profile; Deliveries (Ongoing, Up next, Completed, with live counts); Manager reports; Leaves &
  attendance; Contact farm. At the top of every page: On duty / Off duty and the notifications bell.
  Phones and tablets (900 wide or less): a top bar with the menu button, duty switch and bell; the sidebar
  slides in from the left (closes on a page link, the backdrop, the close button or Escape).
  The pages read the agent and their stops from here (useDeliveryPanel), so the counts and pages always
  agree: when a stop is finished it moves to Completed and the next one becomes Ongoing everywhere.
*/

type AgentLogin = Extract<DeliveryAgentLogin, { state: "agent" }>;

const DeliveryPanelContext = createContext<{ login: AgentLogin; stops: AgentStops } | null>(null);

// The logged-in agent and their stops (only inside the Delivery Panel)
export function useDeliveryPanel() {
  const panel = useContext(DeliveryPanelContext);
  if (!panel) throw new Error("useDeliveryPanel is used outside the Delivery Panel");
  return panel;
}

type PanelPage = { href: string; label: string; iconPaths: string[]; count?: (stops: AgentStops) => number };

const panelPageGroups: { title: string; pages: PanelPage[] }[] = [
  {
    title: "Me",
    pages: [
      {
        href: "/delivery/profile",
        label: "Profile",
        iconPaths: ["M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
      },
    ],
  },
  {
    title: "Deliveries",
    pages: [
      {
        href: "/delivery",
        label: "Ongoing",
        count: (stops) => (stops.ongoing ? 1 : 0),
        iconPaths: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
      },
      {
        href: "/delivery/up-next",
        label: "Up next",
        count: (stops) => stops.upNext.length,
        iconPaths: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
      },
      {
        href: "/delivery/completed",
        label: "Completed",
        count: (stops) => stops.completed.length,
        iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8 12.5l2.5 2.5 5.5-5.5"],
      },
    ],
  },
  {
    title: "Work",
    pages: [
      {
        href: "/delivery/manager-reports",
        label: "Manager reports",
        iconPaths: ["M9 3.5h6v3H9z", "M7 5H5.5v15.5h13V5H17", "M8.5 11.5h7", "M8.5 15.5h5"],
      },
      {
        href: "/delivery/leaves",
        label: "Leaves & attendance",
        iconPaths: ["M4 6h16v14H4z", "M4 10h16", "M8 3.5v4", "M16 3.5v4"],
      },
      {
        href: "/delivery/contact",
        label: "Contact farm",
        iconPaths: ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"],
      },
    ],
  },
];

export const DELIVERY_PANEL_PAGES = panelPageGroups.flatMap((group) => group.pages);

export default function DeliveryPanelLayout({ children }: { children: ReactNode }) {
  const login = useDeliveryAgentLogin();
  const pathname = usePathname();
  const router = useRouter();

  // Logged out: log in first, then come back. Not a delivery agent: their account instead.
  useEffect(() => {
    if (login.state === "logged-out") {
      rememberPageAfterLogin(pathname);
      router.replace("/login");
    } else if (login.state === "not-an-agent") {
      router.replace("/account");
    }
  }, [login.state, pathname, router]);

  if (login.state !== "agent") return <div className={styles["delivery-panel-loading"]} aria-busy="true" />;
  return <DeliveryPanelFrame login={login}>{children}</DeliveryPanelFrame>;
}

function DeliveryPanelFrame({ login, children }: { login: AgentLogin; children: ReactNode }) {
  const stops = useAgentStops(login);
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPathname, setMenuPathname] = useState(pathname);
  // Opening another page closes the menu
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setIsMenuOpen(false);
  }

  useEffect(() => {
    if (!isMenuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    // The page behind does not scroll while the menu is open
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);

  const currentPage = DELIVERY_PANEL_PAGES.find((page) => page.href === pathname);

  return (
    <DeliveryPanelContext.Provider value={{ login, stops }}>
      <div className={styles["delivery-panel"]}>
        {/* Phones and tablets: menu button, logo, duty switch, bell */}
        <header className={styles["delivery-topbar"]}>
          <button
            type="button"
            className={styles["delivery-topbar-menu-button"]}
            aria-label="Open the menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <Link href="/delivery" className={styles["delivery-topbar-logo"]}>
            <Image src="/images/brand/chiranvi-farm-logo.webp" alt="Delivery Panel" width={516} height={240} priority />
          </Link>
          <div className={styles["delivery-topbar-actions"]}>
            <DutySwitch mobileNumber={login.mobileNumber} isOnDuty={stops.isOnDuty} />
            <NotificationsBell mobileNumber={login.mobileNumber} stops={stops} />
          </div>
        </header>

        {isMenuOpen && <div className={styles["delivery-sidebar-backdrop"]} onClick={() => setIsMenuOpen(false)} aria-hidden="true" />}

        <aside className={`${styles["delivery-sidebar"]} ${isMenuOpen ? styles["delivery-sidebar-open"] : ""}`}>
          <div className={styles["delivery-sidebar-top-row"]}>
            <Link href="/" className={styles["delivery-sidebar-logo"]}>
              <Image src="/images/brand/chiranvi-farm-logo.webp" alt="Chiranvi Farm" width={516} height={240} priority />
            </Link>
            <button type="button" className={styles["delivery-sidebar-close"]} aria-label="Close the menu" onClick={() => setIsMenuOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <p className={styles["delivery-sidebar-panel-name"]}>Delivery Panel</p>

          <nav aria-label="Delivery Panel" className={styles["delivery-sidebar-groups"]}>
            {panelPageGroups.map((group) => (
              <div key={group.title} className={styles["delivery-sidebar-group"]}>
                <p className={styles["delivery-sidebar-group-title"]}>{group.title}</p>
                {group.pages.map((page) => {
                  const isCurrentPage = pathname === page.href;
                  const count = page.count?.(stops);
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      aria-current={isCurrentPage ? "page" : undefined}
                      className={`${styles["delivery-sidebar-link"]} ${isCurrentPage ? styles["delivery-sidebar-link-current"] : ""}`}
                    >
                      <svg viewBox="0 0 24 24" className={styles["delivery-sidebar-link-icon"]} aria-hidden="true">
                        {page.iconPaths.map((iconPath) => (
                          <path key={iconPath} d={iconPath} />
                        ))}
                      </svg>
                      <span className={styles["delivery-sidebar-link-label"]}>{page.label}</span>
                      {count !== undefined && (
                        <span className={styles["delivery-sidebar-count"]} aria-label={`${count} stops`}>
                          {count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* The signed-in agent, with their route; opens their account */}
          <Link href="/account" className={styles["delivery-sidebar-person"]} title="Back to my account">
            <span className={styles["delivery-sidebar-person-avatar"]} aria-hidden="true">
              {getNameInitials(login.name)}
            </span>
            <span className={styles["delivery-sidebar-person-text"]}>
              <span className={styles["delivery-sidebar-person-name"]}>{login.name}</span>
              <span className={styles["delivery-sidebar-person-role"]}>
                Delivery agent{login.route ? ` · ${login.route.name}, ${login.route.area}` : ""}
              </span>
            </span>
            <svg viewBox="0 0 24 24" className={styles["delivery-sidebar-person-arrow"]} aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </aside>

        <main className={styles["delivery-content"]}>
          {/* Wide screens: duty switch and bell above the page */}
          <div className={styles["delivery-content-top-row"]}>
            {currentPage && <span className={styles["delivery-content-page-name"]}>{currentPage.label}</span>}
            <div className={styles["delivery-topbar-actions"]}>
              <DutySwitch mobileNumber={login.mobileNumber} isOnDuty={stops.isOnDuty} />
              <NotificationsBell mobileNumber={login.mobileNumber} stops={stops} />
            </div>
          </div>
          {children}
        </main>
      </div>
    </DeliveryPanelContext.Provider>
  );
}

// On duty / Off duty: deliveries can be worked on only while on duty
function DutySwitch({ mobileNumber, isOnDuty }: { mobileNumber: string; isOnDuty: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOnDuty}
      className={`${styles["delivery-duty-switch"]} ${isOnDuty ? styles["delivery-duty-switch-on"] : ""}`}
      onClick={() => setOnDuty(mobileNumber, !isOnDuty)}
    >
      <span className={styles["delivery-duty-switch-track"]} aria-hidden="true">
        <span className={styles["delivery-duty-switch-knob"]} />
      </span>
      {isOnDuty ? "On duty" : "Off duty"}
    </button>
  );
}

// The bell: new stops, route changes, request updates and manager messages, newest first
function NotificationsBell({ mobileNumber, stops }: { mobileNumber: string; stops: AgentStops }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function toggle() {
    // Opening the list marks everything in it as seen
    if (!isOpen) markNotificationsSeen(mobileNumber);
    setIsOpen(!isOpen);
  }

  return (
    <div className={styles["delivery-bell"]}>
      <button
        type="button"
        className={styles["delivery-bell-button"]}
        aria-label={`Notifications${stops.unseenNotificationCount > 0 ? `, ${stops.unseenNotificationCount} new` : ""}`}
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
        {stops.unseenNotificationCount > 0 && (
          <span className={styles["delivery-bell-count"]} aria-hidden="true">
            {stops.unseenNotificationCount}
          </span>
        )}
      </button>
      {isOpen && (
        <>
          <div className={styles["delivery-bell-backdrop"]} onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div className={styles["delivery-bell-list"]} role="dialog" aria-label="Notifications">
            <p className={styles["delivery-bell-list-title"]}>Notifications</p>
            {stops.notifications.length === 0 ? (
              <p className={styles["delivery-bell-empty"]}>
                Nothing new. New stops, route changes, request updates and manager messages show here.
              </p>
            ) : (
              <ul className={styles["delivery-bell-items"]}>
                {stops.notifications.map((notification) => (
                  <li key={notification.id} className={styles["delivery-bell-item"]}>
                    <span className={styles["delivery-bell-item-text"]}>{notification.text}</span>
                    <span className={styles["delivery-bell-item-time"]}>{formatTime(notification.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Shared pieces of the Delivery Panel's pages ----------

// Title and short line at the top of every page
export function DeliveryPageHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className={styles["delivery-page-heading"]}>
      <div>
        <h1 className={styles["delivery-page-title"]}>{title}</h1>
        <p className={styles["delivery-page-description"]}>{description}</p>
      </div>
      {children && <div className={styles["delivery-page-heading-actions"]}>{children}</div>}
    </div>
  );
}

// Off duty, or no route given yet: shown instead of (or above) the deliveries
export function DeliveryNotice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className={styles["delivery-notice"]}>
      <p className={styles["delivery-notice-title"]}>{title}</p>
      <p className={styles["delivery-notice-text"]}>{text}</p>
      {children && <div className={styles["delivery-notice-actions"]}>{children}</div>}
    </div>
  );
}

// The notices every Deliveries page shows first: no route yet, or off duty (with the switch)
export function DeliveryShiftNotices() {
  const { login, stops } = useDeliveryPanel();
  if (!login.agent || !login.route) {
    return (
      <DeliveryNotice
        title="No route given to you yet"
        text="Ask your manager to add your number on Routes & agents in the Chiranvi Panel and give you a route. Your stops show here after that."
      />
    );
  }
  if (!stops.isOnDuty) {
    return (
      <DeliveryNotice title="You're off duty" text="Go on duty to start your deliveries. Your stops are shown below.">
        <button type="button" className={styles["delivery-button-filled"]} onClick={() => setOnDuty(login.mobileNumber, true)}>
          Go on duty
        </button>
      </DeliveryNotice>
    );
  }
  return null;
}

// A pop-up from the bottom on phones, centred on wide screens (closes on the backdrop, the close button or Escape)
export function DeliverySheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className={styles["delivery-sheet-backdrop"]} onClick={onClose}>
      <div className={styles["delivery-sheet"]} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className={styles["delivery-sheet-heading-row"]}>
          <h2 className={styles["delivery-sheet-title"]}>{title}</h2>
          <button type="button" className={styles["delivery-sheet-close"]} aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Profile, Manager reports, Leaves & attendance and Contact farm: built in the next round
export function DeliveryComingNext({ label }: { label: string }) {
  return (
    <>
      <DeliveryPageHeading title={label} description="This part of the Delivery Panel comes next." />
      <DeliveryNotice title="Coming next" text={`${label} is being built. Your deliveries are ready under Deliveries.`}>
        <Link href="/delivery" className={styles["delivery-button-filled"]}>
          Go to Ongoing
        </Link>
      </DeliveryNotice>
    </>
  );
}

// Buttons shared by the pages (same look everywhere)
export const deliveryButtonStyles = {
  filled: styles["delivery-button-filled"],
  outlined: styles["delivery-button-outlined"],
  danger: styles["delivery-button-danger"],
  small: styles["delivery-button-small"],
};
