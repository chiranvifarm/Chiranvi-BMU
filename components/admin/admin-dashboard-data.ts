import { useMemo, useState } from "react";
import { useAreTodayDeliveriesLoaded, useTodayDeliveries } from "@/store/admin-deliveries-store";
import { useAreAdminOrdersLoaded, useRealAdminOrders } from "@/store/admin-orders-store";
import { useArePaymentsLoaded, useAdminPayments, type AdminPayment } from "@/store/admin-payments-store";
import { useRealPauseRequests } from "@/store/admin-pause-requests-store";
import { useDeliveryRoutes } from "@/store/admin-routes-store";
import { getPlanEnd, getSubscriptionStatus, useAreSubscriptionsLoaded, useRealSubscriptions } from "@/store/admin-subscriptions-store";
import { useProductPages } from "@/store/product-pages-store";
import { useHaveProductsLoaded, useShopProducts, type ShopProduct } from "@/store/products-store";
import { POWDER_PRODUCT_IDS } from "@/components/product/all-products-page";
import type { ProductPage } from "@/components/product/product-page-data";

/*
  The Chiranvi Panel dashboard's numbers, worked out from the database. The sample records the panel's lists
  still hold are left out (is_sample), so only real orders, plans, pause requests and payments count.
  "This week" is the last seven days with today, "last week" the seven days before them.
  Tomorrow's deliveries counts the plans running tomorrow: stops are only made for today.
*/

export type AlertTone = "red" | "amber" | "orange" | "blue";
export type StatIconTone = "green" | "tan" | "blue" | "purple" | "orange" | "red";
export type TrendTone = "up" | "plain" | "bad";

type DashboardAlert = { tone: AlertTone; icon: string[]; title: string; detail: string; action: string; href: string };

type DashboardStat = {
  label: string;
  value: string;
  note: string;
  trend: TrendTone;
  iconTone: StatIconTone;
  icon: string[];
};

// A day counted from today, at midnight
function dayFrom(today: Date, days: number) {
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + days);
  return day;
}

