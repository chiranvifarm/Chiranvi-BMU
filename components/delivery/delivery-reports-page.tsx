"use client";

import Link from "next/link";
import { formatTime } from "@/store/delivery-agent-store";
import { DeliveryNotice, DeliveryPageHeading, deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-reports-page.module.css";

/*
  Work → Manager reports (/delivery/manager-reports): the problems the agent reported to the manager today
  from a stop (Customer unavailable, Wrong address, Damaged product, ...), newest first, with Waiting or
  Resolved. They are raised from the stop on Ongoing and kept with the agent's day (store/delivery-agent-store.ts).
*/

export default function DeliveryReportsPage() {
  const { stops } = useDeliveryPanel();
  const { requests } = stops;
  const waiting = requests.filter((request) => request.status === "Pending").length;

  return (
    <>
      <DeliveryPageHeading title="Manager reports" description="Problems you reported to your manager today." />

      <div className={styles["delivery-reports-numbers"]}>
        <div className={styles["delivery-reports-number"]}>
          <span className={styles["delivery-reports-number-value"]}>{requests.length}</span>
          <span className={styles["delivery-reports-number-label"]}>Reported today</span>
        </div>
        <div className={styles["delivery-reports-number"]}>
          <span className={styles["delivery-reports-number-value"]}>{waiting}</span>
          <span className={styles["delivery-reports-number-label"]}>Waiting</span>
        </div>
        <div className={styles["delivery-reports-number"]}>
          <span className={styles["delivery-reports-number-value"]}>{requests.length - waiting}</span>
          <span className={styles["delivery-reports-number-label"]}>Resolved</span>
        </div>
      </div>

      {requests.length === 0 ? (
        <DeliveryNotice title="Nothing reported today" text="To report a problem at a stop (customer not there, wrong address, damaged product…), open the stop on Ongoing.">
          <Link href="/delivery" className={deliveryButtonStyles.outlined}>
            Go to Ongoing
          </Link>
        </DeliveryNotice>
      ) : (
        <ul className={styles["delivery-reports-list"]}>
          {requests.map((request) => (
            <li key={request.id} className={styles["delivery-reports-item"]}>
              <div className={styles["delivery-reports-item-top-row"]}>
                <span className={styles["delivery-reports-kind"]}>{request.kind}</span>
                <span
                  className={`${styles["delivery-reports-status"]} ${
                    request.status === "Resolved" ? styles["delivery-reports-status-resolved"] : styles["delivery-reports-status-waiting"]
                  }`}
                >
                  {request.status === "Resolved" ? "Resolved" : "Waiting"}
                </span>
              </div>
              <p className={styles["delivery-reports-detail"]}>
                {request.customerName} · {request.deliveryId} · {formatTime(request.raisedAt)}
              </p>
              {request.note && <p className={styles["delivery-reports-note"]}>{request.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
