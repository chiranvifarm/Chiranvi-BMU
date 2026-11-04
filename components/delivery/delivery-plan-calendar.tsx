"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reloadTodayDeliveries } from "@/store/admin-deliveries-store";
import { useAssignedPlans, type AssignedPlan } from "@/store/delivery-agent-store";
import { deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-plan-calendar.module.css";

/*
  Deliveries → Subscriptions: the calendar of each milk plan a manager gave this agent (my_assigned_plans(),
  supabase/migrations/0035_… and 0036_…sql). The customers are listed; clicking one shows their calendar. It
  opens on the running month; the arrows go to the month before or after.
  Each day is a box like the customer's Delivery calendar (weekday over the date): delivered light green, today
  pale yellow, upcoming grey, not delivered red, approved skips and pauses darker grey with the word.
  Under the calendar: "Deliver today's milk", the time to deliver before (the customer's stop's slot, set on the
  panel) and Delivered, which the database saves for the customer and the panel (mark_plan_day_delivered()).
  A skipped or paused customer shows when the next delivery is instead (also on Ongoing: PlanDayNotices).
*/

type DayState = "upcoming" | "today" | "delivered" | "missed" | "skipped" | "paused" | "none";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LEGEND: { state: DayState; label: string }[] = [
  { state: "delivered", label: "Delivered" },
  { state: "missed", label: "Not delivered" },
  { state: "today", label: "Today" },
  { state: "upcoming", label: "Upcoming" },
  { state: "skipped", label: "Skipped or paused" },
];

// Said in the box, as colours alone don't tell these apart
const DAY_WORDS: Partial<Record<DayState, string>> = { skipped: "Skipped", paused: "Paused", missed: "Missed" };

function dayKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function stateOf(plan: AssignedPlan, dayKey: string, todayKey: string): DayState {
  if (plan.stops[dayKey] === "Delivered") return "delivered";
  if (dayKey < plan.firstDay || dayKey > plan.lastDay) return dayKey === todayKey ? "today" : "none";
  if (plan.skips.includes(dayKey)) return "skipped";
  if (plan.pauses.some((pause) => dayKey >= pause.from && dayKey < pause.to)) return "paused";
  if (dayKey === todayKey) return "today";
  return dayKey < todayKey ? "missed" : "upcoming";
}

// "6 Nov": the first day from tomorrow that isn't skipped or paused
function nextDeliveryOf(plan: AssignedPlan, today: Date, todayKey: string) {
  const day = new Date(today);
  for (let tries = 0; tries < 400; tries++) {
    day.setDate(day.getDate() + 1);
    const dayKey = dayKeyOf(day);
    if (dayKey > plan.lastDay) return null;
    if (stateOf(plan, dayKey, todayKey) === "upcoming") return day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return null;
}

// Ongoing: customers not to deliver to today, and when their next delivery is
export function PlanDayNotices() {
  const { plans } = useAssignedPlans();
  const [today] = useState(() => new Date());
  const todayKey = dayKeyOf(today);
  const away = (plans ?? []).filter((plan) => ["skipped", "paused"].includes(stateOf(plan, todayKey, todayKey)));
  if (away.length === 0) return null;
  return (
    <ul className={styles["plan-day-notices"]}>
      {away.map((plan) => (
        <li key={plan.orderNumber} className={styles["plan-day-away"]}>
          <AwayText plan={plan} today={today} todayKey={todayKey} withName />
        </li>
      ))}
    </ul>
  );
}

function AwayText({ plan, today, todayKey, withName }: { plan: AssignedPlan; today: Date; todayKey: string; withName?: boolean }) {
  const next = nextDeliveryOf(plan, today, todayKey);
  const what = stateOf(plan, todayKey, todayKey) === "skipped" ? "Skipped today" : "Paused";
  return (
    <>
      {withName ? `${plan.customerName}: ` : ""}
      {what}. {next ? `Next delivery from ${next}.` : "No more deliveries on this plan."}
    </>
  );
}

export default function DeliveryPlanCalendar() {
  const { stops } = useDeliveryPanel();
  const { plans, hasProblem, loadPlans } = useAssignedPlans();
  const [chosenOrder, setChosenOrder] = useState<string | null>(null);
  const [today] = useState(() => new Date());
  const [shownMonth, setShownMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const plan = plans?.find((existing) => existing.orderNumber === chosenOrder) ?? plans?.[0];
  const todayKey = dayKeyOf(today);
  const todayState = plan ? stateOf(plan, todayKey, todayKey) : "none";
  const isDeliveryDay = Boolean(plan) && todayKey >= (plan?.firstDay ?? "") && todayKey <= (plan?.lastDay ?? "");
  // Blank boxes before the 1st (weeks start on Monday), then each day of the month
  const blanks = (shownMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => new Date(shownMonth.getFullYear(), shownMonth.getMonth(), index + 1));
  // "6–7 AM" → "7 AM": the end of the slot set on the panel
  const deliverBefore = plan?.slot.split("–").pop()?.trim() || "7 AM";

  function moveMonth(change: number) {
    setShownMonth((month) => new Date(month.getFullYear(), month.getMonth() + change, 1));
  }

  async function markDelivered() {
    if (!plan) return;
    setIsSaving(true);
    setProblem("");
    const { error } = await createClient().rpc("mark_plan_day_delivered", { plan_order: plan.orderNumber });
    if (error) setProblem(error.message || "Couldn't save it. Please try again.");
    await loadPlans();
    await reloadTodayDeliveries();
    setIsSaving(false);
  }

  return (
    <section className={styles["plan-calendar-card"]} aria-labelledby="plan-calendar-heading">
      <h2 id="plan-calendar-heading" className={styles["plan-calendar-heading"]}>
        Customer calendars
      </h2>
      <p className={styles["plan-calendar-note"]}>The milk plans your manager gave you. Choose a customer to see their deliveries.</p>

      {hasProblem && <p className={styles["plan-calendar-note"]}>Couldn&rsquo;t read your plans. Please try again.</p>}
      {plans?.length === 0 && !hasProblem && <p className={styles["plan-calendar-empty"]}>No milk plans given to you yet.</p>}

      {plan && (
        <div className={styles["plan-calendar-columns"]}>
          <ul className={styles["plan-calendar-customers"]}>
            {plans?.map((existing) => (
              <li key={existing.orderNumber}>
                <button
                  type="button"
                  aria-pressed={existing.orderNumber === plan.orderNumber}
                  className={`${styles["plan-calendar-customer"]} ${existing.orderNumber === plan.orderNumber ? styles["plan-calendar-customer-chosen"] : ""}`}
                  onClick={() => {
                    setChosenOrder(existing.orderNumber);
                    setProblem("");
                  }}
                >
                  <span className={styles["plan-calendar-customer-name"]}>{existing.customerName}</span>
                  <span className={styles["plan-calendar-customer-detail"]}>
                    {existing.milk} · {existing.bottles}
                    {existing.area ? ` · ${existing.area}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className={styles["plan-calendar-month-area"]}>
            <div className={styles["plan-calendar-month-row"]}>
              <button type="button" className={styles["plan-calendar-arrow"]} aria-label="Month before" onClick={() => moveMonth(-1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <p className={styles["plan-calendar-month-name"]} aria-live="polite">
                {shownMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </p>
              <button type="button" className={styles["plan-calendar-arrow"]} aria-label="Month after" onClick={() => moveMonth(1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>

            <div className={styles["plan-calendar-grid"]}>
              {Array.from({ length: blanks }, (_, index) => (
                <span key={`blank-${index}`} aria-hidden="true" />
              ))}
              {days.map((day) => {
                const dayKey = dayKeyOf(day);
                const state = stateOf(plan, dayKey, todayKey);
                return (
                  <span
                    key={dayKey}
                    title={LEGEND.find((item) => item.state === state)?.label}
                    className={`${styles["plan-calendar-day"]} ${styles[`plan-calendar-day-${state}`]}`}
                  >
                    <span className={styles["plan-calendar-weekday"]}>{WEEKDAYS[(day.getDay() + 6) % 7]}</span>
                    <span className={styles["plan-calendar-date"]}>{day.getDate()}</span>
                    {DAY_WORDS[state] && <span className={styles["plan-calendar-day-word"]}>{DAY_WORDS[state]}</span>}
                  </span>
                );
              })}
            </div>

            <ul className={styles["plan-calendar-legend"]} aria-label="Calendar colours">
              {LEGEND.map((item) => (
                <li key={item.state}>
                  <span className={`${styles["plan-calendar-legend-box"]} ${styles[`plan-calendar-day-${item.state}`]}`} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>

            {/* Today, for this customer */}
            {todayState === "delivered" && <p className={styles["plan-today-done"]}>Delivered today.</p>}
            {(todayState === "skipped" || todayState === "paused") && (
              <p className={styles["plan-day-away"]}>
                <AwayText plan={plan} today={today} todayKey={todayKey} />
              </p>
            )}
            {todayState === "today" && !isDeliveryDay && (
              <p className={styles["plan-calendar-note"]}>
                {todayKey < plan.firstDay ? `Deliveries start on ${new Date(`${plan.firstDay}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "This plan has ended."}
              </p>
            )}
            {todayState === "today" && isDeliveryDay && (
              <div className={styles["plan-today"]}>
                <div>
                  <p className={styles["plan-today-title"]}>Deliver today&rsquo;s milk</p>
                  <p className={styles["plan-today-time"]}>
                    {plan.bottles} {plan.milk} · Deliver before {deliverBefore}
                  </p>
                </div>
                <button type="button" className={deliveryButtonStyles.filled} disabled={isSaving || !stops.isOnDuty} onClick={() => void markDelivered()}>
                  {isSaving ? "Saving…" : "Delivered"}
                </button>
              </div>
            )}
            {problem && (
              <p className={styles["plan-today-problem"]} role="alert">
                {problem}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