function rupees(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

// The pack and price a product's website page opens on
function packOfPage(page: ProductPage) {
  if (page.kind === "subscription") return { packSize: page.packSize, price: page.price };
  const pack = page.packs.find((onePack) => onePack.packId === page.defaultPackId) ?? page.packs[0];
  return { packSize: pack ? `${pack.label} ${page.cartPackWord}` : "", price: pack?.price ?? 0 };
}

/*
  The products the website sells, the same list as Products & pricing: one card per product page, and the
  powders. Old sample cards the website doesn't have are left out. Empty until the cards have been read.
*/
export function useWebsiteProducts(): ShopProduct[] {
  const cards = useShopProducts();
  const pages = useProductPages();
  const haveLoaded = useHaveProductsLoaded();
  return useMemo(() => {
    if (!haveLoaded) return [];
    const pagesShown = new Set<string>();
    return cards.flatMap((card) => {
      const page = pages.find((onePage) => onePage.panelCardIds?.includes(card.productId) || onePage.slug === card.productId);
      if (!page) return POWDER_PRODUCT_IDS.includes(card.productId) ? [card] : [];
      if (pagesShown.has(page.slug)) return [];
      pagesShown.add(page.slug);
      return [{ ...card, ...packOfPage(page), name: page.name }];
    });
  }, [cards, pages, haveLoaded]);
}

// The alerts that have something to act on (nothing missed, low or waiting: no alert)
export function useDashboardAlerts(): DashboardAlert[] {
  const deliveries = useTodayDeliveries();
  const routes = useDeliveryRoutes();
  const products = useWebsiteProducts();
  const pauseRequests = useRealPauseRequests();

  return useMemo(() => {
    const alerts: DashboardAlert[] = [];

    const missed = deliveries.filter((delivery) => delivery.status === "Missed");
    if (missed.length > 0) {
      const routeNames = [...new Set(missed.map((delivery) => delivery.routeId))].map(
        (routeId) => routes.find((route) => route.id === routeId)?.name ?? routeId,
      );
      alerts.push({
        tone: "red",
        icon: ["M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z", "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
        title: `${missed.length} missed deliver${missed.length === 1 ? "y" : "ies"}`,
        detail: routeNames.join(", "),
        action: "View",
        href: "/admin/deliveries",
      });
    }

    const lowProducts = products.filter((product) => product.stock === "low");
    if (lowProducts.length > 0) {
      const names = [...new Set(lowProducts.map((product) => product.name))];
      alerts.push({
        tone: "orange",
        icon: ["M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"],
        title: `${lowProducts.length} item${lowProducts.length === 1 ? "" : "s"} low in stock`,
        detail: names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "),
        action: "View",
        href: "/admin/products",
      });
    }

    const waitingRequests = pauseRequests.filter((request) => request.status === "Pending").length;
    if (waitingRequests > 0) {
      alerts.push({
        tone: "blue",
        icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M10 9v6", "M14 9v6"],
        title: `${waitingRequests} pause request${waitingRequests === 1 ? "" : "s"}`,
        detail: "Waiting for your answer",
        action: "Review",
        href: "/admin/pause-requests",
      });
    }

    return alerts;
  }, [deliveries, routes, products, pauseRequests]);
}

// Money received on each of the seven days from firstDay; refunds are negative, so they take it back off
function revenueByDay(payments: AdminPayment[], firstDay: Date, today: Date) {
  const offset = Math.round((firstDay.getTime() - dayFrom(today, 0).getTime()) / 86400000);
  return Array.from({ length: 7 }, (_, index) => {
    const from = dayFrom(today, offset + index).getTime();
    const until = dayFrom(today, offset + index + 1).getTime();
    return payments
      .filter((payment) => {
        const paidAt = new Date(payment.paidAt).getTime();
        return payment.status === "Success" && paidAt >= from && paidAt < until;
      })
      .reduce((sum, payment) => sum + payment.amount, 0);
  });
}

// "↑ 8 vs last week", and the colour that goes with it
function changeFromLastWeek(thisWeek: number, lastWeek: number, shownChange: string): { note: string; trend: TrendTone } {
  if (thisWeek === lastWeek) return { note: "Same as last week", trend: "plain" };
  return { note: `${thisWeek > lastWeek ? "↑" : "↓"} ${shownChange} vs last week`, trend: thisWeek > lastWeek ? "up" : "plain" };
}

export function useDashboardNumbers() {
  const [today] = useState(() => new Date());
  const deliveries = useTodayDeliveries();
  const orders = useRealAdminOrders();
  const payments = useAdminPayments();
  const subscriptions = useRealSubscriptions();
  const areDeliveriesLoaded = useAreTodayDeliveriesLoaded();
  const areOrdersLoaded = useAreAdminOrdersLoaded();
  const arePaymentsLoaded = useArePaymentsLoaded();
  const areSubscriptionsLoaded = useAreSubscriptionsLoaded();

  return useMemo(() => {
    const todayStart = dayFrom(today, 0);
    const weekStart = dayFrom(today, -6);
    const lastWeekStart = dayFrom(today, -13);
    const weekEnd = dayFrom(today, 7);
    const isThisWeek = (date: string) => new Date(date) >= weekStart;
    const isLastWeek = (date: string) => new Date(date) >= lastWeekStart && new Date(date) < weekStart;

    const revenueThisWeek = revenueByDay(payments, weekStart, today);
    const revenueLastWeek = revenueByDay(payments, lastWeekStart, today);
    const revenue = revenueThisWeek.reduce((sum, amount) => sum + amount, 0);
    const lastRevenue = revenueLastWeek.reduce((sum, amount) => sum + amount, 0);
    const revenueChange = lastRevenue > 0 ? `${((Math.abs(revenue - lastRevenue) / lastRevenue) * 100).toFixed(1)}%` : rupees(Math.abs(revenue - lastRevenue));

    const delivered = deliveries.filter((delivery) => delivery.status === "Delivered").length;
    const missed = deliveries.filter((delivery) => delivery.status === "Missed").length;
    const pending = deliveries.length - delivered - missed;

    const running = subscriptions.filter((plan) => !plan.cancelledAt && getPlanEnd(plan) >= todayStart);
    const active = running.filter((plan) => getSubscriptionStatus(plan, today) === "Active");
    // Midday tomorrow: past the hour a pause's date falls on
    const tomorrow = dayFrom(today, 1);
    tomorrow.setHours(12);
    const runningTomorrow = running.filter((plan) => getPlanEnd(plan) >= tomorrow && getSubscriptionStatus(plan, tomorrow) === "Active");
    const endingThisWeek = running.filter((plan) => getPlanEnd(plan) < weekEnd);
    const newPlans = running.filter((plan) => isThisWeek(plan.since)).length;
    const cancelled = subscriptions.filter((plan) => plan.cancelledAt && isThisWeek(plan.cancelledAt)).length;
    const paused = subscriptions.filter((plan) => plan.pauseFrom && isThisWeek(plan.pauseFrom) && new Date(plan.pauseFrom) < tomorrow).length;

    const newOrders = orders.filter((order) => isThisWeek(order.placedAt)).length;
    const lastWeekOrders = orders.filter((order) => isLastWeek(order.placedAt)).length;

    const failedPayments = payments.filter((payment) => payment.status === "Failed" && isThisWeek(payment.paidAt));
    const failedAmount = failedPayments.reduce((sum, payment) => sum + Math.abs(payment.amount), 0);

    const cards: (DashboardStat & { isReady: boolean })[] = [
      {
        label: "Tomorrow’s deliveries",
        value: runningTomorrow.length.toLocaleString("en-IN"),
        note: "From plans running tomorrow",
        trend: "plain",
        iconTone: "green",
        icon: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
        isReady: areSubscriptionsLoaded,
      },
      {
        label: "Deliveries today",
        value: `${delivered.toLocaleString("en-IN")} / ${deliveries.length.toLocaleString("en-IN")}`,
        note: deliveries.length > 0 ? `${((delivered / deliveries.length) * 100).toFixed(1)}% done · ${pending} pending` : "No stops today",
        trend: "plain",
        iconTone: "green",
        icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8.5 12.2l2.4 2.4 4.8-4.8"],
        isReady: areDeliveriesLoaded,
      },
      {
        label: "Revenue this week",
        value: rupees(revenue),
        ...changeFromLastWeek(revenue, lastRevenue, revenueChange),
        iconTone: "green",
        icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 7.5h6", "M9 10.5h6", "M11 7.5c2.6 0 2.6 4.5 0 4.5H9l4.5 4.5"],
        isReady: arePaymentsLoaded,
      },
      {
        label: "Plans ending this week",
        value: endingThisWeek.length.toLocaleString("en-IN"),
        note: "In the next 7 days",
        trend: "plain",
        iconTone: "tan",
        icon: ["M4 6h16v14H4z", "M4 10h16", "M8 3.5v4M16 3.5v4", "M12 13v3l2 1"],
        isReady: areSubscriptionsLoaded,
      },
      {
        label: "New orders",
        value: newOrders.toLocaleString("en-IN"),
        ...changeFromLastWeek(newOrders, lastWeekOrders, String(Math.abs(newOrders - lastWeekOrders))),
        iconTone: "blue",
        icon: ["M6 8h12l-1 13H7L6 8Z", "M9 8V6a3 3 0 0 1 6 0v2"],
        isReady: areOrdersLoaded,
      },
      {
        label: "Active subscriptions",
        value: active.length.toLocaleString("en-IN"),
        note: `${newPlans} new this week`,
        trend: newPlans > 0 ? "up" : "plain",
        iconTone: "purple",
        icon: ["M4 8.5h14.5", "M15.5 5.5l3 3-3 3", "M20 15.5H5.5", "M8.5 12.5l-3 3 3 3"],
        isReady: areSubscriptionsLoaded,
      },
      {
        label: "Churn this week",
        value: (paused + cancelled).toLocaleString("en-IN"),
        note: `${paused} paused, ${cancelled} cancelled`,
        trend: "plain",
        iconTone: "orange",
        icon: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M16 11h6"],
        isReady: areSubscriptionsLoaded,
      },
      {
        label: "Failed payments",
        value: failedPayments.length.toLocaleString("en-IN"),
        note: failedPayments.length > 0 ? `${rupees(failedAmount)} to recover` : "None this week",
        trend: failedPayments.length > 0 ? "bad" : "plain",
        iconTone: "red",
        icon: ["M3 6h18v12H3z", "M3 10h18", "M14 13.5l4 4", "M18 13.5l-4 4"],
        isReady: arePaymentsLoaded,
      },
    ];

    // Not read yet: a dash, never a number that isn't true
    const stats: DashboardStat[] = cards.map(({ isReady, ...card }) =>
      isReady ? card : { ...card, value: "—", note: "Loading…", trend: "plain" },
    );
    return { stats, revenueThisWeek, revenueLastWeek };
  }, [today, deliveries, orders, payments, subscriptions, areDeliveriesLoaded, areOrdersLoaded, arePaymentsLoaded, areSubscriptionsLoaded]);
}
