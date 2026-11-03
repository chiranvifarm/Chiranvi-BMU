"use client";

import { useEffect, useMemo, useState } from "react";
import {
  distanceBetween,
  formatTime,
  minutesFor,
  moveStop,
  optimiseRoute,
  routeLink,
  rupees,
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
  Deliveries → Up next (/delivery/up-next): the stops after the ongoing one, in route order.
  - Totals: stops left, distance left and the estimated finish time (riding plus a few minutes per stop).
  - Optimise route (nearest stop next, each time slot kept together) and Open route in Google Maps.
  - Route map: the ongoing stop and the stops left as numbered points, joined in order (positions are
    sample map positions until real addresses exist).
  - Load check: the products needed for the stops still to go (the ongoing one too), bottles to collect and
    cash to collect.
  - Each stop: number, time slot, distance from the stop before, customer, address, items, and tags for a
    customer note, a change from dispatch and bottles to collect. Up / Down move a stop in the order.
*/

export default function DeliveryUpNextPage() {
  const { login, stops } = useDeliveryPanel();
  const { ongoing, upNext } = stops;
  // The ongoing stop and everything after it, in order
  const stopsLeft = useMemo(() => (ongoing ? [ongoing, ...upNext] : upNext), [ongoing, upNext]);

  // Distance from the stop before (the first one has none: the agent is there or going there)
  const legs = useMemo(
    () => stopsLeft.map((stop, index) => (index === 0 ? 0 : distanceBetween(stopsLeft[index - 1], stop))),
    [stopsLeft],
  );
  const distanceLeft = legs.reduce((sum, leg) => sum + leg, 0);
  // The time now, moved on every minute so the estimated finish stays current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(clock);
  }, []);
  const finishTime = new Date(now + minutesFor(distanceLeft, stopsLeft.length) * 60000);

  // Load check: what has to be on the vehicle for the stops still to go
  const load = useMemo(() => {
    const products = new Map<string, { name: string; packSize: string; quantity: number }>();
    for (const stop of stopsLeft) {
      for (const item of stop.items) {
        const key = `${item.name}|${item.packSize}`;
        const kept = products.get(key);
        products.set(key, { name: item.name, packSize: item.packSize, quantity: (kept?.quantity ?? 0) + item.quantity });
      }
    }
    return {
      products: [...products.values()].sort((first, second) => second.quantity - first.quantity),
      bottles: stopsLeft.reduce((sum, stop) => sum + stop.bottlesToCollect, 0),
      cash: stopsLeft.reduce((sum, stop) => sum + stop.cashToCollect, 0),
    };
  }, [stopsLeft]);

  const unfinishedIds = stopsLeft.map((stop) => stop.id);

  return (
    <>
      <DeliveryPageHeading
        title="Up next"
        description="Your stops after the current one, in the order you'll ride them."
      >
        {upNext.length > 1 && (
          <button
            type="button"
            className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
            onClick={() => optimiseRoute(login.mobileNumber, ongoing, upNext)}
          >
            Optimise route
          </button>
        )}
        {stopsLeft.length > 0 && (
          <a
            href={routeLink(stopsLeft)}
            target="_blank"
            rel="noreferrer"
            className={`${deliveryButtonStyles.filled} ${deliveryButtonStyles.small}`}
          >
            Open route in Google Maps
          </a>
        )}
      </DeliveryPageHeading>
      <DeliveryShiftNotices />

      {login.route && stopsLeft.length === 0 && (
        <DeliveryNotice title="No stops left" text="Every stop on your list is finished for today." />
      )}

      {stopsLeft.length > 0 && (
        <>
          {/* Stops left, distance left, estimated finish */}
          <div className={styles["up-next-totals"]}>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{stopsLeft.length}</span>
              <span className={styles["up-next-total-label"]}>Stops left</span>
            </div>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{distanceLeft.toFixed(1)} km</span>
              <span className={styles["up-next-total-label"]}>Distance left</span>
            </div>
            <div className={styles["up-next-total"]}>
              <span className={styles["up-next-total-value"]}>{formatTime(finishTime)}</span>
              <span className={styles["up-next-total-label"]}>Estimated finish</span>
            </div>
          </div>

          <div className={styles["up-next-columns"]}>
            <section className={styles["up-next-card"]} aria-labelledby="up-next-map-title">
              <h2 id="up-next-map-title" className={styles["up-next-card-title"]}>
                Route map
              </h2>
              <RouteMap stops={stopsLeft} />
              <p className={styles["up-next-map-key"]}>
                <span className={styles["up-next-map-key-now"]} aria-hidden="true" /> Now
                <span className={styles["up-next-map-key-next"]} aria-hidden="true" /> Up next
              </p>
            </section>

            <section className={styles["up-next-card"]} aria-labelledby="up-next-load-title">
              <h2 id="up-next-load-title" className={styles["up-next-card-title"]}>
                Load check
              </h2>
              <p className={styles["up-next-card-text"]}>What you need on the vehicle for the {stopsLeft.length} stops left.</p>
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
              {load.cash > 0 && (
                <div className={styles["up-next-load-extra"]}>
                  <span>Cash to collect</span>
                  <strong>{rupees(load.cash)}</strong>
                </div>
              )}
            </section>
          </div>

          {/* The stops, in order */}
          <ol className={styles["up-next-stop-list"]} aria-label="Stops left">
            {stopsLeft.map((stop, index) => (
              <StopRow
                key={stop.id}
                stop={stop}
                number={index + 1}
                isOngoing={index === 0 && Boolean(ongoing)}
                distanceFromBefore={legs[index]}
                canMoveUp={index > 1}
                canMoveDown={index > 0 && index < stopsLeft.length - 1}
                onMove={(direction) => moveStop(login.mobileNumber, unfinishedIds, stop.id, direction)}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function StopRow({
  stop,
  number,
  isOngoing,
  distanceFromBefore,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  stop: AgentStop;
  number: number;
  isOngoing: boolean;
  distanceFromBefore: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const hasHighlight = Boolean(stop.note) || stop.changedByDispatch || stop.bottlesToCollect > 0;
  return (
    <li className={`${styles["up-next-stop"]} ${isOngoing ? styles["up-next-stop-ongoing"] : ""} ${hasHighlight ? styles["up-next-stop-highlighted"] : ""}`}>
      <span className={styles["up-next-stop-number"]} aria-hidden="true">
        {number}
      </span>
      <div className={styles["up-next-stop-body"]}>
        <div className={styles["up-next-stop-top-row"]}>
          <span className={styles["up-next-stop-slot"]}>{stop.slot}</span>
          {isOngoing ? (
            <span className={styles["up-next-stop-now"]}>Now</span>
          ) : (
            <span className={styles["up-next-stop-distance"]}>{distanceFromBefore.toFixed(1)} km from the stop before</span>
          )}
        </div>
        <p className={styles["up-next-stop-customer"]}>{stop.customerName}</p>
        <p className={styles["up-next-stop-address"]}>
          {stop.address}
          {stop.landmark ? ` · ${stop.landmark}` : ""}
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
            {stop.cashToCollect > 0 && <span className={styles["up-next-tag-bottles"]}>Cash {rupees(stop.cashToCollect)}</span>}
          </div>
        )}
      </div>
      {!isOngoing && (
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

// The stops as numbered points on a plain map, joined in riding order (north up)
function RouteMap({ stops }: { stops: AgentStop[] }) {
  const width = 320;
  const height = 220;
  const padding = 22;
  const latitudes = stops.map((stop) => stop.latitude);
  const longitudes = stops.map((stop) => stop.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeRange = maxLatitude - minLatitude || 0.001;
  const longitudeRange = maxLongitude - minLongitude || 0.001;
  const points = stops.map((stop) => ({
    id: stop.id,
    x: padding + ((stop.longitude - minLongitude) / longitudeRange) * (width - 2 * padding),
    y: padding + ((maxLatitude - stop.latitude) / latitudeRange) * (height - 2 * padding),
  }));
  // Many stops: number only every few, so the map stays readable
  const labelEvery = stops.length > 30 ? 5 : stops.length > 15 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles["up-next-map"]} role="img" aria-label={`Route map of ${stops.length} stops`}>
      <rect x="0" y="0" width={width} height={height} rx="12" className={styles["up-next-map-ground"]} />
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className={styles["up-next-map-line"]} />
      {points.map((point, index) => (
        <g key={point.id}>
          <circle cx={point.x} cy={point.y} r={index === 0 ? 8 : 6} className={index === 0 ? styles["up-next-map-point-now"] : styles["up-next-map-point"]} />
          {(index === 0 || index % labelEvery === 0 || index === points.length - 1) && (
            <text x={point.x} y={point.y - 10} className={styles["up-next-map-label"]}>
              {index + 1}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
