"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLoggedInMobileNumber } from "@/components/login/login-status";
import {
  PAUSE_REASONS,
  addPauseRequest,
  addSkipRequest,
  cancelPauseRequest,
  usePauseRequests,
  type PauseRequest,
} from "@/store/admin-pause-requests-store";
import { setCartSubscription } from "@/store/cart-store";
import { findRunningPlans, formatPlanDate, useOrders, type RunningPlan } from "@/store/orders-store";
import { AccountPageHeading } from "../account-dashboard-layout";
import DeliveryWeekPicker, { addDays, formatWeekRange, getMondayOfWeek } from "./delivery-week-picker";
import styles from "./subscription-page.module.css";

/*
  "My Subscription" dashboard page (design): the milk subscription card (Pause / Resume, Extend Plan),
  the delivery calendar (one week, Monday to Sunday: opens on this week; the arrows move a week back
  or forward, the week button opens a month calendar to pick any week, "This week" comes back;
  tap an upcoming day to skip it, tap again to undo) and the plans
  to switch between. Prices, quantity and the bill are placeholders from the design; nothing is sent
  anywhere yet, and Extend Plan does nothing until payments exist.
  Once a plan is paid in the cart ("Start subscription" on the milk page), the card shows that plan
  (the first running plan bought): its name, bottles a day, price per litre and its last day.
  Extend Plan then puts the same plan length in the cart as an extension of it (paid on the cart page).
  Skip: tapping a day of the running week (Monday to Sunday, up to 8 PM the evening before) asks to skip that
  delivery; tapping it again takes the request back. The Chiranvi Panel approves it on Pause requests. Approved
  skips and pauses move the plan's end date later, all kept in the database.
  Pause (a paid plan, 8 days or more): "Pause subscription" opens a pop-up (pause from, resume on, reason) and
  sends a request to the Chiranvi Panel (Pause requests). The card then shows its answer: waiting (with Cancel
  request), approved (paused on those days) or not approved (the customer can ask again).
*/

// A plan's latest pause request, and what it means today
type PauseState =
  | { kind: "none" }
  | { kind: "waiting" | "scheduled" | "paused" | "rejected"; request: PauseRequest };

function getPauseState(request: PauseRequest | undefined, today: Date): PauseState {
  if (!request) return { kind: "none" };
  if (request.status === "Pending") return { kind: "waiting", request };
  if (request.status === "Rejected") return { kind: "rejected", request };
  if (new Date(request.resumeOn) <= today) return { kind: "none" };
  return { kind: new Date(request.pauseFrom) <= today ? "paused" : "scheduled", request };
}

// The first day a pause can start: tomorrow, or the day after once it is past 8 PM (the cut-off)
function getEarliestPauseDay() {
  const now = new Date();
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + (now.getHours() >= 20 ? 2 : 1));
  return day;
}

// A pause starts at 8 days; fewer days are skipped in the running week (the database checks it too)
const MINIMUM_PAUSE_DAYS = 8;

// What a pause or skip request says about the plan
function planRequestDetails(plan: RunningPlan, area: string) {
  return {
    customerName: plan.deliverTo.split(" · ")[0],
    area,
    plan: `${plan.product.name} ${plan.bottlesPerDay} × ${plan.bottleLabel}`,
    frequency: "Daily" as const,
    litresPerDay: plan.bottlesPerDay * (plan.bottleLabel === "500 ml" ? 0.5 : 1),
  };
}

// The next day with a delivery: tomorrow, or after the days an approved skip takes out
function nextDeliveryDay(plan: RunningPlan, skipRequests: Map<string, PauseRequest>) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  const isSkipped = (date: Date) => skipRequests.get(toDateInputValue(date))?.status === "Approved";
  if (!isSkipped(day)) return "Tomorrow";
  while (isSkipped(day)) day.setDate(day.getDate() + 1);
  return formatPlanDate(day);
}

