"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import LandingZoomAndLayoutRunner from "@/components/landing/landing-zoom-and-layout-runner";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import { logOut, rememberPageAfterLogin, useIsLoggedIn, useIsLoginStatusKnown } from "@/components/login/login-status";
import { useCurrentStaffAccess } from "@/store/staff-access-store";
import { useIsDeliveryAgent } from "@/store/delivery-agent-store";
import { countActiveOrders, forgetAllOrders, markOrderUpdatesSeen, useOrderUpdates, useOrders } from "@/store/orders-store";
import { getNameInitials, useAccountProfile } from "./account-profile";
import LogoutConfirmationDialog, { type LogoutChoice } from "./logout-confirmation-dialog";
import styles from "./account-dashboard-layout.module.css";

/*
  Account dashboard frame (designs: My Profile, My Orders, My Subscription, My Addresses, My Offers, Help):
  the site navigation bar, a sidebar card on the left (greeting, the dashboard pages, Logout)
  and the open page on the right.
  Only for logged-in visitors: anyone else is sent to the login, which then comes back to this page.
  Logout first asks "Log out?" (design); confirming forgets the login, empties the cart and forgets the
  orders, then opens the home page.
  The owner, admins and managers also see "Chiranvi Panel", which opens the admin panel (/admin).
*/

