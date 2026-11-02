"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { ShopProduct } from "@/store/products-store";
import {
  saveDeliverySettings,
  useDeliverySettings,
  type DeliveryCombineRule,
  type ProductDeliveryMode,
} from "@/store/delivery-settings-store";
import styles from "./admin-delivery-charges-popup.module.css";

/*
  Products & pricing → "Set delivery charge" (owner only): the pop-up where the owner sets what customers pay
  for delivery, saved in the database by store/delivery-settings-store.ts (app_settings, checked by the database) and
  charged by the cart.
  - The delivery charge (e.g. ₹30) and the order amount from which delivery is free (e.g. ₹500).
  - Apply to: All products, or Choose manually (tick the products that pay the charge).
  - Each product not ticked opens its own choice: Free delivery, Own charge, Offer: lower charge, or
    Offer: free above an amount.
  - When a cart's products have different charges: the highest one, all added up, or a fixed charge.
  - Choosing "All products" while some products have their own setting first shows a warning: replace
    them, or keep their settings.
*/

type ProductChoice = { mode: Exclude<ProductDeliveryMode, "standard">; fee: number; freeAbove: number };
type ProductState = { isTicked: boolean; choice: ProductChoice };

const COMBINE_RULES: { rule: DeliveryCombineRule; label: string }[] = [
  { rule: "highest", label: "The highest one" },
  { rule: "sum", label: "All of them added up" },
  { rule: "fixed", label: "A fixed charge" },
];

const CHOICES: { mode: ProductChoice["mode"]; label: string }[] = [
  { mode: "free", label: "Free delivery" },
  { mode: "own", label: "Own charge" },
  { mode: "offer-lower", label: "Offer: lower charge" },
  { mode: "offer-free-above", label: "Offer: free above an amount" },
];

// A ₹ amount with − and + buttons (steps of ₹5), never below 0
function RupeeStepper({
  value,
  onChange,
  label,
  step = 5,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  step?: number;
}) {
  return (
    <span className={styles["rupee-stepper"]}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(0, value - step))}>
        −
      </button>
      <span className={styles["rupee-stepper-value"]}>
        ₹
        <input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        />
      </span>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(value + step)}>
        +
      </button>
    </span>
  );
}

