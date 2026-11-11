"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "@/components/admin/admin-routes-page";
import { toDateKey } from "@/store/admin-deliveries-store";
import { hubOfAgent, useDeliveryRoutes, useDeliveryService } from "@/store/admin-routes-store";
import {
  STOP_OUTCOME_LABELS,
  useAgentStopsForDay,
  distanceBetween,
  formatTime,
  hubNavigationLink,
  minutesFor,
  moveStop,
  optimiseRoute,
  routeLink,
  rupees,
  shownPlaceOf,
  useStopOrder,
  type AgentStop,
} from "@/store/delivery-agent-store";
import {
  DeliveryNotice,
  DeliveryPageHeading,
  DeliveryShiftNotices,
  deliveryButtonStyles,
  useDeliveryPanel,
} from "./delivery-panel-layout";
import styles from "./delivery-up-next-page.module.css";

/*
  Deliveries → Up next (/delivery/up-next): the stops after the ongoing ones, in route order.
  - Totals: stops left, distance left and the estimated finish time (riding plus a few minutes per stop).
  - Optimise route (nearest stop next, each time slot kept together) and Open route in Google Maps (from the
    farm hub until the first stop of the day is finished; after that, from wherever the agent is), under the
    duty switch. Open route works only on duty.
  - Under the map: < Nov 9 >, the day shown. Arrows move a day; the date opens a month calendar. Another day is
    view only: an earlier day shows its stops (delivered or not); a later day the stops already dated it
    (one-time orders reach up to the day after tomorrow) and the plans that will run that morning. The totals,
    Load check and the list follow the day.
  - Route map: the same map as Routes & agents on the panel, with only this agent's routes. A route changed on
    the panel changes here. Under it, the farm hub (the pick-up point) with Navigate to hub, once its spot is saved.
  - Load check: the products needed for the stops still to go (the ongoing ones too) and bottles to collect.
    No cash: every order is paid online.
  - Each stop: number, time slot, distance from the stop before, customer, address, items, and tags for a
    customer note, a change from dispatch and bottles to collect. Up / Down move a stop in the order.
*/