// "2026-10-28" for a date box, from a date
function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// A date box's value as that day's midnight (local)
function fromDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const subscriptionPlans = [
  {
    id: "weekly",
    shortName: "Week",
    label: "Weekly · 1 L",
    price: "₹928",
    priceUnit: "/ Week",
    description: "Every morning, same time.",
  },
  {
    id: "monthly",
    shortName: "Month",
    label: "Monthly · Save 5%",
    price: "₹2,790",
    priceUnit: "/ month",
    description: "30 deliveries, billed once a month.",
  },
  {
    id: "six-months",
    shortName: "6 Months",
    label: "Long months",
    price: "₹6,958",
    priceUnit: "/ 6 months",
    description: "Delivery every morning.",
  },
];

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// Monday to Sunday of the week starting on the given Monday, each day marked against today:
// earlier days "past", today "today", later days "upcoming". A day is green only if it was really delivered.
function getWeekDays(monday: Date, today: Date) {
  return weekdayNames.map((weekdayName, dayIndex) => {
    const date = addDays(monday, dayIndex);
    const dayState = date < today ? "past" : date.getTime() === today.getTime() ? "today" : "upcoming";
    return { weekdayName, dayOfMonth: date.getDate(), date, dateKey: toDateInputValue(date), dayState };
  });
}

