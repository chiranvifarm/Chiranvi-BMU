"use client";

import { useMemo, useRef, useState } from "react";
import { toDateKey } from "@/store/admin-deliveries-store";
import {
  LEAVE_DOCUMENT_TYPES,
  LEAVE_TYPES,
  askForMyLeave,
  getLeaveDays,
  getLeaveLeft,
  leaveDocumentProblem,
  useLeaveRequests,
  type LeaveType,
} from "@/store/admin-leave-store";
import { getDaysPresent, useStaffList } from "@/store/admin-staff-store";
import { DeliveryPageHeading, deliveryButtonStyles, useDeliveryPanel } from "./delivery-panel-layout";
import styles from "./delivery-leaves-page.module.css";

/*
  Work → Leaves & attendance (/delivery/leaves).
  - Attendance this month from the staff list (staff_members): today's status, days present, days absent.
  - Ask for leave: type, from, to (one day for a half day), reason, and a document if they have one (a photo
    or a PDF). Saved in leave_requests as Pending; the owner or a manager approves or rejects it on Roles &
    permissions, and opens the document from the Staff page's Leave requests.
  - My leave requests, newest first, with their status (and why, if rejected), and the days left of each
    type this year.
*/

// "4 Nov" (and the year when it isn't this year)
function formatDay(dayKey: string) {
  const date = new Date(`${dayKey}T12:00:00`);
  const isThisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(isThisYear ? {} : { year: "numeric" }) });
}

const STATUS_CLASS_NAMES = {
  Pending: styles["delivery-leaves-status-pending"],
  Approved: styles["delivery-leaves-status-approved"],
  Rejected: styles["delivery-leaves-status-rejected"],
};

