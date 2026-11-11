"use client";

import { useCallback, useState } from "react";
import {
  addAddress,
  formatAddressLine,
  removeAddress,
  saveAddressEdit,
  setDefaultAddress,
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
  - An address without a map pin (saved before pins, or made from the Profile) shows "Pin needed", which opens
    its form to place the pin (an address can only be saved with one).
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
    // The Profile's address stays as it is: a change to it is saved as a new address
    if (openForm.mode === "edit") saveAddressEdit(openForm.address, addressDetails, shouldBeDefault);
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
                  <div className={styles["address-card-badges"]}>
                    {/* Saved before addresses had a map pin: opens its form to place the pin */}
                    {!address.pin && (
                      <button
                        type="button"
                        className={styles["address-pin-needed-button"]}
                        title="Place this address's pin on the map to deliver here."
                        onClick={() => setOpenForm({ mode: "edit", address })}
                      >
                        Pin needed
                      </button>
                    )}
                    {/* The address on their Profile (changed only on the Profile page) */}
                    {address.isProfileAddress && (
                      <span className={styles["address-profile-badge"]} title="This is the address on your Profile. Change it on your Profile page.">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                        </svg>
                        Profile address
                      </span>
                    )}
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
                </div>
                <p className={styles["address-name"]}>{address.name}</p>
                <p className={styles["address-line"]}>{formatAddressLine(address)}</p>
                <p className={styles["address-line"]}>{address.mobileNumber}</p>

                {/* A team member can't change their Profile addresses */}
                {address.isProfileAddress && isTeamMember ? null : (
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
