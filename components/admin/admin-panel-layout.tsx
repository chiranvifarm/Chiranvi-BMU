"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  rememberPageAfterLogin,
  useIsLoginStatusKnown,
  useLoggedInMobileNumber,
} from "@/components/login/login-status";
import { getNameInitials } from "@/components/account/account-profile";
import { useCurrentStaffAccess, useIsStaffAccessKnown, type PanelModule, type StaffAccess } from "@/store/staff-access-store";
import { usePauseRequests } from "@/store/admin-pause-requests-store";
import { useComplaintTickets } from "@/store/admin-complaints-store";
import { useTodayDeliveries } from "@/store/admin-deliveries-store";
import { useNewCustomerCount } from "@/store/admin-customers-store";
import { useNewOrders } from "@/store/admin-orders-store";
import { AdminModuleProvider } from "./admin-shared";
import styles from "./admin-panel.module.css";

/*
  Chiranvi Panel frame (/admin and its pages), from the design (01-dashboard, 1440 wide):
  a white sidebar (248 wide) with the logo, the pages in five groups (Overview, Sales, Operations,
  Business, System) with count badges, and the signed-in person's card at the bottom; the page on the
  right.
  Who can open it (store/staff-access-store.ts): the owner, and people whose role has the panel (set on
  Roles & permissions). Logged-out visitors are sent to the login (and come back here afterwards);
  logged-in customers are sent to their account.
  Phones and tablets (900 wide or less): a top bar with a menu button; the sidebar slides in from the
  left over the page (closes on a page link, the backdrop, the close button or Escape).
  The sidebar only lists the pages the person's role can View; typing the address of another page shows
  a "no access" message instead (AdminFeatureGate below). The gate also tells the page's shared buttons
  (New, Export, row menus) which page they are on, so they hide what the role cannot do.
*/

type PanelPageAccess = PanelModule;

type PanelPage = {
  href: string;
  label: string;
  access: PanelPageAccess;
  iconPaths: string[];
  // Sample counts from the design until real data exists
  badge?: { count: number; tone: "green" | "orange" | "red" };
};

