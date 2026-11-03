"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useCurrentStaffAccess, type PanelModule, type PermissionAction } from "@/store/staff-access-store";
import { useNewOrders } from "@/store/admin-orders-store";
import { useNewCustomers } from "@/store/admin-customers-store";
import { useDeliveryTransferNews } from "@/store/admin-deliveries-store";
import { usePanelSeenAt } from "@/store/account-state";
import { dashboardAlerts } from "./admin-dashboard-data";
import AdminDateRangePicker from "./admin-date-range-picker";
import dashboardStyles from "./admin-dashboard.module.css";
import styles from "./admin-shared.module.css";

/*
  Pieces shared by the Chiranvi Panel pages (Orders, Subscriptions, Customers, ...), so every page has the
  same top bar, number cards, filter tabs, page numbers and pop-up forms as the dashboard:
    AdminPageTop      title and line under it; search, notifications bell, the page's main button;
                      Custom range calendar and Export
    AdminStatCards    the row of four number cards with yellow icons
    AdminFilterTabs   the round "All 412 / Delivered 368 / ..." buttons
    AdminPagination   "Showing 1-14 of 412" and the page buttons
    AdminDialog       the pop-up form (New order, Add customer, ...)
    useAdminToast     the short message at the bottom ("Order added")
    downloadCsv       Export: saves rows as a CSV file (opens in Excel / Google Sheets)
  Styles come from the dashboard (admin-dashboard.module.css) and admin-shared.module.css.
*/

/*
  Permissions: AdminFeatureGate (admin-panel-layout.tsx) says which page this is; the shared buttons ask
  useAdminCan whether the person's role may do something there (Roles & permissions):
    New / Add button   Create        Export button   Export
    row menu options   Edit (or Delete for removing)
  Pages use useAdminCan for their own delete buttons, and useIsPanelOwner for the actions only the owner
  can do (OWNER_ONLY_MESSAGE).
*/
const AdminModuleContext = createContext<PanelModule | null>(null);
export const AdminModuleProvider = AdminModuleContext.Provider;

export function useAdminCan(action: PermissionAction) {
  const pageModule = useContext(AdminModuleContext);
  const access = useCurrentStaffAccess();
  if (!access) return false;
  return pageModule ? access.can(pageModule, action) : true;
}

export function useIsPanelOwner() {
  return Boolean(useCurrentStaffAccess()?.isOwner);
}

// Shown when someone other than the owner tries a sensitive action (prices, salaries, big refunds, ...)
export const OWNER_ONLY_MESSAGE = "Only the owner can do this (later it sends a one-time code to the owner's phone)";

// 13 – 19 Oct 2026 (or 28 Sep – 4 Oct 2026 across months)
export function formatDateRange(from: Date, to: Date) {
  const month = (date: Date) => date.toLocaleDateString("en-IN", { month: "short" });
  if (from.toDateString() === to.toDateString()) return `${to.getDate()} ${month(to)} ${to.getFullYear()}`;
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  return sameMonth
    ? `${from.getDate()} – ${to.getDate()} ${month(to)} ${to.getFullYear()}`
    : `${from.getDate()} ${month(from)} – ${to.getDate()} ${month(to)} ${to.getFullYear()}`;
}

export function toDateFileName(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Export: rows (the first is the header) saved as a CSV file
export function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Closes a pop-up on Escape or a click outside the element
function useCloseOnOutside(isOpen: boolean, close: () => void) {
  const areaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function closeOnOutsideClick(event: PointerEvent) {
      if (!areaRef.current?.contains(event.target as Node)) close();
    }
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [isOpen, close]);
  return areaRef;
}

// 5:23 pm today, or 24 Oct, 5:23 pm
function formatNotificationTime(isoTime: string) {
  const time = new Date(isoTime);
  const clock = time.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return time.toDateString() === new Date().toDateString()
    ? clock
    : `${time.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${clock}`;
}

