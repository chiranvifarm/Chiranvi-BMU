"use client";

import { useEffect, useState } from "react";
import { formatIndianMobileNumber } from "@/components/account/account-profile";
import { confirmNewNumberOtp, sendNewNumberOtp } from "@/store/staff-access-store";
import styles from "./profile-details-page.module.css";

/*
  Changing the login number with an OTP sent to the new one (0029_… and 0031_…sql).
  - Customers: from "Edit details" → "Change number": type the new number, confirm the OTP.
  - Team members: their new number is part of their Profile request; once it is accepted and saved they
    confirm the OTP here (inside the Edit details pop-up).
  After the OTP everything moves to the new number (orders, addresses, staff record, panel), so the page
  opens again with it. The owner has their own "Change number" on Roles & permissions.
*/

export default function NumberChangeDialog({ mobileNumber, onClose }: { mobileNumber: string; onClose: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className={styles["profile-delete-dialog-overlay"]} data-lenis-prevent>
      <button type="button" aria-label="Close" className={styles["profile-delete-dialog-dimmed-page"]} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="profile-number-dialog-heading" className={styles["profile-change-dialog"]}>
        <div className={styles["profile-change-dialog-title-row"]}>
          <h2 id="profile-number-dialog-heading" className={styles["profile-change-heading"]}>
            Change your number
          </h2>
          <button type="button" aria-label="Close" className={styles["profile-change-dialog-close"]} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <NumberOtpSteps currentNumber={mobileNumber} />
      </div>
    </div>
  );
}

// The new number (typed, or the accepted one), then the OTP sent to it
export function NumberOtpSteps({ currentNumber, fixedNewNumber }: { currentNumber?: string; fixedNewNumber?: string }) {
  const [newNumber, setNewNumber] = useState(fixedNewNumber ?? "");
  const [otp, setOtp] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [problem, setProblem] = useState("");

  async function sendOtp() {
    if (!/^\d{10}$/.test(newNumber) || newNumber === currentNumber) {
      setProblem("Enter a new 10-digit number");
      return;
    }
    setIsWorking(true);
    const sendProblem = await sendNewNumberOtp(newNumber);
    setIsWorking(false);
    setProblem(sendProblem ?? "");
    if (!sendProblem) setIsOtpSent(true);
  }

  async function confirmOtp() {
    setIsWorking(true);
    const confirmProblem = await confirmNewNumberOtp(newNumber, otp);
    setIsWorking(false);
    if (confirmProblem) {
      setProblem(confirmProblem);
      return;
    }
    // Everything now belongs to the new number: open the account again with it
    window.location.reload();
  }

  return (
    <div className={styles["profile-change-block"]}>
      <div className={styles["profile-change-fields"]}>
        {!fixedNewNumber && (
          <label className={styles["profile-form-field"]}>
            <span className={styles["profile-form-label"]}>New mobile number</span>
            <input
              className={styles["profile-form-input"]}
              type="tel"
              inputMode="numeric"
              value={newNumber}
              disabled={isOtpSent}
              onChange={(event) => setNewNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
            />
          </label>
        )}
        {isOtpSent && (
          <label className={styles["profile-form-field"]}>
            <span className={styles["profile-form-label"]}>OTP sent to {formatIndianMobileNumber(newNumber)}</span>
            <input
              className={styles["profile-form-input"]}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
        )}
      </div>
      {problem && (
        <p className={styles["profile-change-problem"]} role="alert">
          {problem}
        </p>
      )}
      <button
        type="button"
        className={styles["profile-change-button"]}
        disabled={isWorking}
        onClick={() => void (isOtpSent ? confirmOtp() : sendOtp())}
      >
        {isWorking ? "Please wait…" : isOtpSent ? "Confirm new number" : `Send OTP to ${fixedNewNumber ? formatIndianMobileNumber(fixedNewNumber) : "the new number"}`}
      </button>
    </div>
  );
}
