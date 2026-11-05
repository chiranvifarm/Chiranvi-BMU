"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { reloadTodayDeliveries } from "@/store/admin-deliveries-store";
import { useAssignedPlans, type AssignedPlan } from "@/store/delivery-agent-store";
import { DeliverySheet, deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import ongoingStyles from "./delivery-ongoing-page.module.css";
import styles from "./delivery-plan-calendar.module.css";

/*
  Deliveries → Subscriptions: the calendar of each milk plan a manager gave this agent (my_assigned_plans(),
  supabase/migrations/0035_… and 0036_…sql). Two cards: the customers on the left; clicking one shows that
  customer's own calendar on the right. It opens on the running month; the arrows go to the month before or after.
  Each day is a box like the customer's Delivery calendar (weekday over the date): delivered light green, today
  pale yellow, upcoming white, not delivered red, approved skips and pauses grey with the word.
  Under the calendar: "Deliver today's milk", the time to deliver before (the customer's stop's slot, set on the
  panel) and Mark as delivered, which asks for the customer's OTP (the same 4-digit box as Ongoing) and then the
  database saves it for the customer and the panel (mark_plan_day_delivered()). Once delivered, the button stays
  as a greyed-out Delivered.
  A skipped or paused customer shows when the next delivery is instead (also on Ongoing: PlanDayNotices).
  A pause running or still to come is said under the calendar as soon as it is approved: PauseNote.
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

// "Dec 3"
function monthDayOf(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

// The first day from tomorrow that isn't skipped or paused
function nextDeliveryDayOf(plan: AssignedPlan, today: Date, todayKey: string) {
  const day = new Date(today);
  for (let tries = 0; tries < 400; tries++) {
    day.setDate(day.getDate() + 1);
    const dayKey = dayKeyOf(day);
    if (dayKey > plan.lastDay) return null;
    if (stateOf(plan, dayKey, todayKey) === "upcoming") return day;
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
  const next = nextDeliveryDayOf(plan, today, todayKey);
  // The last day away is the day before the next delivery
  const lastDayAway = next ? new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1) : null;
  const dontDeliver = !lastDayAway ? "Don\u2019t deliver." : dayKeyOf(lastDayAway) === todayKey ? "Don\u2019t deliver today." : `Don\u2019t deliver until ${monthDayOf(lastDayAway)}.`;
  return (
    <>
      {withName ? `${plan.customerName}: ` : ""}
      {dontDeliver} {next ? `Next delivery is on ${monthDayOf(next)}.` : "No more deliveries on this plan."}
    </>
  );
}

// Mark as delivered: the OTP the customer reads out, as on Ongoing
function PlanOtpSheet({ plan, isSaving, onClose, onConfirm }: { plan: AssignedPlan; isSaving: boolean; onClose: () => void; onConfirm: () => void }) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4}$/.test(otp)) {
      setError("Enter the 4-digit OTP the customer reads out.");
      return;
    }
    onConfirm();
  }

  return (
    <DeliverySheet title="Mark as delivered" onClose={onClose}>
      <form onSubmit={submit} className={ongoingStyles["ongoing-form"]}>
        <p className={ongoingStyles["ongoing-form-stop"]}>
          {plan.customerName} · {plan.bottles} {plan.milk}
        </p>
        <label className={ongoingStyles["ongoing-field"]}>
          <span className={ongoingStyles["ongoing-field-label"]}>OTP from the customer</span>
          <input
            className={ongoingStyles["ongoing-input"]}
            inputMode="numeric"
            maxLength={4}
            autoComplete="one-time-code"
            placeholder="4 digits"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
          />
        </label>
        {error && (
          <p className={ongoingStyles["ongoing-form-error"]} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={deliveryButtonStyles.filled} disabled={isSaving}>
          {isSaving ? "Saving…" : "Mark as delivered"}
        </button>
      </form>
    </DeliverySheet>
  );
}

// Under the calendar: "Delivery is paused up to Nov 18. Next delivery is on Nov 19."
function PauseNote({ plan, pause, todayKey }: { plan: AssignedPlan; pause: AssignedPlan["pauses"][number]; todayKey: string }) {
  const lastPausedDay = new Date(`${pause.to}T12:00:00`);
  lastPausedDay.setDate(lastPausedDay.getDate() - 1);
  const next = nextDeliveryDayOf(plan, lastPausedDay, todayKey);
  return (
    <p className={styles["plan-day-away"]}>
      Delivery is paused up to {monthDayOf(lastPausedDay)}. {next ? `Next delivery is on ${monthDayOf(next)}.` : "No more deliveries on this plan."}
    </p>
  );
}

export default function DeliveryPlanCalendar() {
  const { stops } = useDeliveryPanel();
  const { plans, hasProblem, loadPlans } = useAssignedPlans();
  const [chosenOrder, setChosenOrder] = useState<string | null>(null);
  const [today] = useState(() => new Date());
  const [shownMonth, setShownMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [isOtpOpen, setIsOtpOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const plan = plans?.find((existing) => existing.orderNumber === chosenOrder) ?? plans?.[0];
  const todayKey = dayKeyOf(today);
  const todayState = plan ? stateOf(plan, todayKey, todayKey) : "none";
  // The running pause, or the nearest one still to come
  const comingPause = plan?.pauses.filter((pause) => pause.to > todayKey).sort((first, second) => first.from.localeCompare(second.from))[0];
  const isDeliveryDay = Boolean(plan) && todayKey >= (plan?.firstDay ?? "") && todayKey <= (plan?.lastDay ?? "");
  // Blank boxes before the 1st (weeks start on Monday), then each day of the month
  const blanks = (shownMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => new Date(shownMonth.getFullYear(), shownMonth.getMonth(), index + 1));
  // "6–7 AM" → "7 AM": the end of the slot set on the panel
  const deliverBefore = plan?.slot.split("–").pop()?.trim() || "7 AM";
  // Today while it's still to deliver, else the next day that isn't skipped or paused
  const nextDeliveryDay = plan ? (todayState === "today" && isDeliveryDay ? today : nextDeliveryDayOf(plan, today, todayKey)) : null;

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
    setIsOtpOpen(false);
  }

  return (
    <div className={styles["plan-calendar-columns"]}>
      <section className={styles["plan-calendar-card"]} aria-labelledby="plan-calendar-heading">
        <h2 id="plan-calendar-heading" className={styles["plan-calendar-heading"]}>
          Subscription customers
        </h2>
        <p className={styles["plan-calendar-note"]}>The milk plans your manager gave you. Choose a customer to see their calendar.</p>

        {hasProblem && <p className={styles["plan-calendar-note"]}>Couldn&rsquo;t read your plans. Please try again.</p>}
        {plans?.length === 0 && !hasProblem && <p className={styles["plan-calendar-empty"]}>No milk plans given to you yet.</p>}

        {plan && (
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
        )}
      </section>

      {plan && (
        <section className={styles["plan-calendar-card"]} aria-labelledby="plan-calendar-customer-heading">
          <div className={styles["plan-calendar-customer-row"]}>
            <h2 id="plan-calendar-customer-heading" className={styles["plan-calendar-heading"]}>
              {plan.customerName}
            </h2>
            {nextDeliveryDay && (
              <span className={styles["plan-calendar-next-delivery"]}>
                Next delivery on {monthDayOf(nextDeliveryDay)}, {deliverBefore}
              </span>
            )}
          </div>

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
            {comingPause && <PauseNote plan={plan} pause={comingPause} todayKey={todayKey} />}
            {todayState === "skipped" && (
              <p className={styles["plan-day-away"]}>
                <AwayText plan={plan} today={today} todayKey={todayKey} />
              </p>
            )}
            {todayState === "today" && !isDeliveryDay && (
              <p className={styles["plan-calendar-note"]}>
                {todayKey < plan.firstDay ? `Deliveries start on ${new Date(`${plan.firstDay}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.` : "This plan has ended."}
              </p>
            )}
            {((todayState === "today" && isDeliveryDay) || todayState === "delivered") && (
              <div className={`${styles["plan-today"]} ${todayState === "delivered" ? styles["plan-today-finished"] : ""}`}>
                <div>
                  <p className={styles["plan-today-title"]}>{todayState === "delivered" ? "Today\u2019s milk delivered" : "Deliver today\u2019s milk"}</p>
                  <p className={styles["plan-today-time"]}>
                    {plan.bottles} {plan.milk} · Deliver before {deliverBefore}
                  </p>
                </div>
                <button
                  type="button"
                  className={deliveryButtonStyles.filled}
                  disabled={isSaving || !stops.isOnDuty || todayState === "delivered"}
                  onClick={() => setIsOtpOpen(true)}
                >
                  {todayState === "delivered" ? "Delivered" : "Mark as delivered"}
                </button>
              </div>
            )}
            {problem && (
              <p className={styles["plan-today-problem"]} role="alert">
                {problem}
              </p>
            )}
          </div>

          {isOtpOpen && <PlanOtpSheet plan={plan} isSaving={isSaving} onClose={() => setIsOtpOpen(false)} onConfirm={() => void markDelivered()} />}
        </section>
      )}
    </div>
  );
}