const panelPageGroups: { title: string; pages: PanelPage[] }[] = [
  {
    title: "Overview",
    pages: [
      {
        href: "/admin",
        label: "Dashboard",
        access: "dashboard",
        iconPaths: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
      },
    ],
  },
  {
    title: "Sales",
    pages: [
      {
        href: "/admin/orders",
        label: "Orders",
        access: "orders",
        iconPaths: ["M9 3.5h6v3H9z", "M7 5H5.5v15.5h13V5H17", "M8.5 11.5h7", "M8.5 15.5h5"],
      },
      {
        href: "/admin/subscriptions",
        label: "Subscriptions",
        access: "subscriptions",
        iconPaths: ["M4 8.5h14.5", "M15.5 5.5l3 3-3 3", "M20 15.5H5.5", "M8.5 12.5l-3 3 3 3"],
      },
      {
        href: "/admin/pay-later",
        label: "Pay later",
        access: "subscriptions",
        iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3 2"],
      },
      {
        href: "/admin/pause-requests",
        label: "Pause requests",
        access: "pause-requests",
        badge: { count: 5, tone: "orange" },
        iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M10 9v6", "M14 9v6"],
      },
      {
        href: "/admin/customers",
        label: "Customers",
        access: "customers",
        iconPaths: ["M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
      },
      {
        href: "/admin/leads",
        label: "Leads",
        access: "leads",
        iconPaths: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M19 8v6", "M16 11h6"],
      },
      {
        href: "/admin/payments",
        label: "Payments",
        access: "payments",
        iconPaths: ["M3 6h18v12H3z", "M3 10h18", "M7 14.5h4"],
      },
      {
        href: "/admin/refunds",
        label: "Refunds & complaints",
        access: "refunds",
        badge: { count: 2, tone: "red" },
        iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M16 12H8.5", "M11.5 9l-3 3 3 3"],
      },
    ],
  },
  {
    title: "Operations",
    pages: [
      {
        href: "/admin/products",
        label: "Products & pricing",
        access: "products",
        iconPaths: ["M3 12V4h8l10 10-8 8L3 12Z", "M7.5 7.5h.01"],
      },
      {
        href: "/admin/deliveries",
        label: "Deliveries",
        access: "deliveries",
        badge: { count: 4, tone: "green" },
        iconPaths: [
          "M2.5 6.5h11v9.5h-11z",
          "M13.5 9.5h4l3.5 3.5v3h-7.5",
          "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
          "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
        ],
      },
      {
        href: "/admin/routes",
        label: "Routes & agents",
        access: "routes",
        iconPaths: ["M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z", "M9 4v14", "M15 6v14"],
      },
    ],
  },
  {
    title: "Business",
    pages: [
      {
        href: "/admin/reports",
        label: "Reports",
        access: "reports",
        iconPaths: ["M4 20.5h16", "M6.5 17v-5", "M10.5 17V7.5", "M14.5 17V10", "M18.5 17V5"],
      },
      {
        href: "/admin/staff",
        label: "Staff",
        access: "staff",
        iconPaths: [
          "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
          "M3 20a6 6 0 0 1 12 0",
          "M16.5 4.3a3.5 3.5 0 0 1 0 6.4",
          "M18 14.5a6 6 0 0 1 3 5.5",
        ],
      },
      {
        href: "/admin/coupons",
        label: "Coupons & offers",
        access: "coupons",
        iconPaths: ["M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z", "M10 7v2", "M10 11v2", "M10 15v2"],
      },
    ],
  },
  {
    title: "System",
    pages: [
      {
        href: "/admin/roles",
        label: "Roles & permissions",
        access: "roles",
        iconPaths: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z", "M8.5 12l2.5 2.5L16 9.5"],
      },
    ],
  },
];

// The line under the person's name in the sidebar card (design: "Owner, full access")
function roleAccessLine(access: StaffAccess) {
  return access.isOwner ? "Owner, full access" : access.roleName;
}

// A page opens when the person's role can View it
function canOpenPanelPage(access: StaffAccess, pageAccess: PanelPageAccess) {
  return access.can(pageAccess, "view");
}

export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const mobileNumber = useLoggedInMobileNumber();
  const staffAccess = useCurrentStaffAccess();
  const isStaffAccessKnown = useIsStaffAccessKnown();
  const pathname = usePathname();
  const router = useRouter();
  // Live counts: new orders and customers, pause requests waiting, open high-priority complaints and
  // today's missed deliveries (the others are samples)
  const waitingPauseRequests = usePauseRequests().filter((request) => request.status === "Pending").length;
  const urgentComplaints = useComplaintTickets().filter(
    (ticket) => ticket.status === "Open" && ticket.priority === "High",
  ).length;
  const missedDeliveries = useTodayDeliveries().filter((delivery) => delivery.status === "Missed").length;
  // Customers who signed up on the website since the Customers page was last opened
  const newCustomers = useNewCustomerCount();
  // Website orders placed since the Orders page was last opened
  const newOrders = useNewOrders().length;
  // Phones and tablets: the sidebar as a slide-in menu
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

  // Logged out: log in first, then come back. Logged-in customers: their account instead (decided only once
  // the team has been read from the database, so staff are not sent away while it loads).
  useEffect(() => {
    if (!isLoginStatusKnown) return;
    if (!mobileNumber) {
      rememberPageAfterLogin(pathname);
      router.replace("/login");
    } else if (isStaffAccessKnown && !staffAccess) {
      router.replace("/account");
    }
  }, [isLoginStatusKnown, isStaffAccessKnown, mobileNumber, staffAccess, pathname, router]);

  if (!isLoginStatusKnown || !mobileNumber || !staffAccess) {
    return <div className={styles["admin-panel-loading"]} aria-busy="true" />;
  }

  const currentPage = panelPageGroups.flatMap((group) => group.pages).find((page) => page.href === pathname);
  const waitingCount = waitingPauseRequests + urgentComplaints + missedDeliveries + newCustomers + newOrders;

  return (
    <div className={styles["admin-panel"]}>
      {/* Phones and tablets only: menu button, logo, the open page's name */}
      <header className={styles["admin-topbar"]}>
        <button
          type="button"
          className={styles["admin-topbar-menu-button"]}
          aria-label="Open the menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          {waitingCount > 0 && <span className={styles["admin-topbar-menu-dot"]} aria-hidden="true" />}
        </button>
        <Link href="/admin" className={styles["admin-topbar-logo"]}>
          <Image src="/images/brand/chiranvi-farm-logo.webp" alt="Chiranvi Panel" width={516} height={240} priority />
        </Link>
        {currentPage && <span className={styles["admin-topbar-page"]}>{currentPage.label}</span>}
      </header>

      {isMenuOpen && <div className={styles["admin-sidebar-backdrop"]} onClick={() => setIsMenuOpen(false)} aria-hidden="true" />}

      <aside className={`${styles["admin-sidebar"]} ${isMenuOpen ? styles["admin-sidebar-open"] : ""}`}>
        <div className={styles["admin-sidebar-top-row"]}>
          <Link href="/" className={styles["admin-sidebar-logo"]}>
            <Image src="/images/brand/chiranvi-farm-logo.webp" alt="Chiranvi Farm" width={516} height={240} priority />
          </Link>
          <button type="button" className={styles["admin-sidebar-close"]} aria-label="Close the menu" onClick={() => setIsMenuOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <nav aria-label="Chiranvi Panel" className={styles["admin-sidebar-groups"]}>
          {panelPageGroups.map((group) => {
            const openablePages = group.pages.filter((page) => canOpenPanelPage(staffAccess, page.access));
            if (openablePages.length === 0) return null;
            return (
              <div key={group.title} className={styles["admin-sidebar-group"]}>
                <p className={styles["admin-sidebar-group-title"]}>{group.title}</p>
                {openablePages.map((page) => {
                  const isCurrentPage = pathname === page.href;
                  const liveCount =
                    page.href === "/admin/orders"
                      ? { count: newOrders, tone: "green" as const }
                      : page.href === "/admin/pause-requests"
                      ? { count: waitingPauseRequests, tone: "orange" as const }
                      : page.href === "/admin/refunds"
                        ? { count: urgentComplaints, tone: "red" as const }
                        : page.href === "/admin/deliveries"
                          ? { count: missedDeliveries, tone: "red" as const }
                          : page.href === "/admin/customers"
                            ? { count: newCustomers, tone: "green" as const }
                            : null;
                  const badge = liveCount ? (liveCount.count > 0 ? liveCount : undefined) : page.badge;
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      aria-current={isCurrentPage ? "page" : undefined}
                      className={`${styles["admin-sidebar-link"]} ${
                        isCurrentPage ? styles["admin-sidebar-link-current"] : ""
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className={styles["admin-sidebar-link-icon"]} aria-hidden="true">
                        {page.iconPaths.map((iconPath) => (
                          <path key={iconPath} d={iconPath} />
                        ))}
                      </svg>
                      <span className={styles["admin-sidebar-link-label"]}>{page.label}</span>
                      {badge && (
                        <span
                          className={`${styles["admin-sidebar-badge"]} ${styles[`admin-sidebar-badge-${badge.tone}`]}`}
                          aria-label={`${badge.count} new`}
                        >
                          {badge.count}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* The signed-in person (design: "CF · Farm admin · Owner, full access"); opens their account */}
        <Link href="/account" className={styles["admin-sidebar-person"]} title="Back to my account">
          <span className={styles["admin-sidebar-person-avatar"]} aria-hidden="true">
            {getNameInitials(staffAccess.name)}
          </span>
          <span className={styles["admin-sidebar-person-text"]}>
            <span className={styles["admin-sidebar-person-name"]}>{staffAccess.name}</span>
            <span className={styles["admin-sidebar-person-role"]}>{roleAccessLine(staffAccess)}</span>
          </span>
          <svg viewBox="0 0 24 24" className={styles["admin-sidebar-person-arrow"]} aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </aside>

      <main className={styles["admin-content"]}>{children}</main>
    </div>
  );
}

// Shows the page only to people who were given this feature; everyone else sees "no access".
export function AdminFeatureGate({ feature, children }: { feature: PanelModule; children: ReactNode }) {
  const staffAccess = useCurrentStaffAccess();
  if (!staffAccess) return null;
  if (!canOpenPanelPage(staffAccess, feature)) {
    return (
      <div className={styles["admin-no-access"]}>
        <h1 className={styles["admin-page-title"]}>No access</h1>
        <p className={styles["admin-page-description"]}>
          This part of the Chiranvi Panel has not been given to you. Ask the owner if you need it.
        </p>
        {feature === "dashboard" ? (
          <Link href="/account" className={styles["admin-button-outlined"]}>
            Back to my account
          </Link>
        ) : (
          <Link href="/admin" className={styles["admin-button-outlined"]}>
            Back to dashboard
          </Link>
        )}
      </div>
    );
  }
  return <AdminModuleProvider value={feature}>{children}</AdminModuleProvider>;
}

// Title and short line at the top of every panel page.
export function AdminPageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles["admin-page-heading"]}>
      <h1 className={styles["admin-page-title"]}>{title}</h1>
      <p className={styles["admin-page-description"]}>{description}</p>
    </div>
  );
}
