import { getPlanEnd, getPlanLength, getSubscriptionStatus, PLAN_LENGTHS, type AdminSubscription } from "@/store/admin-subscriptions-store";
import { getCustomerStatus, type AdminCustomer } from "@/store/admin-customers-store";
import { LEAD_SOURCES, LEAD_STAGES, type AdminLead } from "@/store/admin-leads-store";
import { PAYMENT_METHODS, type AdminPayment } from "@/store/admin-payments-store";
import { type AdminOrder } from "@/store/admin-orders-store";
import { type ShopProduct } from "@/store/products-store";
import { type Delivery } from "@/store/admin-deliveries-store";
import { type DeliveryAgent, type DeliveryRoute } from "@/store/admin-routes-store";
import { getDaysPresent, type StaffPerson } from "@/store/admin-staff-store";

/*
  The nine reports on the Reports page (admin-reports-page.tsx), worked out from real data only: the page
  hands them the database's records without the samples. Each report has a few headline numbers and one or
  more tables; View shows them, Export saves them as a CSV file.
  Profit & loss shows what is recorded (revenue, staff salaries): other expenses aren't recorded anywhere, so
  it doesn't work out a profit. Staff attendance and payroll come from the Staff page.
*/

export type ReportKey =
  | "sales"
  | "subscriptions"
  | "deliveries"
  | "customers"
  | "payments"
  | "products"
  | "leads"
  | "profit"
  | "attendance";

export type ReportTable = { title: string; columns: string[]; rows: (string | number)[][] };

export type BuiltReport = {
  headline: { label: string; value: string }[];
  tables: ReportTable[];
  note?: string;
};

export type ReportData = {
  from: Date;
  to: Date;
  orders: AdminOrder[];
  subscriptions: AdminSubscription[]; // the cancelled ones too
  customers: AdminCustomer[];
  leads: AdminLead[];
  payments: AdminPayment[];
  products: ShopProduct[];
  deliveries: Delivery[]; // already limited to the chosen dates
  routes: DeliveryRoute[];
  agents: DeliveryAgent[];
  staff: StaffPerson[];
};

export const REPORTS: { key: ReportKey; title: string; description: string; icon: string[] }[] = [
  { key: "sales", title: "Sales report", description: "Revenue by day, product and area", icon: ["M4 20V10M10 20V4M16 20v-7M21 20H3"] },
  { key: "subscriptions", title: "Subscriptions", description: "New, paused, cancelled, churn", icon: ["M4 8.5h14.5", "M15.5 5.5l3 3-3 3", "M20 15.5H5.5", "M8.5 12.5l-3 3 3 3"] },
  {
    key: "deliveries",
    title: "Delivery performance",
    description: "On-time %, missed, per route",
    icon: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4l3.5 3.5v3h-7.5", "M6.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  },
  { key: "customers", title: "Customers", description: "New, active, lifetime value", icon: ["M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"] },
  { key: "payments", title: "Payments", description: "Collections, refunds, failures", icon: ["M3 6h18v12H3z", "M3 10h18", "M7 14.5h4"] },
  { key: "products", title: "Products", description: "Best sellers, prices, stock", icon: ["M3 12V4h8l10 10-8 8L3 12Z", "M7.5 7.5h.01"] },
  { key: "leads", title: "Leads & conversion", description: "New leads, ordered for someone, converted", icon: ["M10 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M3 20.5a7 7 0 0 1 14 0", "M19 8v6", "M16 11h6"] },
  { key: "profit", title: "Profit & loss", description: "Revenue and recorded expenses", icon: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9 8h6M9 11h6M13 8c2 0 2 6-4 6l5 3"] },
  {
    key: "attendance",
    title: "Staff attendance",
    description: "Days present, leaves, payroll",
    icon: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M3 20a6 6 0 0 1 12 0", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.5a6 6 0 0 1 3 5.5"],
  },
];

export const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "0%");
const dayLabel = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function isInRange(isoDate: string, from: Date, to: Date) {
  const date = new Date(isoDate);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
}