// The most new items listed in the bell (the rest are counted under them)
const NEW_ITEMS_SHOWN = 6;

/*
  The bell next to the search (every panel page and the dashboard): the dot shows while there are new
  website orders or new customers (since their page was last opened, as on the sidebar badges). Its
  pop-up lists them newest first, each opening its page (which marks them seen), then the alerts.
*/
export function AdminNotificationsBell() {
  const [isOpen, setIsOpen] = useState(false);
  const areaRef = useCloseOnOutside(isOpen, () => setIsOpen(false));
  const access = useCurrentStaffAccess();
  // Only what the person's role can open
  const newOrders = useNewOrders();
  const newCustomers = useNewCustomers();
  // Transfers between agents since the Deliveries page was last opened
  const transfersSeenAt = usePanelSeenAt("delivery-transfers");
  const newTransfers = useDeliveryTransferNews().filter((news) => news.event.at > transfersSeenAt);
  const newItems = [
    ...(access?.can("orders", "view") ? newOrders : []).map((order) => ({
      key: `order-${order.orderNumber}`,
      href: "/admin/orders",
      time: order.placedAt,
      title: `New order ${order.orderNumber}`,
      detail: `${order.customerName}${order.area ? ` · ${order.area}` : ""} · ₹${order.amount.toLocaleString("en-IN")}`,
      icon: ["M9 3.5h6v3H9z", "M7 5H5.5v15.5h13V5H17", "M8.5 11.5h7", "M8.5 15.5h5"],
    })),
    ...(access?.can("customers", "view") ? newCustomers : []).map((customer) => ({
      key: `customer-${customer.id}`,
      href: "/admin/customers",
      time: customer.registeredAt ?? "",
      title: `New customer ${customer.name}`,
      detail: `${customer.id}${customer.area ? ` · ${customer.area}` : ""}`,
      icon: ["M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
    })),
    ...(access?.can("deliveries", "view") ? newTransfers : []).map((news) => ({
      key: `transfer-${news.key}`,
      href: "/admin/deliveries",
      time: news.event.at,
      title: `Transfer ${news.event.kind === "transfer-requested" ? "asked" : news.event.kind === "transfer-accepted" ? "accepted" : "declined"}${news.orderNumber ? ` · ${news.orderNumber}` : ""}`,
      detail: `${news.event.fromAgent} → ${news.event.toAgent} · ${news.customerName}`,
      icon: ["M4 8h13l-3-3", "M20 16H7l3 3"],
    })),
  ].sort((first, second) => second.time.localeCompare(first.time));

  return (
    <div ref={areaRef} className={dashboardStyles["admin-popup-anchor"]} data-admin-popup>
      <button
        type="button"
        className={dashboardStyles["admin-bell-button"]}
        aria-label={newItems.length > 0 ? `Notifications, ${newItems.length} new` : "Notifications"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
        </svg>
        {newItems.length > 0 && <span className={dashboardStyles["admin-bell-dot"]} aria-hidden="true" />}
      </button>
      {isOpen && (
        <div className={`${dashboardStyles["admin-popup"]} ${dashboardStyles["admin-notifications"]}`}>
          <p className={dashboardStyles["admin-popup-title"]}>New{newItems.length > 0 ? ` (${newItems.length})` : ""}</p>
          {newItems.length === 0 && <p className={dashboardStyles["admin-notification-empty"]}>No new orders, customers or transfers</p>}
          {newItems.slice(0, NEW_ITEMS_SHOWN).map((item) => (
            <Link key={item.key} href={item.href} className={dashboardStyles["admin-notification-link"]} onClick={() => setIsOpen(false)}>
              <span className={`${dashboardStyles["admin-alert-icon"]} ${dashboardStyles["admin-alert-icon-green"]}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {item.icon.map((path) => (
                    <path key={path} d={path} />
                  ))}
                </svg>
              </span>
              <span>
                <span className={dashboardStyles["admin-alert-title"]}>{item.title}</span>
                <span className={dashboardStyles["admin-alert-detail"]}>
                  {item.detail} · {formatNotificationTime(item.time)}
                </span>
              </span>
            </Link>
          ))}
          {newItems.length > NEW_ITEMS_SHOWN && (
            <p className={dashboardStyles["admin-notification-empty"]}>and {newItems.length - NEW_ITEMS_SHOWN} more</p>
          )}

          <p className={`${dashboardStyles["admin-popup-title"]} ${dashboardStyles["admin-notifications-second-title"]}`}>
            Needs your attention
          </p>
          {dashboardAlerts.map((alert) => (
            <p key={alert.title} className={dashboardStyles["admin-notification"]}>
              <span className={`${dashboardStyles["admin-alert-icon"]} ${dashboardStyles[`admin-alert-icon-${alert.tone}`]}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {alert.icon.map((path) => (
                    <path key={path} d={path} />
                  ))}
                </svg>
              </span>
              <span>
                <span className={dashboardStyles["admin-alert-title"]}>{alert.title}</span>
                <span className={dashboardStyles["admin-alert-detail"]}>{alert.detail}</span>
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminPageTop({
  title,
  description,
  searchText,
  onSearchTextChange,
  searchPlaceholder = "Search...",
  actionLabel,
  onAction,
  today,
  rangeFrom,
  rangeTo,
  onRangeChange,
  onExport,
  beforeExport,
  belowSearch,
  isBellFirst = false,
  headerEnd,
}: {
  title: string;
  description: string;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  searchPlaceholder?: string;
  actionLabel?: string;
  onAction?: () => void;
  today?: Date;
  rangeFrom?: Date;
  rangeTo?: Date;
  onRangeChange?: (from: Date, to: Date) => void;
  onExport?: () => void;
  // Shown just before Export (Products: the owner's "Set delivery charge" button)
  beforeExport?: ReactNode;
  // Shown on the left of the second row instead of nothing (Products: the category tabs)
  belowSearch?: ReactNode;
  // Roles & permissions only: the bell before the search, and the owner's profile chip at the end
  isBellFirst?: boolean;
  headerEnd?: ReactNode;
}) {
  const [isRangePickerOpen, setIsRangePickerOpen] = useState(false);
  // The role decides whether the main (New / Add) button and Export show
  const canCreate = useAdminCan("create");
  const canExport = useAdminCan("export");
  if (!canCreate) onAction = undefined;
  if (!canExport) onExport = undefined;
  const rangeRef = useCloseOnOutside(isRangePickerOpen, () => setIsRangePickerOpen(false));
  const hasRange = today && rangeFrom && rangeTo && onRangeChange;

  return (
    <>
      <div className={dashboardStyles["admin-dashboard-header"]}>
        <div>
          <h1 className={dashboardStyles["admin-dashboard-greeting"]}>{title}</h1>
          <p className={dashboardStyles["admin-dashboard-date"]}>{description}</p>
        </div>

        <div className={dashboardStyles["admin-dashboard-header-tools"]}>
          {isBellFirst && <AdminNotificationsBell />}
          <label className={dashboardStyles["admin-search"]}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              value={searchText}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(changeEvent) => onSearchTextChange(changeEvent.target.value)}
            />
          </label>

          {!isBellFirst && <AdminNotificationsBell />}

          {actionLabel && onAction && (
            <button type="button" className={dashboardStyles["admin-new-order-button"]} onClick={onAction}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {actionLabel}
            </button>
          )}
          {headerEnd}
        </div>
      </div>

      {(hasRange || onExport || beforeExport || belowSearch) && (
        <div className={`${dashboardStyles["admin-dashboard-range-row"]} ${belowSearch ? styles["admin-top-row-with-tabs"] : ""}`}>
          {belowSearch && <div className={styles["admin-top-row-left"]}>{belowSearch}</div>}
          {hasRange && (
            <>
              <div ref={rangeRef} className={dashboardStyles["admin-popup-anchor"]}>
                <button
                  type="button"
                  className={dashboardStyles["admin-range-button"]}
                  aria-expanded={isRangePickerOpen}
                  onClick={() => setIsRangePickerOpen((isOpen) => !isOpen)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6h16v14H4z" />
                    <path d="M4 10h16M8 3.5v4M16 3.5v4" />
                  </svg>
                  Custom range
                </button>
                {isRangePickerOpen && (
                  <AdminDateRangePicker
                    rangeFrom={rangeFrom}
                    rangeTo={rangeTo}
                    today={today}
                    onChooseRange={(from, to) => {
                      onRangeChange(from, to);
                      setIsRangePickerOpen(false);
                    }}
                  />
                )}
              </div>
              <span className={dashboardStyles["admin-range-label"]}>{formatDateRange(rangeFrom, rangeTo)}</span>
            </>
          )}
          {beforeExport}
          {onExport && (
            <button type="button" className={dashboardStyles["admin-export-button"]} onClick={onExport}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
                <path d="M4.5 19.5h15" />
              </svg>
              Export
            </button>
          )}
        </div>
      )}
    </>
  );
}

export type AdminStat = {
  label: string;
  value: string;
  note: string;
  // up: green; plain: grey; bad: red (serious, e.g. failed payments)
  trend: "up" | "plain" | "bad";
  icon: string[];
  // The value is words, not a number (e.g. "Jersey Milk 1 L"): shown smaller
  isTextValue?: boolean;
  // Clickable card (Products: Low stock / Out of stock show those products); isSelected while it is on
  onClick?: () => void;
  isSelected?: boolean;
  clickLabel?: string;
};

export function AdminStatCards({ stats }: { stats: AdminStat[] }) {
  return (
    <ul
      className={dashboardStyles["admin-stats"]}
      style={stats.length !== 4 ? ({ "--admin-stat-count": stats.length } as CSSProperties) : undefined}
    >
      {stats.map((stat) => (
        <li
          key={stat.label}
          className={`${dashboardStyles["admin-stat"]} ${stat.onClick ? styles["admin-stat-clickable"] : ""} ${
            stat.isSelected ? styles["admin-stat-selected"] : ""
          }`}
        >
          {stat.onClick && (
            <button
              type="button"
              className={styles["admin-stat-button"]}
              aria-pressed={Boolean(stat.isSelected)}
              aria-label={stat.clickLabel ?? `Show ${stat.label.toLowerCase()}`}
              onClick={stat.onClick}
            />
          )}
          <span className={dashboardStyles["admin-stat-label"]}>{stat.label}</span>
          <span className={`${dashboardStyles["admin-stat-value"]} ${stat.isTextValue ? styles["admin-stat-value-text"] : ""}`}>
            {stat.value}
          </span>
          <span className={`${dashboardStyles["admin-stat-note"]} ${dashboardStyles[`admin-stat-note-${stat.trend}`]}`}>
            {stat.note}
          </span>
          <span className={`${dashboardStyles["admin-stat-icon"]} ${dashboardStyles["admin-stat-icon-green"]}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {stat.icon.map((path) => (
                <path key={path} d={path} />
              ))}
            </svg>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AdminFilterTabs<Key extends string>({
  tabs,
  selected,
  onSelect,
  label,
}: {
  tabs: { key: Key; label: string }[];
  selected: Key;
  onSelect: (key: Key) => void;
  label: string;
}) {
  return (
    <div className={styles["admin-filter-tabs"]} role="group" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === selected}
          className={`${styles["admin-filter-tab"]} ${tab.key === selected ? styles["admin-filter-tab-selected"] : ""}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Page numbers: first, the current one and its neighbours, last, with "..." in the gaps
export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemName,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  itemName: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const shownPages = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount)
    .sort((a, b) => a - b);

  return (
    <div className={styles["admin-pagination"]}>
      <p className={styles["admin-pagination-summary"]}>
        Showing {first}–{last} of {total.toLocaleString("en-IN")} {itemName}
      </p>
      <div className={styles["admin-pagination-buttons"]}>
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          className={styles["admin-pagination-button"]}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {shownPages.map((pageNumber, index) => (
          <span key={pageNumber} className={styles["admin-pagination-group"]}>
            {index > 0 && pageNumber - shownPages[index - 1] > 1 && (
              <span className={styles["admin-pagination-gap"]}>…</span>
            )}
            <button
              type="button"
              aria-current={pageNumber === page ? "page" : undefined}
              className={`${styles["admin-pagination-button"]} ${pageNumber === page ? styles["admin-pagination-button-current"] : ""}`}
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          className={styles["admin-pagination-button"]}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

// Pop-up form over the page (darkened behind); Escape or Cancel closes it. isDanger: a red main button
// (deleting something)
export function AdminDialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  children,
  isDanger = false,
  isLarge = false,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  children: ReactNode;
  isDanger?: boolean;
  isLarge?: boolean; // a wider pop-up (an order's details, choosing an agent)
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className={styles["admin-dialog-backdrop"]} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${styles["admin-dialog"]} ${isLarge ? styles["admin-dialog-large"] : ""}`}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          onSubmit();
        }}
      >
        <h2 className={styles["admin-dialog-title"]}>{title}</h2>
        <div className={styles["admin-dialog-fields"]}>{children}</div>
        <div className={styles["admin-dialog-buttons"]}>
          <button type="button" className={styles["admin-dialog-cancel"]} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${styles["admin-dialog-submit"]} ${isDanger ? styles["admin-dialog-submit-danger"] : ""}`}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

// One labelled field inside AdminDialog
export function AdminDialogField({ label, children, isWide }: { label: string; children: ReactNode; isWide?: boolean }) {
  return (
    <label className={`${styles["admin-dialog-field"]} ${isWide ? styles["admin-dialog-field-wide"] : ""}`}>
      <span className={styles["admin-dialog-label"]}>{label}</span>
      {children}
    </label>
  );
}

export const adminInputClassName = styles["admin-dialog-input"];

export function useAdminToast() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const toast = (
    <p className={dashboardStyles["admin-toast"]} role="status" data-visible={message ? "true" : "false"}>
      {message}
    </p>
  );
  return { showToast: setMessage, toast };
}

// The "Actions" button with a small menu of actions for one row
export function AdminRowMenu({
  label,
  title,
  options,
}: {
  label: string;
  title: string;
  // permission: what the role needs for the option (Edit when not given; Delete for removing things)
  options: { label: string; onSelect: () => void; isDisabled?: boolean; isDanger?: boolean; permission?: PermissionAction }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useCloseOnOutside(isOpen, () => setIsOpen(false));
  const canEdit = useAdminCan("edit");
  const canDelete = useAdminCan("delete");
  const canCreate = useAdminCan("create");
  const allowed = { view: true, edit: canEdit, delete: canDelete, create: canCreate, export: true };
  const shownOptions = options.filter((option) => allowed[option.permission ?? "edit"]);
  // Nothing this role can do here: no "Actions" button at all
  if (shownOptions.length === 0) return null;
  return (
    <div ref={menuRef} className={dashboardStyles["admin-popup-anchor"]}>
      <button
        type="button"
        className={dashboardStyles["admin-more-button"]}
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        Actions
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div className={`${dashboardStyles["admin-popup"]} ${dashboardStyles["admin-order-menu"]}`}>
          <p className={dashboardStyles["admin-popup-title"]}>{title}</p>
          {shownOptions.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={option.isDisabled}
              className={option.isDanger ? styles["admin-row-menu-danger"] : undefined}
              onClick={() => {
                option.onSelect();
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