export default function SubscriptionPage() {
  const [currentPlanId, setCurrentPlanId] = useState("weekly");
  const [today] = useState(getToday);
  // Monday of the week shown in the delivery calendar (this week at first).
  const [shownMonday, setShownMonday] = useState(() => getMondayOfWeek(getToday()));
  const [isWeekPickerOpen, setIsWeekPickerOpen] = useState(false);
  const closeWeekPicker = useCallback(() => setIsWeekPickerOpen(false), []);

  const shownWeek = getWeekDays(shownMonday, today);
  const isThisWeekShown = shownMonday.getTime() === getMondayOfWeek(today).getTime();

  // Every running plan (one card each: their own and any bought for others)
  const orders = useOrders();
  const runningPlans = findRunningPlans(orders);
  const mobileNumber = useLoggedInMobileNumber();
  const router = useRouter();
  const pauseRequests = usePauseRequests();
  // The plan whose pause pop-up is open
  const [planBeingPaused, setPlanBeingPaused] = useState<RunningPlan | null>(null);

  // Extend Plan: the same plan length again, as an extension of this plan, checked out on the cart page
  function extendPaidPlan(paidPlan: RunningPlan) {
    const oneTimePrice = paidPlan.product.originalPrice;
    const bottleCount = paidPlan.days * paidPlan.bottlesPerDay;
    setCartSubscription({
      product: { ...paidPlan.product, price: oneTimePrice, originalPrice: oneTimePrice },
      planId: `extend-${paidPlan.orderId}`,
      planName: paidPlan.planName,
      months: paidPlan.months,
      days: paidPlan.days,
      bottlesPerDay: paidPlan.bottlesPerDay,
      pricePerLitre: paidPlan.pricePerLitre,
      bottleCount,
      planTotal: bottleCount * paidPlan.pricePerLitre,
      oneTimeTotal: bottleCount * oneTimePrice,
      extendsOrderId: paidPlan.orderId,
      bottleLabel: paidPlan.bottleLabel,
      unitName: paidPlan.unitName,
    });
    router.push("/cart");
  }

  // The calendar is for the first plan. Its skips by day ("2026-11-06"), waiting or approved
  const calendarPlan = runningPlans[0];
  const skipRequests = new Map(
    pauseRequests
      .filter((request) => request.kind === "skip" && request.planOrderId === calendarPlan?.orderId && request.status !== "Rejected")
      .map((request) => [toDateInputValue(new Date(request.pauseFrom)), request]),
  );
  const earliestSkipDay = getEarliestPauseDay();
  const sundayOfThisWeek = addDays(getMondayOfWeek(today), 6);

  // Asks to skip the day, or takes back a request still waiting
  function toggleSkippedDay(dateKey: string, date: Date) {
    if (!calendarPlan) return;
    const existing = skipRequests.get(dateKey);
    if (existing) {
      cancelPauseRequest(existing.id);
      return;
    }
    addSkipRequest({
      ...planRequestDetails(calendarPlan, orders.find((order) => order.orderId === calendarPlan.orderId)?.area ?? ""),
      customerMobile: mobileNumber ?? undefined,
      planOrderId: calendarPlan.orderId,
      dayStart: date,
    });
  }

  return (
    <>
      <AccountPageHeading
        title="My Subscription"
        description="Fresh milk at your door every morning."
      />

      {/* No plan yet: nothing made up, just the way to start one */}
      {runningPlans.length === 0 && (
        <section className={styles["subscription-no-plan"]} aria-labelledby="subscription-no-plan-heading">
          <h2 id="subscription-no-plan-heading" className={styles["subscription-product-name"]}>
            No active plan
          </h2>
          <p className={styles["subscription-no-plan-text"]}>Start a milk plan and it shows here, with your deliveries.</p>
          <Link href="/products" className={styles["subscription-no-plan-button"]}>
            Start a plan
          </Link>
        </section>
      )}

      {/* Subscription cards: one per running plan */}
      {runningPlans.map((paidPlan) => {
        // The plan follows its pause request
        const pauseState = getPauseState(pauseRequests.find((request) => request.websiteOrderId === paidPlan.orderId), today);
        const isPaused = pauseState.kind === "paused";
        return (
          <section key={paidPlan.orderId} className={styles["subscription-card"]} aria-label={`Milk subscription for ${paidPlan.deliverTo}`}>
            <span className={styles["subscription-product-image-area"]}>
              <Image
                src="/images/products/a2-cow-milk-1-litre-bottle.webp"
                alt="A2 Desi Milk"
                width={232}
                height={500}
                sizes="100px"
                className={styles["subscription-product-image"]}
              />
            </span>

            <div className={styles["subscription-details"]}>
              <div className={styles["subscription-name-row"]}>
                <h2 className={styles["subscription-product-name"]}>
                  {paidPlan.product.name} · {paidPlan.planName}
                </h2>
                <span
                  className={`${styles["subscription-status-badge"]} ${
                    isPaused || pauseState.kind === "waiting" ? styles["subscription-status-badge-paused"] : ""
                  }`}
                >
                  {isPaused ? "Paused" : pauseState.kind === "waiting" ? "Pause requested" : "Active"}
                </span>
              </div>
              <dl className={styles["subscription-facts"]}>
                <div>
                  <dt>Quantity</dt>
                  <dd>{paidPlan.bottlesPerDay} × {paidPlan.bottleLabel} / day</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>₹{paidPlan.pricePerLitre} / {paidPlan.unitName}</dd>
                </div>
                <div>
                  <dt>Next delivery</dt>
                  <dd>
                    {pauseState.kind === "paused"
                      ? `${formatPlanDate(new Date(pauseState.request.resumeOn))}, 6:00 AM`
                      : isPaused
                        ? "Paused"
                        : `${nextDeliveryDay(paidPlan, skipRequests)}, 6:00 AM`}
                  </dd>
                </div>
                <div>
                  <dt>Valid till</dt>
                  <dd>{formatPlanDate(paidPlan.endsOn)}</dd>
                </div>
              </dl>
              {/* Which address this plan delivers to (tells the customer's plan from ones bought for others) */}
              {paidPlan.deliverTo && <p className={styles["subscription-address-line"]}>Delivering to {paidPlan.deliverTo}</p>}
              {/* The pause request's answer from the Chiranvi Panel */}
              {pauseState.kind !== "none" && (
                <p className={`${styles["subscription-pause-note"]} ${styles[`subscription-pause-note-${pauseState.kind}`]}`} role="status">
                  {pauseState.kind === "waiting" &&
                    `Pause requested: no milk from ${formatPlanDate(new Date(pauseState.request.pauseFrom))}, back on ${formatPlanDate(new Date(pauseState.request.resumeOn))}. Waiting for approval.`}
                  {pauseState.kind === "scheduled" &&
                    `Pause approved: no milk from ${formatPlanDate(new Date(pauseState.request.pauseFrom))}, back on ${formatPlanDate(new Date(pauseState.request.resumeOn))}.`}
                  {pauseState.kind === "paused" && `Paused. Your milk starts again on ${formatPlanDate(new Date(pauseState.request.resumeOn))}.`}
                  {pauseState.kind === "rejected" &&
                    `Your pause from ${formatPlanDate(new Date(pauseState.request.pauseFrom))} was not approved. Please call us if you need help, or ask again.`}
                </p>
              )}
            </div>

            <div className={styles["subscription-actions"]}>
              {pauseState.kind === "waiting" ? (
                <button
                  type="button"
                  className={styles["subscription-cancel-pause-button"]}
                  onClick={() => cancelPauseRequest(pauseState.request.id)}
                >
                  Cancel pause request
                </button>
              ) : pauseState.kind === "scheduled" || pauseState.kind === "paused" ? (
                <button type="button" className={styles["subscription-pause-button"]} disabled>
                  {pauseState.kind === "paused" ? "Paused" : "Pause approved"}
                </button>
              ) : (
                <button type="button" className={styles["subscription-pause-button"]} onClick={() => setPlanBeingPaused(paidPlan)}>
                  Pause subscription
                </button>
              )}
              <button type="button" className={styles["subscription-extend-button"]} onClick={() => extendPaidPlan(paidPlan)}>
                Extend Plan
              </button>
            </div>
          </section>
        );
      })}

      {/* Delivery calendar */}
      {runningPlans.length > 0 && (
          <section className={styles["subscription-section-card"]} aria-labelledby="delivery-calendar-heading">
          <div className={styles["subscription-section-heading-row"]}>
            <h2 id="delivery-calendar-heading" className={styles["subscription-section-heading"]}>
              Delivery calendar
            </h2>
            <p className={styles["subscription-section-hint"]}>Tap a day this week to ask to skip it, before 8 PM the evening before. Tap it again to take your request back. Once our team approves, your plan ends a day later.</p>
          </div>

          {/* Week choice: previous week, the week button (opens the month calendar), next week, This week */}
          <div className={styles["delivery-week-navigation"]}>
            <button
              type="button"
              aria-label="Previous week"
              className={styles["delivery-week-arrow"]}
              onClick={() => setShownMonday((monday) => addDays(monday, -7))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>

            <div className={styles["delivery-week-button-area"]}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isWeekPickerOpen}
                className={styles["delivery-week-button"]}
                onClick={() => setIsWeekPickerOpen((wasOpen) => !wasOpen)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["delivery-week-button-icon"]}>
                  <path d="M4 6h16v14H4z" />
                  <path d="M4 10h16" />
                  <path d="M8 3v4M16 3v4" />
                </svg>
                {formatWeekRange(shownMonday)}
                <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["delivery-week-button-arrow"]}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isWeekPickerOpen && (
                <DeliveryWeekPicker
                  selectedMonday={shownMonday}
                  today={today}
                  onSelectWeek={(monday) => {
                    setShownMonday(monday);
                    setIsWeekPickerOpen(false);
                  }}
                  onClose={closeWeekPicker}
                />
              )}
            </div>

            <button
              type="button"
              aria-label="Next week"
              className={styles["delivery-week-arrow"]}
              onClick={() => setShownMonday((monday) => addDays(monday, 7))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            {!isThisWeekShown && (
              <button
                type="button"
                className={styles["delivery-this-week-button"]}
                onClick={() => setShownMonday(getMondayOfWeek(today))}
              >
                This week
              </button>
            )}
          </div>

          <ul className={styles["delivery-calendar"]}>
            {shownWeek.map((day) => {
              const skipRequest = skipRequests.get(day.dateKey);
              // A day inside an approved pause of this plan (the agent's calendar shows it too)
              const isPausedDay = pauseRequests.some(
                (request) =>
                  request.websiteOrderId === calendarPlan?.orderId &&
                  request.status === "Approved" &&
                  day.dateKey >= toDateInputValue(new Date(request.pauseFrom)) &&
                  day.dateKey < toDateInputValue(new Date(request.resumeOn)),
              );
              const isSkipped = Boolean(skipRequest) || isPausedDay;
            // The agent marked it delivered (green, also today)
            const isDelivered = Boolean(calendarPlan?.deliveredDays.includes(day.dateKey));
              const isApproved = skipRequest?.status === "Approved" || isPausedDay;
              // This week's days from the first one still open; an approved skip stays
              const canTap = !isApproved && day.date >= earliestSkipDay && day.date <= sundayOfThisWeek;
              const dayLabel = `${day.weekdayName} ${day.dayOfMonth}`;
              return (
                <li key={day.dateKey}>
                  <button
                    type="button"
                    disabled={!canTap}
                    aria-pressed={canTap ? isSkipped : undefined}
                    aria-label={
                      day.dayState === "upcoming"
                        ? `${dayLabel}, ${isPausedDay ? "paused" : isApproved ? "skipped" : isSkipped ? "skip requested, tap to take it back" : canTap ? "upcoming, tap to ask to skip" : "upcoming"}`
                        : `${dayLabel}, ${isDelivered ? "delivered" : day.dayState === "today" ? "today" : "no delivery"}`
                    }
                    className={`${styles["delivery-calendar-day"]} ${styles[`delivery-calendar-day-${isDelivered ? "delivered" : day.dayState}`]} ${
                      isSkipped ? styles["delivery-calendar-day-skipped"] : ""
                    }`}
                    onClick={() => toggleSkippedDay(day.dateKey, day.date)}
                  >
                    <span className={styles["delivery-calendar-weekday"]}>{day.weekdayName}</span>
                    <span className={styles["delivery-calendar-date"]}>{day.dayOfMonth}</span>
                    {isSkipped && <span className={styles["delivery-calendar-skipped-label"]}>{isPausedDay ? "Paused" : isApproved ? "Skipped" : "Requested"}</span>}
                  {isDelivered && day.dayState === "today" && <span className={styles["delivery-calendar-skipped-label"]}>Delivered</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <ul className={styles["delivery-calendar-legend"]} aria-label="Calendar colours">
            <li>
              <span className={`${styles["delivery-calendar-legend-box"]} ${styles["delivery-calendar-legend-box-delivered"]}`} />
              Delivery
            </li>
            <li>
              <span className={`${styles["delivery-calendar-legend-box"]} ${styles["delivery-calendar-legend-box-upcoming"]}`} />
              Upcoming
            </li>
            <li>
              <span className={`${styles["delivery-calendar-legend-box"]} ${styles["delivery-calendar-legend-box-today"]}`} />
              Today
            </li>
          </ul>
        </section>
      )}

      {/* Change plan */}
      <section className={styles["subscription-section-card"]} aria-labelledby="change-plan-heading">
        <h2 id="change-plan-heading" className={styles["subscription-section-heading"]}>
          Change plan
        </h2>
        <ul className={styles["subscription-plan-list"]}>
          {subscriptionPlans.map((plan) => {
            const isCurrentPlan = plan.id === currentPlanId;
            return (
              <li
                key={plan.id}
                className={`${styles["subscription-plan-card"]} ${
                  isCurrentPlan ? styles["subscription-plan-card-current"] : ""
                }`}
              >
                <p className={styles["subscription-plan-label"]}>{plan.label}</p>
                <p className={styles["subscription-plan-price"]}>
                  {plan.price} <span className={styles["subscription-plan-price-unit"]}>{plan.priceUnit}</span>
                </p>
                <p className={styles["subscription-plan-description"]}>{plan.description}</p>
                {isCurrentPlan ? (
                  <span className={styles["subscription-plan-current-badge"]}>Current plan</span>
                ) : (
                  <button
                    type="button"
                    className={styles["subscription-plan-switch-button"]}
                    onClick={() => setCurrentPlanId(plan.id)}
                  >
                    Switch
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {planBeingPaused && <PauseRequestPopup plan={planBeingPaused} onClose={() => setPlanBeingPaused(null)} />}
    </>
  );
}

/*
  Pause pop-up: pause from (earliest the first day after the 8 PM cut-off), resume on (after it, and at most
  the day after the plan's last day) and a reason. "Request pause" stays greyed until all three are
  filled; it sends the request to the Chiranvi Panel (Pause requests), where it waits for approval.
  ×, Cancel, Escape or the dimmed page close it.
*/
function PauseRequestPopup({ plan, onClose }: { plan: RunningPlan; onClose: () => void }) {
  // The plan's own order (its delivery area goes with the request)
  const planOrder = useOrders().find((order) => order.orderId === plan.orderId);
  const mobileNumber = useLoggedInMobileNumber();
  const [earliestDay] = useState(getEarliestPauseDay);
  const lastResumeDay = new Date(plan.endsOn);
  lastResumeDay.setDate(lastResumeDay.getDate() + 1);
  const [pauseFrom, setPauseFrom] = useState(toDateInputValue(earliestDay));
  const [resumeOn, setResumeOn] = useState("");
  const [reason, setReason] = useState("");

  const fromDay = pauseFrom ? fromDateInputValue(pauseFrom) : null;
  const resumeDay = resumeOn ? fromDateInputValue(resumeOn) : null;
  const firstResumeDay = fromDay ? new Date(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate() + MINIMUM_PAUSE_DAYS) : earliestDay;
  const pausedDays = fromDay && resumeDay ? Math.round((resumeDay.getTime() - fromDay.getTime()) / 86400000) : 0;
  const isComplete =
    !!fromDay && !!resumeDay && fromDay >= earliestDay && pausedDays >= MINIMUM_PAUSE_DAYS && resumeDay <= lastResumeDay && reason !== "";

  // The latest onClose, so Escape works without setting the listener up again
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function send(event: FormEvent) {
    event.preventDefault();
    if (!isComplete || !fromDay || !resumeDay) return;
    addPauseRequest({
      ...planRequestDetails(plan, planOrder?.area ?? ""),
      pauseFrom: fromDay.toISOString(),
      resumeOn: resumeDay.toISOString(),
      reason,
      websiteOrderId: plan.orderId,
      customerMobile: mobileNumber ?? undefined,
    });
    onClose();
  }

  return (
    <div className={styles["pause-popup-overlay"]} data-lenis-prevent onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="pause-popup-title" className={styles["pause-popup"]} onSubmit={send} noValidate>
        <button type="button" className={styles["pause-popup-close-button"]} aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <h2 id="pause-popup-title" className={styles["pause-popup-title"]}>
          Pause subscription
        </h2>
        <p className={styles["pause-popup-intro"]}>
          {plan.product.name} · {plan.planName}. A pause is for 8 days or more; for fewer days, skip them in the calendar. Ask before 8 PM; our team
          approves your pause, and your plan ends later by those days.
        </p>

        <div className={styles["pause-popup-dates"]}>
          <label className={styles["pause-popup-field"]}>
            <span>Pause from *</span>
            <input
              type="date"
              value={pauseFrom}
              min={toDateInputValue(earliestDay)}
              max={toDateInputValue(plan.endsOn)}
              onChange={(event) => setPauseFrom(event.target.value)}
            />
          </label>
          <label className={styles["pause-popup-field"]}>
            <span>Resume on *</span>
            <input
              type="date"
              value={resumeOn}
              min={toDateInputValue(firstResumeDay)}
              max={toDateInputValue(lastResumeDay)}
              onChange={(event) => setResumeOn(event.target.value)}
            />
          </label>
        </div>
        {pausedDays > 0 && resumeDay && resumeDay > (fromDay ?? earliestDay) && (
          <p className={styles["pause-popup-summary"]}>
            No milk for {pausedDays} {pausedDays === 1 ? "day" : "days"}; it starts again on {formatPlanDate(resumeDay)}.
          </p>
        )}

        <label className={styles["pause-popup-field"]}>
          <span>Reason *</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} className={reason ? "" : styles["pause-popup-select-empty"]}>
            <option value="" disabled>
              Choose a reason
            </option>
            {PAUSE_REASONS.map((pauseReason) => (
              <option key={pauseReason}>{pauseReason}</option>
            ))}
          </select>
        </label>

        <div className={styles["pause-popup-buttons"]}>
          <button type="button" className={styles["pause-popup-cancel-button"]} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles["pause-popup-send-button"]} disabled={!isComplete}>
            Request pause
          </button>
        </div>
      </form>
    </div>
  );
}
