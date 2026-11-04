"use client";

import { useEffect } from "react";
import {
  formatTime,
  learnPlanEvents,
  markNotificationsRead,
  useAssignedPlans,
  type AgentNotification,
  type AgentStops,
} from "@/store/delivery-agent-store";
import styles from "./delivery-alerts.module.css";

/*
  The Delivery Panel's notifications on the dashboard: a manager gave a stop, a route changed, a skip or pause was
  approved. They stay on the screen, on every page, until the agent presses OK (one) or Mark all as read; then
  they are in the bell's list. Each kind has its own colour and icon. Read ones are kept in the agent's day
  (the database). Skips and pauses come from the plans given to this agent (my_assigned_plans()).
*/

type Tone = "green" | "yellow" | "grey" | "gold";

const LOOK_OF_KIND: Record<AgentNotification["kind"], { tone: Tone; iconPaths: string[] }> = {
  "new-stop": { tone: "green", iconPaths: ["M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z", "M12 11.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"] },
  "route-change": { tone: "gold", iconPaths: ["M4 8h13l-3-3", "M20 16H7l3 3"] },
  "status-change": { tone: "green", iconPaths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M8 12.5l2.5 2.5 5.5-5.5"] },
  "request-update": { tone: "gold", iconPaths: ["M9 3.5h6v3H9z", "M7 5H5.5v15.5h13V5H17"] },
  "manager-message": { tone: "yellow", iconPaths: ["M4 5h16v11H8l-4 4V5Z"] },
  skip: { tone: "yellow", iconPaths: ["M5 5l8 7-8 7V5Z", "M18 5v14"] },
  pause: { tone: "grey", iconPaths: ["M9 5v14", "M15 5v14"] },
};

// "New stop: Suresh Gowda, Kengeri" → title and details
function splitText(text: string) {
  const colon = text.indexOf(": ");
  return colon < 0 ? { title: text, detail: "" } : { title: text.slice(0, colon), detail: text.slice(colon + 2) };
}

// One notification: coloured icon, title, details and time (the pop-up adds OK; the bell's list shows it as it is)
export function NotificationRow({ notification, children }: { notification: AgentNotification; children?: React.ReactNode }) {
  const look = LOOK_OF_KIND[notification.kind];
  const { title, detail } = splitText(notification.text);
  return (
    <div className={`${styles["delivery-alert-row"]} ${styles[`delivery-alert-row-${look.tone}`]}`}>
      <span className={`${styles["delivery-alert-icon"]} ${styles[`delivery-alert-icon-${look.tone}`]}`} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          {look.iconPaths.map((path) => (
            <path key={path} d={path} />
          ))}
        </svg>
      </span>
      <span className={styles["delivery-alert-text"]}>
        <span className={styles["delivery-alert-title"]}>{title}</span>
        {detail && <span className={styles["delivery-alert-detail"]}>{detail}</span>}
        <span className={styles["delivery-alert-time"]}>{formatTime(notification.at)}</span>
      </span>
      {children}
    </div>
  );
}

export default function DeliveryAlerts({ mobileNumber, stops }: { mobileNumber: string; stops: AgentStops }) {
  const { plans } = useAssignedPlans();

  // New skips and pauses on this agent's plans become notifications
  useEffect(() => {
    if (plans && stops.isLoaded) learnPlanEvents(mobileNumber, plans, stops.knownPlanEvents);
  }, [mobileNumber, plans, stops.isLoaded, stops.knownPlanEvents]);

  const unread = stops.unreadNotifications;
  if (unread.length === 0) return null;

  return (
    <aside className={styles["delivery-alerts"]} aria-label="New notifications" data-lenis-prevent>
      <div className={styles["delivery-alerts-heading"]}>
        <span className={styles["delivery-alerts-title"]}>New for you ({unread.length})</span>
        <button
          type="button"
          className={styles["delivery-alerts-read-all"]}
          onClick={() => markNotificationsRead(mobileNumber, unread.map((notification) => notification.id))}
        >
          Mark all as read
        </button>
      </div>
      <ul className={styles["delivery-alerts-list"]}>
        {unread.map((notification) => (
          <li key={notification.id}>
            <NotificationRow notification={notification}>
              <button type="button" className={styles["delivery-alert-ok"]} onClick={() => markNotificationsRead(mobileNumber, [notification.id])}>
                OK
              </button>
            </NotificationRow>
          </li>
        ))}
      </ul>
    </aside>
  );
}