export default function AdminDeliveryChargesPopup({
  products,
  onClose,
  onSaved,
}: {
  products: ShopProduct[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const settings = useDeliverySettings();
  const [fee, setFee] = useState(settings.fee);
  const [freeFrom, setFreeFrom] = useState(settings.freeFrom);
  const [combineRule, setCombineRule] = useState<DeliveryCombineRule>(settings.combineRule);
  const [mixedFee, setMixedFee] = useState(settings.mixedFee);
  const [productStates, setProductStates] = useState<Record<string, ProductState>>(() =>
    Object.fromEntries(
      products.map((product) => {
        const own = settings.products[product.productId];
        return [
          product.productId,
          {
            isTicked: !own,
            choice: {
              mode: own?.mode ?? "free",
              fee: own?.fee ?? Math.max(0, settings.fee - 10),
              freeAbove: own?.freeAbove ?? 300,
            },
          },
        ];
      }),
    ),
  );
  const [applyTo, setApplyTo] = useState<"all" | "manual">(
    Object.keys(settings.products).length > 0 ? "manual" : "all",
  );
  const [isReplaceWarningOpen, setIsReplaceWarningOpen] = useState(false);
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [onClose]);

  // Products with their own setting (not paying the overall charge)
  const ownSettingProducts = useMemo(
    () => products.filter((product) => !productStates[product.productId]?.isTicked),
    [products, productStates],
  );
  const tickedCount = products.length - ownSettingProducts.length;

  function updateProduct(productId: string, change: { isTicked?: boolean; choice?: Partial<ProductChoice> }) {
    setProductStates((states) => ({
      ...states,
      [productId]: { ...states[productId], ...change, choice: { ...states[productId].choice, ...change.choice } },
    }));
  }

  function setAllTicked(isTicked: boolean) {
    setProductStates((states) =>
      Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { ...state, isTicked }])),
    );
  }

  // "All products": every product pays the overall charge; ask first if some have their own setting
  function chooseAllProducts() {
    if (ownSettingProducts.length > 0) {
      setIsReplaceWarningOpen(true);
      return;
    }
    setApplyTo("all");
  }

  function replaceOwnSettings() {
    setAllTicked(true);
    setApplyTo("all");
    setOpenProductId(null);
    setIsReplaceWarningOpen(false);
  }

  function describe(product: ShopProduct) {
    const state = productStates[product.productId];
    if (!state || state.isTicked) return `₹${fee}`;
    const { mode, fee: ownFee, freeAbove } = state.choice;
    if (mode === "free") return "Free delivery";
    if (mode === "own") return `Own charge ₹${ownFee}`;
    if (mode === "offer-lower") return `Offer ₹${ownFee} (was ₹${fee})`;
    return `Free above ₹${freeAbove}`;
  }

  async function save() {
    for (const product of ownSettingProducts) {
      const { mode, fee: ownFee, freeAbove } = productStates[product.productId].choice;
      if (mode === "offer-lower" && ownFee >= fee) {
        setOpenProductId(product.productId);
        setProblem(`${product.name}: the offer charge should be lower than the delivery charge (₹${fee}).`);
        return;
      }
      if (mode === "offer-free-above" && freeAbove <= 0) {
        setOpenProductId(product.productId);
        setProblem(`${product.name}: enter the amount above which delivery is free.`);
        return;
      }
    }
    setProblem("");
    setIsSaving(true);
    const error = await saveDeliverySettings({
      fee,
      freeFrom,
      combineRule,
      mixedFee,
      products: products.map((product) => {
        const state = productStates[product.productId];
        return state.isTicked
          ? { productId: product.productId, mode: "standard" as const }
          : {
              productId: product.productId,
              mode: state.choice.mode,
              fee: state.choice.fee,
              freeAbove: state.choice.freeAbove,
            };
      }),
    });
    setIsSaving(false);
    if (error) {
      setProblem(error);
      return;
    }
    onSaved(`Delivery charges saved: ₹${fee} for ${tickedCount} of ${products.length} products`);
  }

  return (
    <div
      className={styles["delivery-popup-backdrop"]}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-popup-title"
        className={styles["delivery-popup"]}
      >
        <div className={styles["delivery-popup-header"]}>
          <h2 id="delivery-popup-title" className={styles["delivery-popup-title"]}>
            Set delivery charge
          </h2>
          <button type="button" aria-label="Close" className={styles["delivery-popup-close"]} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles["delivery-popup-body"]}>
          {/* The overall charge and free delivery */}
          <div className={styles["delivery-setting-row"]}>
            <span className={styles["delivery-setting-label"]}>Delivery charge</span>
            <RupeeStepper value={fee} onChange={setFee} label="delivery charge" />
          </div>
          {applyTo === "manual" && ownSettingProducts.length > 0 && (
            <p className={styles["delivery-setting-note"]}>
              {ownSettingProducts.length === 1
                ? "1 product has its own setting and will not change."
                : `${ownSettingProducts.length} products have their own settings and will not change.`}
            </p>
          )}
          <div className={styles["delivery-setting-row"]}>
            <span className={styles["delivery-setting-label"]}>Free delivery on orders from</span>
            <RupeeStepper value={freeFrom} onChange={setFreeFrom} label="free delivery amount" step={50} />
          </div>
          <p className={styles["delivery-setting-note"]}>Milk plans always get free delivery.</p>

          {/* Apply to */}
          <fieldset className={styles["delivery-choice-group"]}>
            <legend className={styles["delivery-setting-label"]}>Apply to</legend>
            <label className={styles["delivery-radio"]}>
              <input type="radio" name="apply-to" checked={applyTo === "all"} onChange={chooseAllProducts} />
              All products
            </label>
            <label className={styles["delivery-radio"]}>
              <input
                type="radio"
                name="apply-to"
                checked={applyTo === "manual"}
                onChange={() => setApplyTo("manual")}
              />
              Choose manually
            </label>
          </fieldset>

          {isReplaceWarningOpen && (
            <div className={styles["delivery-warning"]} role="alert">
              <p>
                <strong>
                  {ownSettingProducts.length === 1
                    ? "1 product has its own delivery setting:"
                    : `${ownSettingProducts.length} products have their own delivery settings:`}
                </strong>{" "}
                {ownSettingProducts.map((product) => product.name).join(", ")}. Applying the charge to all products will
                replace these settings.
              </p>
              <div className={styles["delivery-warning-buttons"]}>
                <button type="button" className={styles["delivery-danger-button"]} onClick={replaceOwnSettings}>
                  Replace them
                </button>
                <button
                  type="button"
                  className={styles["delivery-plain-button"]}
                  onClick={() => setIsReplaceWarningOpen(false)}
                >
                  Keep their settings
                </button>
              </div>
            </div>
          )}

          {/* Different charges in one cart */}
          <fieldset className={styles["delivery-choice-group"]}>
            <legend className={styles["delivery-setting-label"]}>
              When a cart has products with different charges, charge
            </legend>
            {COMBINE_RULES.map(({ rule, label }) => (
              <label key={rule} className={styles["delivery-radio"]}>
                <input
                  type="radio"
                  name="combine-rule"
                  checked={combineRule === rule}
                  onChange={() => setCombineRule(rule)}
                />
                {label}
                {rule === "fixed" && combineRule === "fixed" && (
                  <RupeeStepper value={mixedFee} onChange={setMixedFee} label="fixed delivery charge" />
                )}
              </label>
            ))}
          </fieldset>

          {/* Products: tick the ones that pay the charge; the others get their own setting */}
          {applyTo === "manual" && (
            <div className={styles["delivery-products"]}>
              <label className={styles["delivery-select-all"]}>
                <input
                  type="checkbox"
                  checked={tickedCount === products.length}
                  ref={(checkbox) => {
                    if (checkbox) checkbox.indeterminate = tickedCount > 0 && tickedCount < products.length;
                  }}
                  onChange={(event) => setAllTicked(event.target.checked)}
                />
                Select all
                <span className={styles["delivery-select-count"]}>
                  {tickedCount} of {products.length} pay ₹{fee}
                </span>
              </label>
              <ul className={styles["delivery-product-list"]}>
                {products.map((product) => {
                  const state = productStates[product.productId];
                  const isOpen = openProductId === product.productId && !state.isTicked;
                  return (
                    <li key={product.productId} className={styles["delivery-product"]}>
                      <div className={styles["delivery-product-row"]}>
                        <input
                          type="checkbox"
                          aria-label={`${product.name} pays the delivery charge`}
                          checked={state.isTicked}
                          onChange={(event) => {
                            updateProduct(product.productId, { isTicked: event.target.checked });
                            setOpenProductId(event.target.checked ? null : product.productId);
                          }}
                        />
                        <span className={styles["delivery-product-picture"]}>
                          {product.imageSource && (
                            <Image
                              src={product.imageSource}
                              alt=""
                              width={product.imageWidth ?? 80}
                              height={product.imageHeight ?? 80}
                              sizes="40px"
                            />
                          )}
                        </span>
                        <span className={styles["delivery-product-name"]}>
                          {product.name}
                          <span className={styles["delivery-product-pack"]}>{product.packSize}</span>
                        </span>
                        {state.isTicked ? (
                          <span className={styles["delivery-product-charge"]}>{describe(product)}</span>
                        ) : (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            className={`${styles["delivery-product-charge"]} ${styles["delivery-product-charge-own"]}`}
                            onClick={() => setOpenProductId(isOpen ? null : product.productId)}
                          >
                            {describe(product)}
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              className={isOpen ? styles["delivery-arrow-open"] : ""}
                            >
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className={styles["delivery-product-choices"]}>
                          {CHOICES.map(({ mode, label }) => (
                            <label key={mode} className={styles["delivery-radio"]}>
                              <input
                                type="radio"
                                name={`choice-${product.productId}`}
                                checked={state.choice.mode === mode}
                                onChange={() => updateProduct(product.productId, { choice: { mode } })}
                              />
                              {label}
                              {state.choice.mode === mode && (mode === "own" || mode === "offer-lower") && (
                                <>
                                  {mode === "offer-lower" && <s className={styles["delivery-struck"]}>₹{fee}</s>}
                                  <RupeeStepper
                                    value={state.choice.fee}
                                    onChange={(value) => updateProduct(product.productId, { choice: { fee: value } })}
                                    label={`${product.name} delivery charge`}
                                  />
                                </>
                              )}
                              {state.choice.mode === mode && mode === "offer-free-above" && (
                                <>
                                  <RupeeStepper
                                    value={state.choice.freeAbove}
                                    onChange={(value) =>
                                      updateProduct(product.productId, { choice: { freeAbove: value } })
                                    }
                                    label={`${product.name} free delivery amount`}
                                    step={50}
                                  />
                                  <span className={styles["delivery-choice-hint"]}>otherwise ₹{fee}</span>
                                </>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className={styles["delivery-popup-footer"]}>
          {problem && (
            <p className={styles["delivery-problem"]} role="alert">
              {problem}
            </p>
          )}
          <div className={styles["delivery-popup-buttons"]}>
            <button type="button" className={styles["delivery-plain-button"]} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles["delivery-save-button"]}
              onClick={() => void save()}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