const accountPages = [
  { href: "/account", label: "Profile", iconPaths: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"] },
  { href: "/account/orders", label: "Orders", iconPaths: ["M6 8h12l-1 13H7L6 8Z", "M9 8V6a3 3 0 0 1 6 0v2"] },
  {
    href: "/account/subscription",
    label: "Subscription",
    iconPaths: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4M16 3v4", "M9 15l2 2 4-4"],
  },
  {
    href: "/account/address",
    label: "Address",
    iconPaths: ["M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z", "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  },
  {
    // Products hearted on the All products page (store/wishlist-store.ts)
    href: "/account/wishlist",
    label: "Wishlist",
    iconPaths: ["M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z"],
  },
  {
    href: "/account/offers",
    label: "Offers",
    iconPaths: ["M3 12V4h8l10 10-8 8L3 12Z", "M7.5 7.5h.01"],
  },
  {
    href: "/account/help",
    label: "Help",
    iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4", "M12 17h.01"],
  },
];

// "Good morning" before 12, "Good afternoon" before 5 PM, then "Good evening" (the visitor's own clock).
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  return "Good evening,";
}

export default function AccountDashboardLayout({ children }: { children: ReactNode }) {
  const isLoggedIn = useIsLoggedIn();
  const isLoginStatusKnown = useIsLoginStatusKnown();
  // Owner, admin or manager: they get the "Chiranvi Panel" button
  const staffAccess = useCurrentStaffAccess();
  // Delivery agents: they get the "Delivery Panel" button instead
  const isDeliveryAgent = useIsDeliveryAgent();
  const accountProfile = useAccountProfile();
  // Orders still on their way: the yellow badge next to "Orders" (design); hidden when there are none.
  const activeOrderCount = countActiveOrders(useOrders());
  // Status changes since My Orders was last opened: "New" next to "Orders"; opening My Orders clears it
  const orderUpdateCount = useOrderUpdates().length;
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/account/orders" && orderUpdateCount > 0) markOrderUpdatesSeen();
  }, [pathname, orderUpdateCount]);
  const router = useRouter();
  // True after Logout, so the dashboard goes to the home page instead of asking for the login.
  const isLoggingOutRef = useRef(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);

  // Not logged in: log in first, then come back to this page. Waits until the saved login has been read.
  useEffect(() => {
    if (!isLoginStatusKnown || isLoggedIn || isLoggingOutRef.current) return;
    rememberPageAfterLogin(pathname);
    router.replace("/login");
  }, [isLoginStatusKnown, isLoggedIn, pathname, router]);

  /*
    Phones and tablets: like the Chiranvi Panel, a bar with ☰ and the open page; ☰ slides the sidebar in from the
    left as a menu (closes on a page link, the dimmed page, ✕ or Escape; the page behind does not scroll meanwhile).
  */
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMenuOpen]);
  const currentPage = accountPages.find((accountPage) => accountPage.href === pathname);

  // choice: this device only, or every device logged in with this number
  function logOutAndGoHome(choice: LogoutChoice) {
    isLoggingOutRef.current = true;
    setIsLogoutDialogOpen(false);
    // The cart stays saved with the account (store/account-state.ts); this browser forgets it at logout
    logOut(choice);
    forgetAllOrders();
    router.push("/");
  }

  return (
    <div className={styles["account-page"]}>
      <LandingZoomAndLayoutRunner />

      {/* Navigation bar, placed exactly like on the landing page */}
      <SiteNavigationPlacement />

      {isLoggedIn && (
        <div className={styles["account-page-body"]}>
          {/* Phones and tablets only: ☰, the open page, and the customer's initials */}
          <div className={styles["account-mobile-bar"]}>
            <button
              type="button"
              className={styles["account-mobile-menu-button"]}
              aria-label="Open the account menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              {orderUpdateCount > 0 && <span className={styles["account-mobile-menu-dot"]} aria-hidden="true" />}
            </button>
            <p className={styles["account-mobile-bar-page"]}>
              <span className={styles["account-mobile-bar-label"]}>My account</span>
              <span className={styles["account-mobile-bar-current"]}>{currentPage?.label ?? "Profile"}</span>
            </p>
            <span className={styles["account-sidebar-avatar"]} aria-hidden="true">
              {getNameInitials(accountProfile.fullName)}
            </span>
          </div>

          {isMenuOpen && <div className={styles["account-sidebar-backdrop"]} onClick={() => setIsMenuOpen(false)} aria-hidden="true" />}

          <aside className={`${styles["account-sidebar"]} ${isMenuOpen ? styles["account-sidebar-open"] : ""}`}>
            <div className={styles["account-sidebar-greeting"]}>
              <span className={styles["account-sidebar-avatar"]} aria-hidden="true">
                {getNameInitials(accountProfile.fullName)}
              </span>
              <p>
                <span className={styles["account-sidebar-greeting-text"]}>{getGreeting()}</span>
                <span className={styles["account-sidebar-name"]}>{accountProfile.fullName.split(" ")[0]}</span>
              </p>
              {/* Menu only: closes it */}
              <button type="button" className={styles["account-sidebar-close"]} aria-label="Close the menu" onClick={() => setIsMenuOpen(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <nav aria-label="My account" className={styles["account-sidebar-links"]}>
              {accountPages.map((accountPage, pageIndex) => {
                const isCurrentPage = pathname === accountPage.href;
                return (
                  <Fragment key={accountPage.href}>
                  {/* Menu only: the group names, as in the Chiranvi Panel */}
                  {pageIndex === 0 && <p className={styles["account-sidebar-group-title"]}>My account</p>}
                  {accountPage.href === "/account/wishlist" && <p className={styles["account-sidebar-group-title"]}>More</p>}
                  <Link
                    href={accountPage.href}
                    aria-current={isCurrentPage ? "page" : undefined}
                    className={`${styles["account-sidebar-link"]} ${
                      isCurrentPage ? styles["account-sidebar-link-current"] : ""
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className={styles["account-sidebar-link-icon"]} aria-hidden="true">
                      {accountPage.iconPaths.map((iconPath) => (
                        <path key={iconPath} d={iconPath} />
                      ))}
                    </svg>
                    {accountPage.label}
                    {accountPage.href === "/account/orders" && orderUpdateCount > 0 && (
                      <span className={styles["account-sidebar-link-new"]} aria-label="New order updates">
                        New
                      </span>
                    )}
                    {accountPage.href === "/account/orders" && activeOrderCount > 0 && (
                      <span className={styles["account-sidebar-link-badge"]} aria-label={`${activeOrderCount} active`}>
                        {activeOrderCount}
                      </span>
                    )}
                  </Link>
                  </Fragment>
                );
              })}
            </nav>

            {/* Menu only: the group name over the panel buttons */}
            {(staffAccess || isDeliveryAgent) && <p className={styles["account-sidebar-group-title"]}>Work</p>}

            {/* Owner, admins and managers: open the admin panel */}
            {staffAccess && (
              <Link href="/admin" className={styles["account-sidebar-panel-link"]}>
                <svg viewBox="0 0 24 24" className={styles["account-sidebar-link-icon"]} aria-hidden="true">
                  <path d="M4 4h7v7H4z" />
                  <path d="M13 4h7v4h-7z" />
                  <path d="M13 10h7v10h-7z" />
                  <path d="M4 13h7v7H4z" />
                </svg>
                Chiranvi Panel
              </Link>
            )}

            {/* Delivery agents: open the Delivery Panel */}
            {isDeliveryAgent && (
              <Link href="/delivery" className={styles["account-sidebar-panel-link"]}>
                <svg viewBox="0 0 24 24" className={styles["account-sidebar-link-icon"]} aria-hidden="true">
                  <path d="M2.5 6.5h11v9.5h-11z" />
                  <path d="M13.5 9.5h4l3.5 3.5v3h-7.5" />
                  <path d="M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                  <path d="M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                </svg>
                Delivery Panel
              </Link>
            )}

            {/* Light red while the "Log out?" box is open (design) */}
            <button
              type="button"
              aria-haspopup="dialog"
              className={`${styles["account-sidebar-logout-button"]} ${
                isLogoutDialogOpen ? styles["account-sidebar-logout-button-active"] : ""
              }`}
              onClick={() => setIsLogoutDialogOpen(true)}
            >
              <svg viewBox="0 0 24 24" className={styles["account-sidebar-link-icon"]} aria-hidden="true">
                <path d="M10 4H5v16h5" />
                <path d="M14 8l4 4-4 4M18 12H9" />
              </svg>
              Logout
            </button>
          </aside>

          <main className={styles["account-page-content"]}>{children}</main>
        </div>
      )}

      {isLogoutDialogOpen && (
        <LogoutConfirmationDialog onCancel={() => setIsLogoutDialogOpen(false)} onConfirm={logOutAndGoHome} />
      )}
    </div>
  );
}

// Page title and the grey line under it, at the top of every dashboard page.
export function AccountPageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles["account-page-heading-row"]}>
      <div>
        <h1 className={styles["account-page-title"]}>{title}</h1>
        <p className={styles["account-page-description"]}>{description}</p>
      </div>
      {action}
    </div>
  );
}
