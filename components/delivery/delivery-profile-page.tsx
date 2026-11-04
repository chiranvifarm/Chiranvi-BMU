"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getNameInitials } from "@/components/account/account-profile";
import { useDeliveryRoutes } from "@/store/admin-routes-store";
import { getDaysPresent, useStaffList } from "@/store/admin-staff-store";
import { useCustomerProfile } from "@/store/customer-profiles-store";
import { DeliveryPageHeading, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-profile-page.module.css";

/*
  Me → Profile (/delivery/profile): the agent's own details, all real, read only here.
  - Green card: initials, name, since when; delivered today, days present and absent this month (staff_members and
    today's stops); role, shift, route, bike; Edit profile opens the website Profile, where a team member sends
    their change as a request.
  - Contact & vehicle: phone and email (their Profile), bike (their agent card).
  - Today's work: route, stops done, today's attendance.
  The name comes from their Profile on the website (changed there, it changes here too).
*/

const STATUS_CLASS_NAMES = {
  Present: styles["delivery-profile-status-present"],
  Absent: styles["delivery-profile-status-absent"],
  "On leave": styles["delivery-profile-status-on-leave"],
};

export default function DeliveryProfilePage() {
  const { login, stops } = useDeliveryPanel();
  const [areRoutesOpen, setAreRoutesOpen] = useState(false);
  const routesRef = useRef<HTMLElement>(null);

  // The routes drop-down closes on a click outside it, or Escape
  useEffect(() => {
    if (!areRoutesOpen) return;
    function closeOnOutsideClick(pointerEvent: PointerEvent) {
      if (!(pointerEvent.target instanceof Node && routesRef.current?.contains(pointerEvent.target))) setAreRoutesOpen(false);
    }
    function closeOnEscape(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") setAreRoutesOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [areRoutesOpen]);

  // The agent's own row (the database shows a team member only their own)
  const me = useStaffList().find((person) => person.phone === login.mobileNumber);
  const email = useCustomerProfile(login.mobileNumber)?.email;
  // Every route given to them on Routes & agents
  const myRoutes = useDeliveryRoutes().filter((route) => route.agent === login.agent?.name);
  const routeText = myRoutes.map((route) => `${route.name} · ${route.area}`).join(", ") || "Not given yet";
  const bike = login.agent?.bike && login.agent.bike !== "—" ? login.agent.bike : "Not added yet";

  const totalStops = stops.completed.length + stops.upNext.length + stops.ongoing.length;
  const deliveredToday = stops.completed.filter((stop) => stop.outcome !== "not-delivered").length;
  const donePercent = totalStops > 0 ? Math.round((stops.completed.length / totalStops) * 100) : 0;
  const since = me?.joinedOn ? new Date(me.joinedOn).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "";

  const numbers = [
    { label: "Delivered today", value: String(deliveredToday) },
    { label: "Days present", value: me ? String(getDaysPresent(me)) : "—" },
    { label: "Days absent", value: me ? String(me.daysAbsentThisMonth) : "—" },
  ];
  const workDetails = [
    { label: "Role", value: "Delivery agent" },
    { label: "Shift", value: me?.shift || "Not set yet" },
    { label: myRoutes.length > 1 ? "Routes" : "Route", value: routeText },
    { label: "Bike", value: bike },
  ];

  return (
    <>
      <DeliveryPageHeading title="Profile" description="Your details at Chiranvi Farm." />

      <div className={styles["delivery-profile-columns"]}>
        <section className={styles["delivery-profile-green-card"]} aria-label="Your details">
          <span className={styles["delivery-profile-initials-ring"]}>
            <span className={styles["delivery-profile-initials"]}>{getNameInitials(login.name)}</span>
          </span>
          <h2 className={styles["delivery-profile-name"]}>{login.name}</h2>
          <p className={styles["delivery-profile-since"]}>Delivery agent{since ? ` · Since ${since}` : ""}</p>

          <dl className={styles["delivery-profile-numbers"]}>
            {numbers.map((number) => (
              <div key={number.label}>
                <dd className={styles["delivery-profile-number-value"]}>{number.value}</dd>
                <dt className={styles["delivery-profile-number-label"]}>{number.label}</dt>
              </div>
            ))}
          </dl>

          <dl className={styles["delivery-profile-work-details"]}>
            {workDetails.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                {detail.label === "Routes" ? (
                  // Several routes: a drop-down, so the row stays short
                  <dd ref={routesRef} className={styles["delivery-profile-routes"]}>
                    <button
                      type="button"
                      className={styles["delivery-profile-routes-button"]}
                      aria-expanded={areRoutesOpen}
                      onClick={() => setAreRoutesOpen(!areRoutesOpen)}
                    >
                      {myRoutes.length} routes
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={areRoutesOpen ? "M7 14l5-5 5 5" : "M7 10l5 5 5-5"} />
                      </svg>
                    </button>
                    {areRoutesOpen && (
                      <ul className={styles["delivery-profile-routes-list"]}>
                        {myRoutes.map((route) => (
                          <li key={route.id}>
                            {route.name} · {route.area}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                ) : (
                  <dd>{detail.value}</dd>
                )}
              </div>
            ))}
          </dl>

          <Link href="/account" className={styles["delivery-profile-edit-button"]}>
            Edit profile
          </Link>
        </section>

        <div className={styles["delivery-profile-right-column"]}>
          <section className={styles["delivery-profile-card"]} aria-labelledby="delivery-profile-contact-heading">
            <h2 id="delivery-profile-contact-heading" className={styles["delivery-profile-card-title"]}>
              Contact &amp; vehicle
            </h2>
            <dl className={styles["delivery-profile-contact-details"]}>
              <div>
                <dt>Phone</dt>
                <dd>
                  +91 {login.mobileNumber.slice(0, 5)} {login.mobileNumber.slice(5)}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{email || "Not added yet"}</dd>
              </div>
              <div>
                <dt>Vehicle</dt>
                <dd>{bike}</dd>
              </div>
            </dl>
          </section>

          <section className={styles["delivery-profile-card"]} aria-labelledby="delivery-profile-today-heading">
            <div className={styles["delivery-profile-today-title-row"]}>
              <h2 id="delivery-profile-today-heading" className={styles["delivery-profile-card-title"]}>
                Today&rsquo;s work
              </h2>
              {me && <span className={`${styles["delivery-profile-status"]} ${STATUS_CLASS_NAMES[me.today]}`}>{me.today}</span>}
            </div>
            <p className={styles["delivery-profile-today-route"]}>{routeText}</p>
            <div className={styles["delivery-profile-stops-row"]}>
              <span className={styles["delivery-profile-stops-value"]}>
                {stops.completed.length}
                <span className={styles["delivery-profile-stops-total"]}> / {totalStops}</span>
              </span>
              <span className={styles["delivery-profile-stops-label"]}>stops done</span>
            </div>
            <div
              className={styles["delivery-profile-progress"]}
              role="progressbar"
              aria-label="Stops done today"
              aria-valuenow={donePercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className={styles["delivery-profile-progress-done"]} style={{ width: `${donePercent}%` }} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
