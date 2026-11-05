"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./bengaluru-area-picker.module.css";

/*
  The Bengaluru area box used on every form that asks for the area: the delivery request pop-up (landing
  page), the address form (My Addresses and the cart), the Profile page and Chiranvi Panel → Customers.
  The list is the areas Chiranvi delivers to.
  Anything not on the list is "Others": the form then shows its own box to type the location, and saves
  that text as the area. Opening a saved area that is not on the list shows "Others" with the text
  (areaChoiceFor / otherAreaTextFor).
*/

/*
  The areas Chiranvi delivers to. Each is also a route on Routes & agents and in the database's list (app_settings
  "delivery_service", 0039_service_areas_and_hub.sql), so change them together. No pincode is filled in: several
  areas share one, so the customer types their own.
*/
export const BENGALURU_AREA_PINCODES: Record<string, string> = {
  Uttarahalli: "",
  Chikkalasandra: "",
  Vajarahalli: "",
  Gubbalala: "",
  "BCMC Layout": "",
  "Narayana Nagar": "",
  "ISRO Layout": "",
  "Silk Institute": "",
};
export const BENGALURU_AREAS = Object.keys(BENGALURU_AREA_PINCODES);
export const OTHER_AREA = "Others";
const AREA_CHOICES = [...BENGALURU_AREAS, OTHER_AREA];

// The pincode to fill in for a chosen area ("Others" or nothing: empty, for the customer to type)
export function pincodeForArea(area: string) {
  return BENGALURU_AREA_PINCODES[area] ?? "";
}

// A saved area shown in the box: a listed area as it is, anything else typed as "Others"
export function areaChoiceFor(savedArea: string) {
  const area = savedArea.trim();
  if (!area) return "";
  return area in BENGALURU_AREA_PINCODES ? area : OTHER_AREA;
}

// The text for the "Others" box when a saved area is not on the list
export function otherAreaTextFor(savedArea: string) {
  return areaChoiceFor(savedArea) === OTHER_AREA ? savedArea.trim() : "";
}

/*
  Note under the Pincode box once a listed area has filled it in: the pincode may not be the customer's
  exact one (an area can have more than one), so it asks them to check it before submitting.
*/
export function PincodeCheckNote({ look }: { look: "landing" | "account" | "admin" }) {
  return (
    <span className={`${styles["pincode-check-note"]} ${styles[`pincode-check-note-${look}`]}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 7.5v.5" />
      </svg>
      Verify &amp; Edit Pincode Before Submission
    </span>
  );
}

/*
  A box that opens its list inside itself (the box grows downwards and the list scrolls), instead of the
  browser's own dropdown. The chosen area is shown light green with a tick.
  Keyboard: Enter / Space / ↓ open it, ↑ ↓ move, Enter chooses, Escape closes the list only.
  A click outside the box closes the list.
  look: the size of the form's other boxes (landing pop-up, account pages, or the Chiranvi Panel).
  labelId: the id of the field's label text, read out with the box.
*/
export default function BengaluruAreaPicker({
  area,
  onChoose,
  labelId,
  look,
  hasError = false,
  isDisabled = false,
  className = "",
}: {
  area: string;
  onChoose: (area: string) => void;
  labelId: string;
  look: "landing" | "account" | "admin";
  hasError?: boolean;
  isDisabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The highlighted row while the list is open (keyboard and mouse)
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isListShown = isOpen && !isDisabled;

  function open() {
    setActiveIndex(Math.max(0, AREA_CHOICES.indexOf(area)));
    setIsOpen(true);
  }
  function choose(choice: string) {
    onChoose(choice);
    setIsOpen(false);
  }

  // Click outside the box: close the list
  useEffect(() => {
    if (!isListShown) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isListShown]);

  // Keep the highlighted row in view inside the list
  useEffect(() => {
    if (!isListShown) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [isListShown, activeIndex]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!isListShown) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(AREA_CHOICES.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(AREA_CHOICES[activeIndex]);
    } else if (event.key === "Escape") {
      // Closes the list, not the whole pop-up
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setIsOpen(false);
    }
  }

  return (
    <div
      ref={pickerRef}
      className={`${styles["bengaluru-area-picker"]} ${styles[`bengaluru-area-picker-${look}`]} ${
        isListShown ? styles["bengaluru-area-picker-open"] : ""
      } ${hasError ? styles["bengaluru-area-picker-error"] : ""} ${isDisabled ? styles["bengaluru-area-picker-locked"] : ""} ${className}`}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isListShown}
        aria-labelledby={labelId}
        disabled={isDisabled}
        className={`${styles["bengaluru-area-picker-button"]} ${area ? "" : styles["bengaluru-area-picker-placeholder"]}`}
        onClick={() => (isListShown ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
      >
        <span className={styles["bengaluru-area-picker-chosen-text"]}>{area || "Choose your area in Bengaluru"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["bengaluru-area-picker-arrow"]}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isListShown && (
        <ul ref={listRef} role="listbox" aria-labelledby={labelId} className={styles["bengaluru-area-picker-list"]} data-lenis-prevent>
          {AREA_CHOICES.map((choice, index) => (
            <li
              key={choice}
              role="option"
              aria-selected={choice === area}
              className={`${styles["bengaluru-area-picker-option"]} ${index === activeIndex ? styles["bengaluru-area-picker-option-active"] : ""} ${
                choice === area ? styles["bengaluru-area-picker-option-chosen"] : ""
              }`}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={(event) => {
                // Inside a <label> (Chiranvi Panel forms), a click would otherwise also reopen the box
                event.preventDefault();
                choose(choice);
              }}
            >
              {choice}
              {choice === area && (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
