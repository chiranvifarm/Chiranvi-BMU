"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./logout-confirmation-dialog.module.css";

/*
  "Log out?" box (design), shown over the dimmed dashboard when Logout is clicked.
  Two choices: "This device" (chosen at first: the other devices stay logged in) or "All devices" (every
  login of this number ends, e.g. after losing a phone). Cancel, Escape or a click on the dimmed page closes
  it; "Log out" logs out the chosen way.
*/

export type LogoutChoice = "this-device" | "everywhere";

const LOGOUT_CHOICES: { key: LogoutChoice; title: string; text: string }[] = [
  { key: "this-device", title: "This device", text: "You stay logged in on your other devices." },
  { key: "everywhere", title: "All devices", text: "Logs you out on every phone and computer." },
];

export default function LogoutConfirmationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (choice: LogoutChoice) => void;
}) {
  const [choice, setChoice] = useState<LogoutChoice>("this-device");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // Latest onCancel, so the Escape listener below is set up only once.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Cancel is focused first (the safe choice), and Escape closes the box.
  useEffect(() => {
    cancelButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div className={styles["logout-dialog-overlay"]} data-lenis-prevent>
      <button type="button" aria-label="Stay logged in" className={styles["logout-dialog-dimmed-page"]} onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-dialog-heading"
        aria-describedby="logout-dialog-description"
        className={styles["logout-dialog"]}
      >
        <span className={styles["logout-dialog-icon-circle"]} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M10 4H5v16h5" />
            <path d="M14 8l4 4-4 4M18 12H9" />
          </svg>
        </span>
        <h2 id="logout-dialog-heading" className={styles["logout-dialog-heading"]}>
          Log out?
        </h2>
        <p id="logout-dialog-description" className={styles["logout-dialog-description"]}>
          Your deliveries will continue as usual.
        </p>
        {/* Where to log out: this device (chosen) or all devices */}
        <div className={styles["logout-dialog-choices"]} role="radiogroup" aria-label="Log out of">
          {LOGOUT_CHOICES.map((logoutChoice) => {
            const isChosen = choice === logoutChoice.key;
            return (
              <button
                key={logoutChoice.key}
                type="button"
                role="radio"
                aria-checked={isChosen}
                className={`${styles["logout-dialog-choice"]} ${isChosen ? styles["logout-dialog-choice-chosen"] : ""}`}
                onClick={() => setChoice(logoutChoice.key)}
              >
                <span className={styles["logout-dialog-choice-dot"]} aria-hidden="true" />
                <span className={styles["logout-dialog-choice-words"]}>
                  <span className={styles["logout-dialog-choice-title"]}>{logoutChoice.title}</span>
                  <span className={styles["logout-dialog-choice-text"]}>{logoutChoice.text}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles["logout-dialog-buttons"]}>
          <button ref={cancelButtonRef} type="button" className={styles["logout-dialog-cancel-button"]} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles["logout-dialog-confirm-button"]} onClick={() => onConfirm(choice)}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