export default function DeliveryLeavesPage() {
  const { login } = useDeliveryPanel();
  const me = useStaffList().find((person) => person.phone === login.mobileNumber);
  const allRequests = useLeaveRequests();
  const myRequests = useMemo(() => allRequests.filter((request) => request.staffMobile === login.mobileNumber), [allRequests, login.mobileNumber]);
  const today = toDateKey(new Date());
  const [type, setType] = useState<LeaveType>("Casual");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [leaveDocument, setLeaveDocument] = useState<File | null>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSending, setIsSending] = useState(false);

  const isHalfDay = type === "Half day";
  const days = getLeaveDays({ type, from, to: isHalfDay ? from : to });
  const myName = me?.name ?? login.name;
  const daysLeft = getLeaveLeft(myName, type, myRequests);

  function chooseDocument(file: File | undefined) {
    if (!file) return;
    const problem = leaveDocumentProblem(file);
    setMessage(problem ? { text: problem, isError: true } : null);
    if (!problem) setLeaveDocument(file);
  }

  async function sendRequest() {
    if (!from || (!isHalfDay && (!to || to < from))) {
      setMessage({ text: "Choose the dates: the last day can't be before the first.", isError: true });
      return;
    }
    if (from < today) {
      setMessage({ text: "Leave can start today or later.", isError: true });
      return;
    }
    if (!reason.trim()) {
      setMessage({ text: "Write a short reason.", isError: true });
      return;
    }
    setIsSending(true);
    const problem = await askForMyLeave(login.mobileNumber, { type, from, to: isHalfDay ? from : to, reason: reason.trim() }, leaveDocument);
    setIsSending(false);
    if (problem) {
      setMessage({ text: problem, isError: true });
      return;
    }
    setReason("");
    setLeaveDocument(null);
    setMessage({ text: "Leave request sent. Your manager will approve or reject it.", isError: false });
  }

  return (
    <>
      <DeliveryPageHeading title="Leaves & attendance" description="Your attendance this month, and your leave requests." />

      {/* Attendance this month */}
      <div className={styles["delivery-leaves-numbers"]}>
        <div className={styles["delivery-leaves-number"]}>
          <span className={styles["delivery-leaves-number-value"]}>{me?.today ?? "—"}</span>
          <span className={styles["delivery-leaves-number-label"]}>Today</span>
        </div>
        <div className={styles["delivery-leaves-number"]}>
          <span className={styles["delivery-leaves-number-value"]}>{me ? getDaysPresent(me) : "—"}</span>
          <span className={styles["delivery-leaves-number-label"]}>Days present this month</span>
        </div>
        <div className={styles["delivery-leaves-number"]}>
          <span className={styles["delivery-leaves-number-value"]}>{me ? me.daysAbsentThisMonth : "—"}</span>
          <span className={styles["delivery-leaves-number-label"]}>Days absent this month</span>
        </div>
      </div>

      <div className={styles["delivery-leaves-columns"]}>
        {/* Ask for leave */}
        <form
          className={styles["delivery-leaves-card"]}
          aria-labelledby="delivery-leaves-ask-title"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void sendRequest();
          }}
        >
          <h2 id="delivery-leaves-ask-title" className={styles["delivery-leaves-card-title"]}>
            Ask for leave
          </h2>
          <label className={styles["delivery-leaves-field"]}>
            <span>Type</span>
            <select value={type} onChange={(changeEvent) => setType(changeEvent.target.value as LeaveType)}>
              {LEAVE_TYPES.map((leaveType) => (
                <option key={leaveType}>{leaveType}</option>
              ))}
            </select>
          </label>
          <div className={styles["delivery-leaves-date-row"]}>
            <label className={styles["delivery-leaves-field"]}>
              <span>{isHalfDay ? "Day" : "From"}</span>
              <input
                type="date"
                min={today}
                value={from}
                onChange={(changeEvent) => {
                  setFrom(changeEvent.target.value);
                  if (to < changeEvent.target.value) setTo(changeEvent.target.value);
                }}
              />
            </label>
            {!isHalfDay && (
              <label className={styles["delivery-leaves-field"]}>
                <span>To</span>
                <input type="date" min={from || today} value={to} onChange={(changeEvent) => setTo(changeEvent.target.value)} />
              </label>
            )}
          </div>
          <label className={styles["delivery-leaves-field"]}>
            <span>Reason</span>
            <textarea rows={3} value={reason} placeholder="Why you need leave" onChange={(changeEvent) => setReason(changeEvent.target.value)} />
          </label>
          <div className={styles["delivery-leaves-document"]}>
            <span className={styles["delivery-leaves-document-label"]}>Document (optional)</span>
            <div className={styles["delivery-leaves-document-row"]}>
              <button
                type="button"
                className={`${deliveryButtonStyles.outlined} ${deliveryButtonStyles.small}`}
                onClick={() => documentInputRef.current?.click()}
              >
                {leaveDocument ? "Change document" : "Attach document"}
              </button>
              {leaveDocument && (
                <>
                  <span className={styles["delivery-leaves-document-name"]}>{leaveDocument.name}</span>
                  <button type="button" className={styles["delivery-leaves-document-remove"]} onClick={() => setLeaveDocument(null)}>
                    Remove
                  </button>
                </>
              )}
            </div>
            <span className={styles["delivery-leaves-document-hint"]}>A photo or PDF, up to 5 MB.</span>
            <input
              ref={documentInputRef}
              hidden
              type="file"
              accept={LEAVE_DOCUMENT_TYPES}
              aria-label="Attach a document"
              onChange={(changeEvent) => {
                chooseDocument(changeEvent.target.files?.[0]);
                // The same file can be chosen again
                changeEvent.target.value = "";
              }}
            />
          </div>
          <p className={styles["delivery-leaves-days-note"]}>
            {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "—"}
            {daysLeft !== null ? ` · ${daysLeft} ${type.toLowerCase()} day${daysLeft === 1 ? "" : "s"} left this year` : " · no limit"}
          </p>
          {message && (
            <p className={message.isError ? styles["delivery-leaves-message-error"] : styles["delivery-leaves-message"]} role="status">
              {message.text}
            </p>
          )}
          <button type="submit" className={deliveryButtonStyles.filled} disabled={isSending}>
            {isSending ? "Sending…" : "Send request"}
          </button>
        </form>

        {/* My leave requests */}
        <section className={styles["delivery-leaves-card"]} aria-labelledby="delivery-leaves-mine-title">
          <h2 id="delivery-leaves-mine-title" className={styles["delivery-leaves-card-title"]}>
            My leave requests
          </h2>
          {myRequests.length === 0 ? (
            <p className={styles["delivery-leaves-empty"]}>No leave requests yet.</p>
          ) : (
            <ul className={styles["delivery-leaves-list"]}>
              {myRequests.map((request) => (
                <li key={request.id} className={styles["delivery-leaves-request"]}>
                  <div className={styles["delivery-leaves-request-top-row"]}>
                    <span className={styles["delivery-leaves-request-dates"]}>
                      {request.from === request.to ? formatDay(request.from) : `${formatDay(request.from)} – ${formatDay(request.to)}`}
                    </span>
                    <span className={`${styles["delivery-leaves-status"]} ${STATUS_CLASS_NAMES[request.status]}`}>
                      {request.status === "Pending" ? "Waiting" : request.status}
                    </span>
                  </div>
                  <p className={styles["delivery-leaves-request-detail"]}>
                    {request.type} · {getLeaveDays(request)} day{getLeaveDays(request) === 1 ? "" : "s"}
                    {request.reason ? ` · ${request.reason}` : ""}
                  </p>
                  {request.attachment && <p className={styles["delivery-leaves-request-detail"]}>Attached: {request.attachment.fileName}</p>}
                  {request.status === "Rejected" && request.rejectReason && (
                    <p className={styles["delivery-leaves-reject-reason"]}>Why: {request.rejectReason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