function daysInRange(from: Date, to: Date) {
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

// Totals per name, biggest first
function groupBy<T>(items: T[], keyOf: (item: T) => string, valueOf: (item: T) => number = () => 1) {
  const totals = new Map<string, number>();
  items.forEach((item) => totals.set(keyOf(item), (totals.get(keyOf(item)) ?? 0) + valueOf(item)));
  return [...totals.entries()].sort((first, second) => second[1] - first[1]);
}

export function buildReport(key: ReportKey, data: ReportData): BuiltReport {
  const { from, to } = data;
  const days = daysInRange(from, to);

  switch (key) {
    case "sales": {
      // Milk plans are in the Payments report
      const orders = data.orders.filter((order) => isInRange(order.placedAt, from, to) && order.bottlesPerDay === undefined);
      const sold = orders.filter((order) => order.status !== "Cancelled");
      const revenue = sold.reduce((sum, order) => sum + order.amount, 0);
      const byDay = groupBy(sold, (order) => new Date(order.placedAt).toDateString(), (order) => order.amount).sort(
        (first, second) => new Date(second[0]).getTime() - new Date(first[0]).getTime(),
      );
      const ordersOn = (dayKey: string) => sold.filter((order) => new Date(order.placedAt).toDateString() === dayKey).length;
      return {
        headline: [
          { label: "Revenue", value: rupees(revenue) },
          { label: "Orders", value: sold.length.toLocaleString("en-IN") },
          { label: "Average order", value: rupees(sold.length ? revenue / sold.length : 0) },
          { label: "Cancelled", value: String(orders.length - sold.length) },
        ],
        tables: [
          { title: "Revenue by day", columns: ["Day", "Orders", "Revenue"], rows: byDay.map(([day, total]) => [dayLabel(new Date(day)), ordersOn(day), rupees(total)]) },
          { title: "Revenue by product", columns: ["Items", "Revenue"], rows: groupBy(sold, (order) => order.items, (order) => order.amount).slice(0, 10).map(([items, total]) => [items, rupees(total)]) },
          { title: "Revenue by area", columns: ["Area", "Revenue"], rows: groupBy(sold, (order) => order.area || "Not given", (order) => order.amount).map(([area, total]) => [area, rupees(total)]) },
        ],
        note: "One-time orders. Subscription money is in the Payments report.",
      };
    }

    case "subscriptions": {
      const subscriptions = data.subscriptions.filter((subscription) => !subscription.cancelledAt && getPlanEnd(subscription) >= new Date());
      const active = subscriptions.filter((subscription) => getSubscriptionStatus(subscription) === "Active");
      const paused = subscriptions.length - active.length;
      const started = data.subscriptions.filter((subscription) => isInRange(subscription.since, from, to)).length;
      const weekAgo = Date.now() - 7 * 86400000;
      const cancelled = data.subscriptions.filter((subscription) => subscription.cancelledAt && new Date(subscription.cancelledAt).getTime() > weekAgo).length;
      return {
        headline: [
          { label: "Active", value: active.length.toLocaleString("en-IN") },
          { label: "Paused", value: String(paused) },
          { label: "New in these dates", value: String(started) },
          { label: "Cancelled this week", value: String(cancelled) },
        ],
        tables: [
          {
            title: "By milk",
            columns: ["Milk", "Subscriptions", "Litres a delivery"],
            rows: groupBy(subscriptions, (subscription) => subscription.milkType).map(([milk, count]) => [
              milk,
              count,
              subscriptions
                .filter((subscription) => subscription.milkType === milk)
                .reduce((sum, subscription) => sum + subscription.litresPerDelivery, 0)
                .toFixed(1),
            ]),
          },
          {
            title: "By plan",
            columns: ["Plan", "Subscriptions"],
            rows: PLAN_LENGTHS.map((plan) => [plan, subscriptions.filter((subscription) => getPlanLength(subscription) === plan).length]),
          },
        ],
        note: `Churn this week: ${percent(cancelled, subscriptions.length + cancelled)} of subscriptions cancelled.`,
      };
    }

    case "deliveries": {
      const deliveries = data.deliveries;
      const delivered = deliveries.filter((delivery) => delivery.status === "Delivered");
      const onTime = delivered.filter((delivery) => delivery.deliveredAt && new Date(delivery.deliveredAt).getHours() < 8).length;
      const missed = deliveries.filter((delivery) => delivery.status === "Missed").length;
      return {
        headline: [
          { label: "Stops", value: deliveries.length.toLocaleString("en-IN") },
          { label: "Delivered", value: delivered.length.toLocaleString("en-IN") },
          { label: "On time (before 8 AM)", value: percent(onTime, delivered.length) },
          { label: "Missed", value: String(missed) },
        ],
        tables: [
          {
            title: "Per route",
            columns: ["Route", "Area", "Stops", "Delivered", "Missed", "On time"],
            rows: data.routes.map((route) => {
              const onRoute = deliveries.filter((delivery) => delivery.routeId === route.id);
              const routeDelivered = onRoute.filter((delivery) => delivery.status === "Delivered");
              const routeOnTime = routeDelivered.filter((delivery) => delivery.deliveredAt && new Date(delivery.deliveredAt).getHours() < 8).length;
              return [
                route.name,
                route.area,
                onRoute.length,
                routeDelivered.length,
                onRoute.filter((delivery) => delivery.status === "Missed").length,
                percent(routeOnTime, routeDelivered.length),
              ];
            }),
          },
        ],
      };
    }

    case "customers": {
      const customers = data.customers;
      const countOf = (status: string) => customers.filter((customer) => getCustomerStatus(customer) === status).length;
      const newCustomers = customers.filter((customer) => customer.joinedDaysAgo < days).length;
      const lifetime = customers.reduce((sum, customer) => sum + customer.lifetimeValue, 0);
      return {
        headline: [
          { label: "Customers", value: customers.length.toLocaleString("en-IN") },
          { label: "Active", value: countOf("Active").toLocaleString("en-IN") },
          { label: `New (last ${days} days)`, value: String(newCustomers) },
          { label: "Average lifetime value", value: rupees(customers.length ? lifetime / customers.length : 0) },
        ],
        tables: [
          {
            title: "Top customers",
            columns: ["Customer", "Area", "Plan", "Orders", "Lifetime value"],
            rows: [...customers]
              .sort((first, second) => second.lifetimeValue - first.lifetimeValue)
              .slice(0, 10)
              .map((customer) => [customer.name, customer.area, customer.plan, customer.orderCount, rupees(customer.lifetimeValue)]),
          },
          {
            title: "By area",
            columns: ["Area", "Customers"],
            rows: groupBy(customers, (customer) => customer.area),
          },
        ],
        note: `${countOf("Paused")} paused · ${countOf("Inactive")} inactive (no order in over 30 days).`,
      };
    }

    case "payments": {
      const payments = data.payments.filter((payment) => isInRange(payment.paidAt, from, to));
      const successful = payments.filter((payment) => payment.status === "Success");
      const collected = successful.filter((payment) => payment.amount > 0).reduce((sum, payment) => sum + payment.amount, 0);
      const refunded = -successful.filter((payment) => payment.amount < 0).reduce((sum, payment) => sum + payment.amount, 0);
      const failed = payments.filter((payment) => payment.status === "Failed");
      return {
        headline: [
          { label: "Collected", value: rupees(collected) },
          { label: "Refunded", value: rupees(refunded) },
          { label: "Failed payments", value: String(failed.length) },
          { label: "Failed amount", value: rupees(failed.reduce((sum, payment) => sum + Math.abs(payment.amount), 0)) },
        ],
        tables: [
          {
            title: "By method",
            columns: ["Method", "Payments", "Collected"],
            rows: PAYMENT_METHODS.map((method) => {
              const byMethod = successful.filter((payment) => payment.method === method && payment.amount > 0);
              return [method, byMethod.length, rupees(byMethod.reduce((sum, payment) => sum + payment.amount, 0))];
            }),
          },
          {
            title: "By type",
            columns: ["Type", "Payments", "Amount"],
            rows: groupBy(successful, (payment) => payment.type, (payment) => payment.amount).map(([type, total]) => [
              type,
              successful.filter((payment) => payment.type === type).length,
              rupees(total),
            ]),
          },
        ],
      };
    }

    case "products": {
      const products = data.products;
      // What was really sold in these dates, from the orders' items
      const sold = new Map<string, { name: string; packSize: string; units: number; sales: number }>();
      for (const order of data.orders) {
        if (order.status === "Cancelled" || !isInRange(order.placedAt, from, to)) continue;
        for (const item of order.itemList ?? []) {
          const key = `${item.name}|${item.packSize}`;
          const line = sold.get(key) ?? { name: item.name, packSize: item.packSize, units: 0, sales: 0 };
          sold.set(key, { ...line, units: line.units + item.quantity, sales: line.sales + item.quantity * item.price });
        }
      }
      const bestSellers = [...sold.values()].sort((first, second) => second.units - first.units);
      return {
        headline: [
          { label: "Products", value: String(products.length) },
          { label: "Best seller", value: bestSellers[0] ? `${bestSellers[0].name} ${bestSellers[0].packSize}` : "No sales yet" },
          { label: "Low stock", value: String(products.filter((product) => product.stock === "low").length) },
          { label: "Out of stock", value: String(products.filter((product) => product.stock === "out").length) },
        ],
        tables: [
          {
            title: "Sold in these dates",
            columns: ["Product", "Pack", "Units sold", "Sales"],
            rows: bestSellers.map((line) => [line.name, line.packSize, line.units, rupees(line.sales)]),
          },
          {
            title: "Prices and stock",
            columns: ["Product", "Pack", "Price", "Stock"],
            rows: products.map((product) => [
              product.name,
              product.packSize,
              rupees(product.price),
              product.stock === "in" ? "In stock" : product.stock === "low" ? "Low stock" : "Out of stock",
            ]),
          },
        ],
        note: "A milk plan counts all the bottles of the plan.",
      };
    }

    case "leads": {
      const leads = data.leads.filter((lead) => isInRange(lead.createdAt, from, to));
      const converted = leads.filter((lead) => lead.stage === "converted").length;
      return {
        headline: [
          { label: "New leads", value: String(leads.length) },
          { label: "Ordered for someone", value: String(leads.filter((lead) => lead.kind === "ordered-for").length) },
          { label: "Converted", value: String(converted) },
          { label: "Conversion", value: percent(converted, leads.length) },
        ],
        tables: [
          { title: "By stage", columns: ["Stage", "Leads"], rows: LEAD_STAGES.map((stage) => [stage.label, leads.filter((lead) => lead.stage === stage.key).length]) },
          {
            title: "By source",
            columns: ["Source", "Leads", "Converted", "Conversion"],
            rows: LEAD_SOURCES.map((source) => {
              const fromSource = leads.filter((lead) => lead.source === source);
              const sourceConverted = fromSource.filter((lead) => lead.stage === "converted").length;
              return [source, fromSource.length, sourceConverted, percent(sourceConverted, fromSource.length)];
            }),
          },
        ],
      };
    }

    case "profit": {
      const revenue = data.payments
        .filter((payment) => isInRange(payment.paidAt, from, to) && payment.status === "Success")
        .reduce((sum, payment) => sum + payment.amount, 0);
      // The month's salaries, for the days chosen
      const salaries = (data.staff.reduce((sum, person) => sum + person.salary, 0) / 30) * days;
      return {
        headline: [
          { label: "Revenue", value: rupees(revenue) },
          { label: "Staff salaries", value: rupees(salaries) },
          { label: "Profit", value: "Not known yet" },
          { label: "Margin", value: "Not known yet" },
        ],
        tables: [
          {
            title: "Recorded expenses",
            columns: ["Expense", "Amount", "Share of revenue"],
            rows: [["Staff salaries", rupees(salaries), percent(salaries, revenue)]],
          },
        ],
        note: "Revenue is all money collected less refunds. Milk, packaging, fuel and other costs aren't recorded in the panel, so profit can't be worked out yet.",
      };
    }

    case "attendance": {
      // This month so far, from the Staff page
      const today = new Date();
      const present = data.staff.filter((person) => person.today === "Present").length;
      return {
        headline: [
          { label: "Team", value: String(data.staff.length) },
          { label: "Present today", value: `${present} of ${data.staff.length}` },
          { label: "Days so far this month", value: String(today.getDate()) },
          { label: "Payroll this month", value: rupees(data.staff.reduce((sum, person) => sum + person.salary, 0)) },
        ],
        tables: [
          {
            title: "This month",
            columns: ["Name", "Job", "Today", "Days present", "Days absent / leave", "Attendance", "Salary"],
            rows: data.staff.map((person) => {
              const daysPresent = getDaysPresent(person, today);
              return [
                person.name,
                person.job,
                person.today,
                daysPresent,
                today.getDate() - daysPresent,
                percent(daysPresent, today.getDate()),
                rupees(person.salary),
              ];
            }),
          },
        ],
        note: "Attendance is for this month so far, whatever dates are chosen.",
      };
    }
  }
}

// Export: a report as CSV rows (headline numbers, then each table)
export function reportToCsvRows(title: string, rangeText: string, report: BuiltReport): (string | number)[][] {
  const rows: (string | number)[][] = [[`Chiranvi Farm · ${title}`], [rangeText], []];
  report.headline.forEach(({ label, value }) => rows.push([label, value]));
  report.tables.forEach((table) => {
    rows.push([], [table.title], table.columns, ...table.rows);
  });
  if (report.note) rows.push([], [report.note]);
  return rows;
}
