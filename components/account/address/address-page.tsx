"use client";

import { useCallback, useState } from "react";
import {
  addAddress,
  formatAddressLine,
  removeAddress,
  setDefaultAddress,
  updateAddress,
  useAddressBook,
  type AddressDetails,
  type SavedAddress,
} from "@/store/address-store";
import { useMyTeamRecord } from "@/store/staff-access-store";
import { AccountPageHeading } from "../account-dashboard-layout";
import AddressFormDialog from "./address-form-dialog";
import styles from "./address-page.module.css";

/*
  "My Addresses" dashboard page (design): one card per saved address.
  - The default address has a green border and a "Default" badge; every other address has a
    "Set as Default" button that makes it the default.
  - "Add new address" opens a pop-up form; the saved address appears as a new card.
  - "Edit" opens the same form filled in; "Remove" deletes the address (the next one becomes default).
  The addresses are shared with the cart checkout (store/address-store.ts); changes last until the
  page is refreshed.
*/

// The form that is open: none, a new address, or editing one address.
type OpenForm = { mode: "closed" } | { mode: "add" } | { mode: "edit"; address: SavedAddress };

export default function AddressPage() {
  const { addresses: savedAddresses, defaultAddressId } = useAddressBook();
  const isTeamMember = Boolean(useMyTeamRecord());
  const [openForm, setOpenForm] = useState<OpenForm>({ mode: "closed" });
  const closeForm = useCallback(() => setOpenForm({ mode: "closed" }), []);

  function saveAddress(addressDetails: AddressDetails, shouldBeDefault: boolean) {
    if (openForm.mode === "edit") updateAddress(openForm.address.id, addressDetails, shouldBeDefault);
    else addAddress(addressDetails, shouldBeDefault);
    closeForm();
  }

  return (
    <>
      <AccountPageHeading
        title="My Addresses"
        description="We currently deliver only to selected locations in Bengaluru."
        action={
          <button type="button" className={styles["address-add-button"]} onClick={() => setOpenForm({ mode: "add" })}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add new address
          </button>
        }
      />

      {savedAddresses.length === 0 ? (
        <p className={styles["address-empty-message"]}>No saved addresses yet. Add one to get deliveries.</p>
      ) : (
        <ul className={styles["address-list"]}>
          {savedAddresses.map((address) => {
            const isDefault = address.id === defaultAddressId;
            return (
              <li
                key={address.id}
                className={`${styles["address-card"]} ${isDefault ? styles["address-card-default"] : ""}`}
              >
                <div className={styles["address-card-heading-row"]}>
                  <h2 className={styles["address-label"]}>{address.label}</h2>
                  {isDefault ? (
                    <span className={styles["address-default-badge"]}>Default</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Make ${address.label} the default address`}
                      className={styles["address-switch-button"]}
                      onClick={() => setDefaultAddress(address.id)}
                    >
                      Set as Default
                    </button>
                  )}
                </div>
                <p className={styles["address-name"]}>{address.name}</p>
                <p className={styles["address-line"]}>{formatAddressLine(address)}</p>
                <p className={styles["address-line"]}>{address.mobileNumber}</p>

                {/* A team member's Profile addresses change by a request (Profile → Edit details) */}
                {address.isProfileAddress && isTeamMember ? (
                  <p className={styles["address-line"]}>To change this address, use Edit details on your Profile.</p>
                ) : (
                  <div className={styles["address-actions"]}>
                    <button
                      type="button"
                      className={styles["address-action-button"]}
                      onClick={() => setOpenForm({ mode: "edit", address })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles["address-action-button"]} ${styles["address-remove-button"]}`}
                      onClick={() => removeAddress(address.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {openForm.mode !== "closed" && (
        <AddressFormDialog
          addressToEdit={openForm.mode === "edit" ? openForm.address : null}
          isDefaultAtStart={
            openForm.mode === "edit" ? openForm.address.id === defaultAddressId : savedAddresses.length === 0
          }
          onSave={saveAddress}
          onClose={closeForm}
        />
      )}
    </>
  );
}
