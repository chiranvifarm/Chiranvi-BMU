"use client";

import { useMemo, useState } from "react";
import { toDateKey } from "@/store/admin-deliveries-store";
import { STOP_OUTCOME_LABELS, formatTime, rupees, shownPlaceOf, type AgentStop, type StopOutcome } from "@/store/delivery-agent-store";
import { DeliveryNotice, DeliveryPageHeading, DeliveryShiftNotices, deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-completed-page.module.css";

/*
  Deliveries → Completed (/delivery/completed): today's finished stops, newest first.
  - Daily totals: delivered (with left at door), failed (not delivered), bottles collected, cash collected.
  - Search (customer, address or delivery ID) and a filter by how the stop ended.
  - Each stop: when it was finished, Delivered / Left at door / Not delivered (with the reason), the proof
    (the customer's OTP, or the photo), and the requests raised for it with their status.
  - All requests raised today, Pending or Resolved.
  - Download the day's delivery report (a CSV file that opens in Excel or Google Sheets).
  Off duty: the area instead of the address, and no report (it has the phone numbers and addresses).
  Stops the panel already shows as delivered count too (their bottles and cash as expected).
*/

type OutcomeFilter = "all" | StopOutcome;

// Bottles and cash for a finished stop: what the agent entered, or what was expected for a delivered stop
function bottlesCollectedAt(stop: AgentStop) {
  if (stop.outcome === "not-delivered") return 0;
  return stop.bottlesCollected ?? stop.bottlesToCollect;
}

function cashCollectedAt(stop: AgentStop) {
  if (stop.outcome !== "delivered") return 0;
  return stop.cashCollected ?? stop.cashToCollect;
}

function proofText(stop: AgentStop) {
  if (!stop.proof) return "";
  return stop.proof.kind === "otp" ? `OTP ••${stop.proof.code.slice(-2)}` : "Photo";
}

export default function DeliveryCompletedPage() {
  const { login, stops } = useDeliveryPanel();
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const { completed, requests } = stops;

  const totals = useMemo(
    () => ({
      delivered: completed.filter((stop) => stop.outcome !== "not-delivered").length,
      failed: completed.filter((stop) => stop.outcome === "not-delivered").length,
      bottles: completed.reduce((sum, stop) => sum + bottlesCollectedAt(stop), 0),
      cash: completed.reduce((sum, stop) => sum + cashCollectedAt(stop), 0),
    }),
    [completed],
  );

  const shownStops = useMemo(() => {
    const words = search.trim().toLowerCase();
    return completed.filter(
      (stop) =>
        (outcomeFilter === "all" || stop.outcome === outcomeFilter) &&
        (!words || `${stop.customerName} ${shownPlaceOf(stop, stops.isOnDuty)} ${stop.id}`.toLowerCase().includes(words)),
    );
  }, [completed, search, outcomeFilter, stops.isOnDuty]);

  // The day's report: one row per finished stop
  function downloadReport() {
    const header = ["Delivery ID", "Finished at", "Customer", "Phone", "Address", "Slot", "Status", "Reason", "Proof", "Items", "Bottles collected", "Cash collected (₹)"];
    const rows = completed.map((stop) => [
      stop.id,
      stop.finishedAt ? formatTime(stop.finishedAt) : "",
      stop.customerName,
      stop.phone,
      stop.address,
      stop.slot,
      stop.outcome ? STOP_OUTCOME_LABELS[stop.outcome] : "",
      stop.notDeliveredReason ?? "",
      proofText(stop),
      stop.items.map((item) => `${item.name} ${item.packSize} x ${item.quantity}`).join("; "),
      String(bottlesCollectedAt(stop)),
      String(cashCollectedAt(stop)),
    ]);
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = `delivery-report-${login.name.replace(/\s+/g, "-").toLowerCase()}-${toDateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <DeliveryPageHeading title="Completed" description="Today's finished stops, newest first.">
        {completed.length > 0 && (
          <button
            type="button"
            disabled={!stops.isOnDuty}
            className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
            onClick={downloadReport}
          >
            Download today&apos;s report
          </button>
        )}
      </DeliveryPageHeading>
      <DeliveryShiftNotices />

      {/* Daily totals */}
      <div className={styles["completed-totals"]}>
        <div className={styles["completed-total"]}>
          <span className={styles["completed-total-value"]}>{totals.delivered}</span>
          <span className={styles["completed-total-label"]}>Delivered</span>
        </div>
        <div className={styles["completed-total"]}>
          <span className={`${styles["completed-total-value"]} ${totals.failed > 0 ? styles["completed-total-value-failed"] : ""}`}>
            {totals.failed}
          </span>
          <span className={styles["completed-total-label"]}>Failed</span>
        </div>
        <div className={styles["completed-total"]}>
          <span className={styles["completed-total-value"]}>{totals.bottles}</span>
          <span className={styles["completed-total-label"]}>Bottles collected</span>
        </div>
        <div className={styles["completed-total"]}>
          <span className={styles["completed-total-value"]}>{rupees(totals.cash)}</span>
          <span className={styles["completed-total-label"]}>Cash collected</span>
        </div>
      </div>

      {login.route && completed.length === 0 && (
        <DeliveryNotice title="Nothing finished yet" text="Stops you finish on Ongoing show here, with their proof." />
      )}

      {completed.length > 0 && (
        <>
          <div className={styles["completed-filters"]}>
            <input
              type="search"
              className={styles["completed-search"]}
              placeholder="Search customer, address or ID"
              aria-label="Search completed stops"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles["completed-filter-buttons"]} role="group" aria-label="Show">
              {(["all", "delivered", "left-at-door", "not-delivered"] as OutcomeFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={outcomeFilter === filter}
                  className={`${styles["completed-filter-button"]} ${outcomeFilter === filter ? styles["completed-filter-button-chosen"] : ""}`}
                  onClick={() => setOutcomeFilter(filter)}
                >
                  {filter === "all" ? "All" : STOP_OUTCOME_LABELS[filter]}
                </button>
              ))}
            </div>
          </div>

          {shownStops.length === 0 ? (
            <p className={styles["completed-empty"]}>No finished stops match.</p>
          ) : (
            <ul className={styles["completed-list"]}>
              {shownStops.map((stop) => (
                <li key={stop.id} className={styles["completed-stop"]}>
                  <div className={styles["completed-stop-time"]}>{stop.finishedAt ? formatTime(stop.finishedAt) : "—"}</div>
                  <div className={styles["completed-stop-body"]}>
                    <div className={styles["completed-stop-top-row"]}>
                      <span className={styles["completed-stop-customer"]}>{stop.customerName}</span>
                      {stop.outcome && (
                        <span className={`${styles["completed-status"]} ${styles[`completed-status-${stop.outcome}`]}`}>
                          {STOP_OUTCOME_LABELS[stop.outcome]}
                        </span>
                      )}
                    </div>
                    <p className={styles["completed-stop-address"]}>
                      {shownPlaceOf(stop, stops.isOnDuty)} · {stop.id}
                    </p>
                    {stop.notDeliveredReason && <p className={styles["completed-stop-reason"]}>Reason: {stop.notDeliveredReason}</p>}
                    <div className={styles["completed-stop-details"]}>
                      {stop.proof?.kind === "otp" && <span className={styles["completed-proof"]}>Proof: {proofText(stop)}</span>}
                      {stop.proof?.kind === "photo" && (
                        <button type="button" className={styles["completed-proof-photo-button"]} onClick={() => setOpenPhoto(stop.proof?.kind === "photo" ? stop.proof.photo : null)}>
                          Proof: see photo
                        </button>
                      )}
                      {bottlesCollectedAt(stop) > 0 && <span className={styles["completed-detail"]}>Bottles {bottlesCollectedAt(stop)}</span>}
                      {cashCollectedAt(stop) > 0 && <span className={styles["completed-detail"]}>Cash {rupees(cashCollectedAt(stop))}</span>}
                    </div>
                    {stop.requests.map((request) => (
                      <p key={request.id} className={styles["completed-stop-request"]}>
                        Request: {request.kind} ·{" "}
                        <span className={request.status === "Resolved" ? styles["completed-request-resolved"] : styles["completed-request-pending"]}>
                          {request.status}
                        </span>
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Requests raised today */}
      <section className={styles["completed-requests"]} aria-labelledby="completed-requests-title">
        <h2 id="completed-requests-title" className={styles["completed-requests-title"]}>
          Requests raised today
        </h2>
        {requests.length === 0 ? (
          <p className={styles["completed-empty"]}>No requests raised today.</p>
        ) : (
          <ul className={styles["completed-request-list"]}>
            {requests.map((request) => (
              <li key={request.id} className={styles["completed-request"]}>
                <span>
                  <span className={styles["completed-request-kind"]}>{request.kind}</span>
                  <span className={styles["completed-request-for"]}>
                    {request.customerName} · {formatTime(request.raisedAt)}
                    {request.note ? ` · ${request.note}` : ""}
                  </span>
                </span>
                <span className={`${styles["completed-status"]} ${request.status === "Resolved" ? styles["completed-status-delivered"] : styles["completed-status-pending"]}`}>
                  {request.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openPhoto && (
        <div className={styles["completed-photo-backdrop"]} onClick={() => setOpenPhoto(null)} role="dialog" aria-label="Proof photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- a photo taken by the agent, not a site image */}
          <img src={openPhoto} alt="Proof of delivery" className={styles["completed-photo"]} />
        </div>
      )}
    </>
  );
}