export default function DeliveryUpNextPage() {
  const { login, stops } = useDeliveryPanel();
  const { ongoing, upNext } = stops;
  const routes = useDeliveryRoutes();
  // The pick-up point: this agent's route's hub (the one nearest the route; 0060_hubs.sql)
  const hub = hubOfAgent(login.agent?.name ?? null, routes, useDeliveryService()?.hubs ?? []);
  const myRouteIds = routes.filter((route) => route.agent === login.agent?.name).map((route) => route.id);
  const [highlightedRoute, setHighlightedRoute] = useState<string | null>(null);
  // The ongoing stops and everything after them, in order
  const stopsLeft = useMemo(() => [...ongoing, ...upNext], [ongoing, upNext]);

  // The day on the calendar: today (the stops to work on) or another day, view only
  const todayKey = toDateKey(new Date());
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // The stop whose details pop-up is open
  const [detailStop, setDetailStop] = useState<AgentStop | null>(null);
  const shownDay = pickedDay ?? todayKey;
  const isToday = shownDay === todayKey;
  const isEarlierDay = shownDay < todayKey;
  const otherDay = useAgentStopsForDay(login, isToday ? null : shownDay);
  const shownStops = isToday ? stopsLeft : otherDay.stops;
  const shownDayName = dayName(shownDay);

  // Distance from the stop before (the first one has none: the agent is there or going there)
  const legs = useMemo(
    () => shownStops.map((stop, index) => (index === 0 ? 0 : distanceBetween(shownStops[index - 1], stop))),
    [shownStops],
  );
  const distanceLeft = legs.reduce((sum, leg) => sum + leg, 0);
  // The time now, moved on every minute so the estimated finish stays current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(clock);
  }, []);
  const ridingMinutes = minutesFor(distanceLeft, shownStops.length);
  const finishTime = new Date(now + ridingMinutes * 60000);

  // Load check: what has to be on the vehicle for the stops shown
  const load = useMemo(() => {
    const products = new Map<string, { name: string; packSize: string; quantity: number }>();
    for (const stop of shownStops) {
      for (const item of stop.items) {
        const key = `${item.name}|${item.packSize}`;
        const kept = products.get(key);
        products.set(key, { name: item.name, packSize: item.packSize, quantity: (kept?.quantity ?? 0) + item.quantity });
      }
    }
    return {
      products: [...products.values()].sort((first, second) => second.quantity - first.quantity),
      bottles: shownStops.reduce((sum, stop) => sum + stop.bottlesToCollect, 0),
    };
  }, [shownStops]);

  const unfinishedIds = stopsLeft.map((stop) => stop.id);
  const stopWord = (count: number) => `${count} stop${count === 1 ? "" : "s"}`;
  const loadText = isToday
    ? `What you need on the vehicle for the ${stopWord(shownStops.length)} left.`
    : isEarlierDay
      ? `What the ${stopWord(shownStops.length)} on ${shownDayName} needed.`
      : `What you'll need on the vehicle for the ${stopWord(shownStops.length)} on ${shownDayName}.`;

  return (
    <>
      {/* The heading, with the route buttons under the duty switch (today only: other days are view only) */}
      <div className={styles["up-next-heading-row"]}>
        <DeliveryPageHeading title="Up next" description="Your stops after the current ones, in the order you'll ride them." />
        {isToday && stopsLeft.length > 0 && (
          <div className={styles["up-next-route-actions"]}>
            {upNext.length > 1 && (
              <button
                type="button"
                className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
                onClick={() => optimiseRoute(login.mobileNumber, ongoing, upNext)}
              >
                Optimise route
              </button>
            )}
            {/* Customers' locations: only on duty (a link can't be switched off, so off duty it is a button) */}
            {stops.isOnDuty ? (
              <a
                href={routeLink(stopsLeft, stops.completed.length === 0 ? hub : null)}
                target="_blank"
                rel="noreferrer"
                className={`${deliveryButtonStyles.filled} ${deliveryButtonStyles.small}`}
              >
                Open route in Google Maps
              </a>
            ) : (
              <button type="button" disabled className={`${deliveryButtonStyles.filled} ${deliveryButtonStyles.small}`}>
                Open route in Google Maps
              </button>
            )}
          </div>
        )}
      </div>
      <DeliveryShiftNotices />

      {shownStops.length > 0 && (
        <>
          {/* Stops, distance, and the finish time (today) or riding time (another day) */}
          <div className={styles["up-next-totals"]}>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{shownStops.length}</span>
              <span className={styles["up-next-total-label"]}>{isToday ? "Stops left" : "Stops"}</span>
            </div>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{distanceLeft.toFixed(1)} km</span>
              <span className={styles["up-next-total-label"]}>{isToday ? "Distance left" : "Distance"}</span>
            </div>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{isToday ? formatTime(finishTime) : durationText(ridingMinutes)}</span>
              <span className={styles["up-next-total-label"]}>{isToday ? "Estimated finish" : "Riding time"}</span>
            </div>
          </div>

          <div className={styles["up-next-columns"]}>
            <section className={`${styles["up-next-card"]} ${styles["up-next-map-card"]}`} aria-labelledby="up-next-map-title">
              <h2 id="up-next-map-title" className={styles["up-next-card-title"]}>
                Route map
              </h2>
              <p className={styles["up-next-card-text"]}>
                Farm hub → {myRouteIds.length} delivery route{myRouteIds.length === 1 ? "" : "s"}
              </p>
              <div className={styles["up-next-map-area"]}>
                <RouteMap routes={routes} shownRouteIds={myRouteIds} highlightedRoute={highlightedRoute} onHighlight={setHighlightedRoute} fillsBox />
              </div>
              {/* The pick-up point */}
              {hub && (
                <p className={styles["up-next-hub-row"]}>
                  <span>
                    Pick-up point: <strong>{hub.name}</strong>
                  </span>
                  <a
                    href={hubNavigationLink(hub)}
                    target="_blank"
                    rel="noreferrer"
                    className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
                  >
                    Navigate to hub
                  </a>
                </p>
              )}
            </section>

            <section className={`${styles["up-next-card"]} ${styles["up-next-load-card"]}`} aria-labelledby="up-next-load-title">
              <h2 id="up-next-load-title" className={styles["up-next-card-title"]}>
                Load check
              </h2>
              <p className={styles["up-next-card-text"]}>{loadText}</p>
              <ul className={styles["up-next-load-list"]}>
                {load.products.map((product) => (
                  <li key={`${product.name}-${product.packSize}`} className={styles["up-next-load-item"]}>
                    <span>
                      <span className={styles["up-next-load-name"]}>{product.name}</span>
                      <span className={styles["up-next-load-pack"]}>{product.packSize}</span>
                    </span>
                    <span className={styles["up-next-load-quantity"]}>× {product.quantity}</span>
                  </li>
                ))}
              </ul>
              <div className={styles["up-next-load-extra"]}>
                <span>Empty bottles to collect</span>
                <strong>{load.bottles}</strong>
              </div>
            </section>
          </div>
        </>
      )}

      {/* The day: arrows a day back or forward, the date opens a month calendar */}
      {login.agent && <DayPicker shownDay={shownDay} todayKey={todayKey} onPick={(day) => setPickedDay(day === todayKey ? null : day)} />}

      {isToday && login.route && stopsLeft.length === 0 && (
        <DeliveryNotice title="No stops left" text="Every stop on your list is finished for today." />
      )}
      {!isToday && !otherDay.isLoaded && <p className={styles["up-next-day-loading"]}>Loading {shownDayName}…</p>}
      {!isToday && otherDay.isLoaded && otherDay.hasProblem && (
        <DeliveryNotice title="Couldn't load this day" text="Check your internet and pick the day again." />
      )}
      {!isToday && otherDay.isLoaded && !otherDay.hasProblem && shownStops.length === 0 && (
        <DeliveryNotice
          title={`No stops on ${shownDayName}`}
          text={isEarlierDay ? "You had no deliveries that day." : "Nothing is planned for that day yet."}
        />
      )}

      {/* The stops, in order (another day: view only) */}
      {shownStops.length > 0 && (
        <ol className={styles["up-next-stop-list"]} aria-label={isToday ? "Stops left" : `Stops on ${shownDayName}`}>
          {shownStops.map((stop, index) =>
            isToday ? (
              <StopRow
                key={stop.id}
                stop={stop}
                number={index + 1}
                isOngoing={index < ongoing.length}
                isOnDuty={stops.isOnDuty}
                distanceFromBefore={legs[index]}
                canMoveUp={index > ongoing.length}
                canMoveDown={index >= ongoing.length && index < stopsLeft.length - 1}
                onMove={(direction) => moveStop(login.mobileNumber, unfinishedIds, ongoing.length, stop.id, direction)}
                onOpen={() => setDetailStop(stop)}
              />
            ) : (
              <StopRow
                key={stop.id}
                stop={stop}
                number={index + 1}
                isOngoing={false}
                isOnDuty={stops.isOnDuty}
                distanceFromBefore={legs[index]}
                isViewOnly
                onOpen={() => setDetailStop(stop)}
              />
            ),
          )}
        </ol>
      )}

      {detailStop && (
        <StopDetailsDialog stop={detailStop} deliveryDay={shownDay} isOnDuty={stops.isOnDuty} onClose={() => setDetailStop(null)} />
      )}
    </>
  );
}

