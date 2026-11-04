"use client";

import Link from "next/link";
import { useDeliveryRoutes } from "@/store/admin-routes-store";
import { getDaysPresent, useStaffList } from "@/store/admin-staff-store";
import { DeliveryNotice, DeliveryPageHeading, deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-profile-page.module.css";

/*
  Me → Profile (/delivery/profile): the agent's own details, read only.
  - From the staff list (staff_members): name, mobile, role, job, shift, today's attendance, days present and
    absent this month.
  - From Routes & agents: their route and bike.
  - Today's stops: finished out of all.
  The name comes from their Profile on the website (changed there, it changes here too).
*/

const STATUS_CLASS_NAMES = {
  Present: styles["delivery-profile-status-present"],
  Absent: styles["delivery-profile-status-absent"],
  "On leave": styles["delivery-profile-status-on-leave"],
};

export default function DeliveryProfilePage() {
  const { login, stops } = useDeliveryPanel();
  // The agent's own row (the database shows a team member only their own)
  const me = useStaffList().find((person) => person.phone === login.mobileNumber);
  // Every route given to them on Routes & agents
  const myRoutes = useDeliveryRoutes().filter((route) => route.agent === login.agent?.name);
  const totalStops = stops.completed.length + stops.upNext.length + (stops.ongoing ? 1 : 0);
  const formattedMobile = `${login.mobileNumber.slice(0, 5)} ${login.mobileNumber.slice(5)}`;

  const details: { label: string; value: string }[] = [
    { label: "Mobile", value: formattedMobile },
    { label: "Role", value: "Delivery agent" },
    { label: "Job", value: me?.job || "—" },
    { label: "Shift", value: me?.shift || "Not set yet" },
    { label: myRoutes.length > 1 ? "Routes" : "Route", value: myRoutes.map((route) => `${route.name} · ${route.area}`).join(", ") || "Not given yet" },
    { label: "Bike", value: login.agent?.bike && login.agent.bike !== "—" ? login.agent.bike : "—" },
  ];

  return (
    <>
      <DeliveryPageHeading title="Profile" description="Your details at Chiranvi Farm." />

      <section className={styles["delivery-profile-card"]} aria-label="Your details">
        <div className={styles["delivery-profile-top-row"]}>
          <span className={styles["delivery-profile-name"]}>{login.name}</span>
          {me && <span className={`${styles["delivery-profile-status"]} ${STATUS_CLASS_NAMES[me.today]}`}>{me.today} today</span>}
        </div>
        <dl className={styles["delivery-profile-details"]}>
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles["delivery-profile-note"]}>
          Your name comes from your Profile on the website.{" "}
          <Link href="/account" className={styles["delivery-profile-link"]}>
            Edit it there
          </Link>
        </p>
      </section>

      {/* Today and this month */}
      <div className={styles["delivery-profile-numbers"]}>
        <div className={styles["delivery-profile-number"]}>
          <span className={styles["delivery-profile-number-value"]}>
            {stops.completed.length}/{totalStops}
          </span>
          <span className={styles["delivery-profile-number-label"]}>Stops done today</span>
        </div>
        <div className={styles["delivery-profile-number"]}>
          <span className={styles["delivery-profile-number-value"]}>{me ? getDaysPresent(me) : "—"}</span>
          <span className={styles["delivery-profile-number-label"]}>Days present this month</span>
        </div>
        <div className={styles["delivery-profile-number"]}>
          <span className={styles["delivery-profile-number-value"]}>{me ? me.daysAbsentThisMonth : "—"}</span>
          <span className={styles["delivery-profile-number-label"]}>Days absent this month</span>
        </div>
      </div>

      {!me && (
        <DeliveryNotice title="Details not found" text="Your number isn't on the staff list yet. Ask your manager to add you in the Staff section.">
          <Link href="/delivery/contact" className={deliveryButtonStyles.outlined}>
            Contact farm
          </Link>
        </DeliveryNotice>
      )}
    </>
  );
}