/*
  A stop's details, opened by tapping it: order number, kind and status; when it was ordered; the delivery day and
  slot; the customer (phone and full address only on duty, as everywhere in the panel); the items with prices; the
  order total and how it was paid; for a milk plan its length, bottles a day and first / last
  day; and the stop's notes. The order's time, total and plan come from the database (useStopOrder).
  Close, Escape or the dimmed page close it.
*/
function StopDetailsDialog({
  stop,
  deliveryDay,
  isOnDuty,
  onClose,
}: {
  stop: AgentStop;
  deliveryDay: string;
  isOnDuty: boolean;
  onClose: () => void;
}) {
  const order = useStopOrder(stop.orderNumber || null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const itemsTotal = stop.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderedOn =
    order === null
      ? "Loading…"
      : order === "none"
        ? "—"
        : new Date(order.placedAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).replace(/\b(am|pm)\b/, (text) => text.toUpperCase());
  const paidBy =
    order && order !== "none"
      ? `${order.paymentMethod || "—"}${order.paymentStatus === "paid" ? " · Paid" : order.paymentStatus === "not_charged" ? " · Pay on delivery" : ""}`
      : null;
  const planDays = order && order !== "none" && order.plan ? order.plan : null;

  return (
    <div className={styles["stop-details-overlay"]} data-lenis-prevent>
      <button type="button" aria-label="Close" className={styles["stop-details-dimmed-page"]} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="stop-details-heading" className={styles["stop-details-dialog"]}>
        <div className={styles["stop-details-top-row"]}>
          <div>
            <h2 id="stop-details-heading" className={styles["stop-details-heading"]}>
              {stop.orderNumber ? `Order ${stop.orderNumber}` : "Daily milk round"}
            </h2>
            <p className={styles["stop-details-tags"]}>
              <span className={styles["up-next-stop-kind"]}>{stop.isSubscription ? "Subscription" : "One-time"}</span>
              <span className={styles["stop-details-status"]}>{stop.outcome ? STOP_OUTCOME_LABELS[stop.outcome] : stop.status}</span>
            </p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close" className={styles["stop-details-close"]} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <dl className={styles["stop-details-rows"]}>
          <div className={styles["stop-details-row"]}>
            <dt>Ordered on</dt>
            <dd>{orderedOn}</dd>
          </div>
          <div className={styles["stop-details-row"]}>
            <dt>Delivery</dt>
            <dd>
              {new Date(`${deliveryDay}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {stop.slot}
            </dd>
          </div>
          <div className={styles["stop-details-row"]}>
            <dt>Customer</dt>
            <dd>
              <strong>{stop.customerName}</strong>
              <span>{isOnDuty ? `+91 ${stop.phone.slice(0, 5)} ${stop.phone.slice(5)}` : "Phone shown when you go on duty"}</span>
              <span>
                {shownPlaceOf(stop, isOnDuty)}
                {isOnDuty && stop.landmark ? ` · ${stop.landmark}` : ""}
              </span>
            </dd>
          </div>
          {planDays && (
            <div className={styles["stop-details-row"]}>
              <dt>Plan</dt>
              <dd>
                <strong>{planDays.name || `${planDays.days} days`}</strong>
                <span>
                  {planDays.bottlesPerDay} bottle{planDays.bottlesPerDay === 1 ? "" : "s"} a day ·{" "}
                  {new Date(`${planDays.firstDay}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to{" "}
                  {new Date(`${planDays.lastDay}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </dd>
            </div>
          )}
        </dl>

        {/* The items on this stop */}
        <ul className={styles["stop-details-items"]}>
          {stop.items.map((item) => (
            <li key={`${item.name}-${item.packSize}`} className={styles["stop-details-item"]}>
              <span>
                <span className={styles["stop-details-item-name"]}>{item.name}</span>
                <span className={styles["stop-details-item-pack"]}>
                  {item.packSize} × {item.quantity}
                </span>
              </span>
              <span className={styles["stop-details-item-price"]}>{rupees(item.price * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className={styles["stop-details-money"]}>
          <p>
            <span>Items</span>
            <strong>{rupees(itemsTotal)}</strong>
          </p>
          {order && order !== "none" && (
            <p>
              <span>Order total</span>
              <strong>{rupees(order.totalRupees)}</strong>
            </p>
          )}
          {paidBy && (
            <p>
              <span>Paid by</span>
              <strong>{paidBy}</strong>
            </p>
          )}
        </div>

        {/* Notes, dispatch changes and bottles, when there are any */}
        {(stop.note || stop.changedByDispatch || stop.bottlesToCollect > 0) && (
          <div className={styles["up-next-stop-tags"]}>
            {stop.note && <span className={styles["up-next-tag-note"]}>Note: {stop.note}</span>}
            {stop.changedByDispatch && <span className={styles["up-next-tag-dispatch"]}>Changed by dispatch</span>}
            {stop.bottlesToCollect > 0 && (
              <span className={styles["up-next-tag-bottles"]}>
                Collect {stop.bottlesToCollect} bottle{stop.bottlesToCollect === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        <button type="button" className={`${deliveryButtonStyles.outlined} ${styles["stop-details-close-button"]}`} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// "Nov 9"
function dayName(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// 135 → "2 h 15 min"
function durationText(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function moveDay(dateKey: string, days: number) {
  const day = new Date(`${dateKey}T12:00:00`);
  day.setDate(day.getDate() + days);
  return toDateKey(day);
}

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

/*
  < Nov 9 >: the arrows move a day back or forward; the date opens a month calendar (the account Subscription
  calendar's style) to pick any day. Today has a yellow ring, the picked day is green. Escape or a click outside
  closes it.
*/
function DayPicker({ shownDay, todayKey, onPick }: { shownDay: string; todayKey: string; onPick: (dateKey: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  // First day of the month the calendar shows (opens on the picked day's month)
  const [shownMonth, setShownMonth] = useState(() => new Date(`${shownDay.slice(0, 7)}-01T12:00:00`));

  useEffect(() => {
    if (!isOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    function closeOnOutsideClick(event: PointerEvent) {
      if (!areaRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [isOpen]);

  function toggleCalendar() {
    if (!isOpen) setShownMonth(new Date(`${shownDay.slice(0, 7)}-01T12:00:00`));
    setIsOpen(!isOpen);
  }

  // The month's days in Monday-to-Sunday rows, with blanks before the 1st
  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();
  const blanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => toDateKey(new Date(year, month, index + 1)));

  return (
    <div className={styles["up-next-day-picker"]}>
      <button type="button" aria-label="Previous day" className={styles["up-next-day-arrow"]} onClick={() => onPick(moveDay(shownDay, -1))}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div ref={areaRef} className={styles["up-next-day-button-area"]}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`${dayName(shownDay)}${shownDay === todayKey ? ", today" : ""}. Choose a day`}
          className={styles["up-next-day-button"]}
          onClick={toggleCalendar}
        >
          {dayName(shownDay)}
        </button>
        {isOpen && (
          <div role="dialog" aria-label="Choose a day" className={styles["up-next-day-calendar"]}>
            <div className={styles["up-next-day-calendar-month-row"]}>
              <button
                type="button"
                aria-label="Previous month"
                className={styles["up-next-day-calendar-month-arrow"]}
                onClick={() => setShownMonth(new Date(year, month - 1, 1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <p className={styles["up-next-day-calendar-month-name"]}>
                {shownMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
              </p>
              <button
                type="button"
                aria-label="Next month"
                className={styles["up-next-day-calendar-month-arrow"]}
                onClick={() => setShownMonth(new Date(year, month + 1, 1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className={styles["up-next-day-calendar-weekdays"]} aria-hidden="true">
              {WEEKDAY_INITIALS.map((initial, index) => (
                <span key={index}>{initial}</span>
              ))}
            </div>
            <div className={styles["up-next-day-calendar-days"]}>
              {Array.from({ length: blanks }, (_, index) => (
                <span key={`blank-${index}`} />
              ))}
              {monthDays.map((dateKey) => (
                <button
                  key={dateKey}
                  type="button"
                  aria-pressed={dateKey === shownDay}
                  aria-label={dayName(dateKey)}
                  className={`${styles["up-next-day-calendar-day"]} ${dateKey === todayKey ? styles["up-next-day-calendar-day-today"] : ""} ${
                    dateKey === shownDay ? styles["up-next-day-calendar-day-picked"] : ""
                  }`}
                  onClick={() => {
                    onPick(dateKey);
                    setIsOpen(false);
                  }}
                >
                  {Number(dateKey.slice(8))}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button type="button" aria-label="Next day" className={styles["up-next-day-arrow"]} onClick={() => onPick(moveDay(shownDay, 1))}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

function StopRow({
  stop,
  number,
  isOngoing,
  isOnDuty,
  distanceFromBefore,
  canMoveUp = false,
  canMoveDown = false,
  onMove,
  isViewOnly = false,
  onOpen,
}: {
  stop: AgentStop;
  number: number;
  isOngoing: boolean;
  isOnDuty: boolean;
  distanceFromBefore: number;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (direction: -1 | 1) => void;
  isViewOnly?: boolean; // another day on the calendar: no moving
  onOpen: () => void; // tapping the stop opens its details
}) {
  const hasHighlight = Boolean(stop.note) || stop.changedByDispatch || stop.bottlesToCollect > 0;
  return (
    <li className={`${styles["up-next-stop"]} ${isOngoing ? styles["up-next-stop-ongoing"] : ""} ${hasHighlight ? styles["up-next-stop-highlighted"] : ""}`}>
      <span className={styles["up-next-stop-number"]} aria-hidden="true">
        {number}
      </span>
      {/* Tapping the stop opens its details (order number, when it was ordered, items, money) */}
      <button type="button" className={styles["up-next-stop-body"]} onClick={onOpen} aria-label={`Details of ${stop.customerName}${stop.orderNumber ? `, order ${stop.orderNumber}` : ""}`}>
        <div className={styles["up-next-stop-top-row"]}>
          <span className={styles["up-next-stop-slot"]}>{stop.slot}</span>
          <span className={styles["up-next-stop-kind"]}>{stop.isSubscription ? "Subscription" : "One-time"}</span>
          {isOngoing ? (
            <span className={styles["up-next-stop-now"]}>Now</span>
          ) : (
            <span className={styles["up-next-stop-distance"]}>{distanceFromBefore.toFixed(1)} km from the stop before</span>
          )}
          {/* An earlier day: how the stop ended */}
          {stop.outcome && (
            <span
              className={`${styles["up-next-stop-outcome"]} ${
                stop.outcome === "not-delivered" ? styles["up-next-stop-outcome-missed"] : styles["up-next-stop-outcome-delivered"]
              }`}
            >
              {STOP_OUTCOME_LABELS[stop.outcome]}
            </span>
          )}
        </div>
        <p className={styles["up-next-stop-customer"]}>{stop.customerName}</p>
        <p className={styles["up-next-stop-address"]}>
          {shownPlaceOf(stop, isOnDuty)}
          {isOnDuty && stop.landmark ? ` · ${stop.landmark}` : ""}
        </p>
        <p className={styles["up-next-stop-items"]}>
          {stop.items.map((item) => `${item.name} ${item.packSize} × ${item.quantity}`).join(", ")}
        </p>
        {hasHighlight && (
          <div className={styles["up-next-stop-tags"]}>
            {stop.note && <span className={styles["up-next-tag-note"]}>Note: {stop.note}</span>}
            {stop.changedByDispatch && <span className={styles["up-next-tag-dispatch"]}>Changed by dispatch</span>}
            {stop.bottlesToCollect > 0 && (
              <span className={styles["up-next-tag-bottles"]}>
                Collect {stop.bottlesToCollect} bottle{stop.bottlesToCollect === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </button>
      {!isOngoing && !isViewOnly && onMove && (
        <div className={styles["up-next-stop-move"]}>
          <button type="button" className={styles["up-next-move-button"]} aria-label={`Move ${stop.customerName} up`} disabled={!canMoveUp} onClick={() => onMove(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <button type="button" className={styles["up-next-move-button"]} aria-label={`Move ${stop.customerName} down`} disabled={!canMoveDown} onClick={() => onMove(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
}
