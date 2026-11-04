"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AddressFormDialog, { type ProfileDetailsFromAddress } from "@/components/account/address/address-form-dialog";
import { CART_ICON_CLICKED_ON_CART_PAGE_EVENT } from "@/components/navigation/site-navigation-bar";
import SiteNavigationPlacement from "@/components/navigation/site-navigation-placement";
import BestSellersSection from "@/components/landing/best-sellers/best-sellers-section";
import { rememberPageAfterLogin, useIsLoggedIn, useLoggedInMobileNumber } from "@/components/login/login-status";
import {
  addAddress,
  fillEmptyProfileFromAddress,
  formatAddressLine,
  removeAddress,
  setDefaultAddress,
  updateAddress,
  useAddressBook,
  type AddressDetails,
  type SavedAddress,
} from "@/store/address-store";
import { useCustomerProfile, useIsCustomerProfileKnown } from "@/store/customer-profiles-store";
import {
  addProductToCart,
  changeCartItemQuantity,
  emptyTheCart,
  setAppliedCouponCode,
  setCartSubscription,
  removeCartItem,
  useAppliedCouponCode,
  useCartItems,
  useCartSubscription,
  useIsCartLoaded,
  type CartSubscription,
} from "@/store/cart-store";
import { checkCouponOnServer, useCartCoupons, useCouponCheck, type CouponCart } from "@/store/coupons-store";
import {
  findRunningPlans,
  confirmPayment,
  formatPlanDate,
  priceCartOnServer,
  reportFailedPayment,
  startPayment,
  useOrders,
  type CheckoutPart,
  type Order,
  type RunningPlan,
} from "@/store/orders-store";
import type { OrderPaymentMethod } from "@/store/admin-orders-store";
// Delivery charges and the platform fee set by the owner (Products & pricing → Set delivery charge)
import { productIdOfCartItem, quoteDelivery, useDeliverySettings } from "@/store/delivery-settings-store";
import { useProductPages } from "@/store/product-pages-store";
import styles from "./cart-view.module.css";

/*
  The cart page (/cart):
    Empty cart   the original "My Cart" design: the site navigation bar, back button + "My Cart (0)", the
                 empty-cart message and the landing page's Best Sellers below it (clicking the navigation
                 bar's cart icon here shakes the trolley).
    With products, everything on one page (top bar: logo and the steps Cart — Select address — Payment,
    each ticked when done):
      left   Your items ("- quantity +", the "packed fresh" note), then Delivery address (the default
             address until one is confirmed);
      right  Order summary: item total at MRP, discount on MRP, delivery fee (the owner's charges from
             Products & pricing → Set delivery charge: ₹30 and free from ₹500 at first, which the
             summary says), platform fee, To pay, the saving, and "Select address". The coupon code
             box shows only when the panel put coupons in this kind of cart's list (one-time products,
             a milk plan, or both: Coupons & offers → Coupons in the cart).
    "Select address" (or the address card) opens the address pop-up (same cards as My Addresses: pick,
    Set as Default, Edit, Remove, Add new address). Picking one ticks Address and the button becomes
    "Pay now · ₹…". Pay now opens Razorpay (test mode; the customer picks UPI, card or net banking
    there); once our server has confirmed the payment it ticks Payment and shows "Your order has been placed"
    with Track your order.
  Milk subscription ("Start subscription" on the milk page): the same page, with the plan ("Your
  subscription", highlighted in green) above the one-time items, if any. One address and one payment for
  both: the summary shows the plan at the one-time price and its saving, the items at MRP and their
  discount, any coupon (checked on the plan first, then on the items) and free delivery (the items come
  with the plan's deliveries). Paying places two orders: the plan (My Subscription) and the items (My Orders).
  The milk chosen with Add Quantity is the plan's bottles a day, so it is not listed as a one-time item.
  A coupon used here counts as a use in the panel. Not logged in: Pay goes to the login first, then back.
  Phones: one column, with the total and the step's button kept at the bottom of the screen.
*/

// The only product sold as a subscription (its page has the plans)
const MILK_PRODUCT_ID = "a2-desi-milk";

// The parts of Razorpay's pop-up (loaded from checkout.js) that the cart uses
type RazorpaySuccessResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayFailureResponse = { error: { description?: string; metadata?: { payment_id?: string; order_id?: string } } };
type RazorpayPopup = {
  open: () => void;
  on: (event: "payment.failed", onFailed: (response: RazorpayFailureResponse) => void) => void;
};
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayPopup;
  }
}

const razorpayCheckoutScriptSource = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayScriptLoading: Promise<boolean> | null = null;

// Loads Razorpay's checkout.js once. True when the pop-up is ready to use.
function loadRazorpayCheckoutScript() {
  if (window.Razorpay) return Promise.resolve(true);
  razorpayScriptLoading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = razorpayCheckoutScriptSource;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      script.remove();
      razorpayScriptLoading = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return razorpayScriptLoading;
}

const cowEmblemImageSource = "/images/brand/chiranvi-farm-cow-emblem.png";
let cowEmblemDataUrl = "";

// The cow emblem for the pop-up's header, as image data: Razorpay's secure pop-up cannot load pictures
// from a plain http address (like localhost), but always shows image data. Empty if it cannot be read.
async function getCowEmblemDataUrl() {
  if (cowEmblemDataUrl) return cowEmblemDataUrl;
  try {
    const emblemImage = await (await fetch(cowEmblemImageSource)).blob();
    cowEmblemDataUrl = await new Promise<string>((resolve) => {
      const imageReader = new FileReader();
      imageReader.onload = () => resolve(String(imageReader.result));
      imageReader.onerror = () => resolve("");
      imageReader.readAsDataURL(emblemImage);
    });
  } catch {
    cowEmblemDataUrl = "";
  }
  return cowEmblemDataUrl;
}

const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;

// The address's mobile number as 10 digits ("+91 98450 12345" → "9845012345"), for the order's delivery contact
function deliveryMobileOf(address: { mobileNumber: string } | null | undefined) {
  const digits = address?.mobileNumber.replace(/[^0-9]/g, "").replace(/^91(?=[0-9]{10}$)/, "") ?? "";
  return digits.length === 10 ? digits : undefined;
}

type Step = "cart" | "address" | "payment";


// Cart ✓ — Details — Payment (after placing the order, all three are done)
function CheckoutStepBar({ current }: { current: Step | "done" }) {
  const steps: { key: Step; label: string }[] = [
    { key: "cart", label: "Cart" },
    { key: "address", label: "Select address" },
    { key: "payment", label: "Payment" },
  ];
  const currentIndex = current === "done" ? steps.length : steps.findIndex((step) => step.key === current);
  return (
    <ol className={styles["checkout-steps"]} aria-label="Checkout steps">
      {steps.map((step, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "next";
        return (
          <li key={step.key} className={`${styles["checkout-step"]} ${styles[`checkout-step-${state}`]}`} aria-current={state === "current" ? "step" : undefined}>
            {index > 0 && <span className={styles["checkout-step-line"]} aria-hidden="true" />}
            <span className={styles["checkout-step-circle"]} aria-hidden="true">
              {state === "done" ? (
                <svg viewBox="0 0 24 24">
                  <path d="M6 12.5l4 4 8-9" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span className={styles["checkout-step-label"]}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/*
  Pop-up frame (the address pop-up): dimmed page behind, a close (x) button at the top right; Escape or
  the dimmed page closes it, and the page behind does not scroll while it is open.
*/
function CheckoutPopupFrame({
  labelledBy,
  isWide,
  onClose,
  children,
}: {
  labelledBy: string;
  isWide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Latest onClose, so the Escape listener below is set up only once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return (
    <div className={styles["plan-popup-overlay"]}>
      <button type="button" aria-label="Close" tabIndex={-1} className={styles["plan-popup-dimmed-page"]} onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`${styles["plan-popup"]} ${isWide ? styles["checkout-popup-wide"] : ""}`}
      >
        <button type="button" aria-label="Close" className={`${styles["plan-popup-icon-button"]} ${styles["checkout-popup-close-button"]}`} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </section>
    </div>
  );
}

/*
  Pop-up when the address picked for a new plan already gets a running plan: extend that plan instead,
  or choose another address. Escape or the dimmed page closes it; the page behind does not scroll.
*/
function SameAddressPlanDialog({
  plan,
  newPlan,
  amountToPay,
  isLoggedIn,
  onExtend,
  onClose,
}: {
  plan: RunningPlan;
  newPlan: CartSubscription;
  amountToPay: number; // the plan's total after any coupon
  isLoggedIn: boolean;
  onExtend: (plan: RunningPlan) => void;
  onClose: () => void;
}) {
  const extendButtonRef = useRef<HTMLButtonElement>(null);
  // Latest onClose, so the Escape listener below is set up only once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    extendButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", closeOnEscape);
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  // The running plan's last day once the new plan's days are added to it
  const newLastDay = new Date(plan.endsOn.getTime() + newPlan.days * 24 * 60 * 60 * 1000);

  return (
    <div className={styles["plan-popup-overlay"]}>
      <button type="button" aria-label="Close" tabIndex={-1} className={styles["plan-popup-dimmed-page"]} onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="plan-popup-heading" className={styles["plan-popup"]}>
        <div className={styles["plan-popup-heading-row"]}>
          <span className={styles["plan-popup-warning-icon"]} aria-hidden="true">
            !
          </span>
          <h2 id="plan-popup-heading" className={styles["plan-popup-heading"]}>
            This address already has a running plan
          </h2>
          <button type="button" aria-label="Close" className={styles["plan-popup-icon-button"]} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className={styles["plan-popup-text"]}>
          You chose the address where your <strong>{plan.planName}</strong> plan is already being delivered. Extend that
          plan instead (it will then run until <strong>{formatPlanDate(newLastDay)}</strong>), or choose a different address
          for the new plan.
        </p>

        {/* The running plan: name, bottles a day, last day and address */}
        <div className={styles["plan-popup-plan-box"]}>
          <p className={styles["plan-popup-plan-name"]}>
            A2 Desi Milk · {plan.planName}
            <span className={styles["plan-popup-plan-badge"]}>Running</span>
          </p>
          <p className={styles["plan-popup-plan-line"]}>
            {plan.bottlesPerDay} L every morning · Ends on {formatPlanDate(plan.endsOn)}
          </p>
          <p className={styles["plan-popup-plan-line"]}>{plan.deliverTo}</p>
        </div>

        <div className={styles["plan-popup-buttons"]}>
          {isLoggedIn ? (
            <button ref={extendButtonRef} type="button" className={styles["plan-popup-primary-button"]} onClick={() => onExtend(plan)}>
              Extend that plan · {rupees(amountToPay)}
            </button>
          ) : (
            <Link href="/login" className={styles["plan-popup-primary-button"]} onClick={() => rememberPageAfterLogin("/cart")}>
              Log in to extend
            </Link>
          )}
          <button type="button" className={styles["plan-popup-secondary-button"]} onClick={onClose}>
            Choose another address
          </button>
        </div>
      </section>
    </div>
  );
}

export default function CartView() {
  const cartItems = useCartItems();
  // A milk plan from "Start subscription" (checked out together with the one-time items)
  const cartSubscription = useCartSubscription();
  // The one-time items: while a plan waits, its milk from Add Quantity (the plan's bottles a day) is left out
  const oneTimeItems = cartSubscription ? cartItems.filter((item) => item.productId !== cartSubscription.product.productId) : cartItems;
  const [placedItemsOrder, setPlacedItemsOrder] = useState<Order | null>(null);
  const deliverySettings = useDeliverySettings();
  const productPages = useProductPages();
  const isLoggedIn = useIsLoggedIn();
  // Logged in without a Profile: the address form also asks the Profile's details (name, email), which fill it
  const loggedInMobile = useLoggedInMobileNumber();
  const customerProfile = useCustomerProfile(loggedInMobile);
  const isProfileKnown = useIsCustomerProfileKnown(loggedInMobile);
  const isProfileMissing = Boolean(loggedInMobile) && isProfileKnown && !customerProfile;
  const { addresses, defaultAddressId } = useAddressBook();
  // The saved cart has been read from the database (until then nothing is drawn, so it never flashes "empty")
  const isCartLoaded = useIsCartLoaded();
  const router = useRouter();

  const [chosenAddressId, setChosenAddressId] = useState<string | null>(null);
  const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
  // The address open in the form for Edit (null = adding a new one)
  const [addressBeingEdited, setAddressBeingEdited] = useState<SavedAddress | null>(null);
  const [couponInput, setCouponInput] = useState("");
  // Kept with the cart, so a refresh keeps the coupon
  const appliedCode = useAppliedCouponCode();
  const setAppliedCode = setAppliedCouponCode;
  const [couponError, setCouponError] = useState("");
  // The coupon box's drop-down of the coupons this cart may use (opens on tap; closes on a tap outside or Esc)
  const [isCouponListOpen, setIsCouponListOpen] = useState(false);
  const couponPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isCouponListOpen) return;
    function closeOnOutsideTap(event: PointerEvent) {
      if (!couponPickerRef.current?.contains(event.target as Node)) setIsCouponListOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsCouponListOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideTap);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideTap);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCouponListOpen]);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  // Pay now is waiting for the database, and what to say if it didn't take the order
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [placeOrderError, setPlaceOrderError] = useState("");
  // The cart took today's prices from the database (shown under Pay now)
  const [pricesUpdatedNote, setPricesUpdatedNote] = useState("");
  // The address pop-up, and whether an address was confirmed there (ticks Address; the button becomes Pay now)
  const [isAddressPickerOpen, setIsAddressPickerOpen] = useState(false);
  const [hasPickedAddress, setHasPickedAddress] = useState(false);
  // No "Pay with" choice in the cart: the payment page (Razorpay, once connected) offers UPI, card and net
  // banking itself. Orders are saved as UPI until then. No cash on delivery.
  const paymentMethod: OrderPaymentMethod = "UPI";
  /*
    Buying a plan while one is still running:
      a plan from "Extend Plan" (My Subscription) extends the plan it names, at that plan's address;
      picking the address of a running plan opens "this address already has a running plan".
  */
  const runningPlans = findRunningPlans(useOrders());
  const planBeingExtended = cartSubscription?.extendsOrderId
    ? (runningPlans.find((plan) => plan.orderId === cartSubscription.extendsOrderId) ?? null)
    : null;
  const [planAtPickedAddress, setPlanAtPickedAddress] = useState<RunningPlan | null>(null);
  // The pop-up keeps the latest close function itself, so this needs no useCallback
  const closeSameAddressDialog = () => setPlanAtPickedAddress(null);
  // Escape or the dimmed page close the address pop-up, but not while the address form or a plan pop-up is on top of it
  const closeAddressPicker = () => {
    if (!isAddressFormOpen && !planAtPickedAddress) setIsAddressPickerOpen(false);
  };
  const closeAddressForm = useCallback(() => {
    setIsAddressFormOpen(false);
    setAddressBeingEdited(null);
  }, []);
  // Empty cart: counts cart icon clicks on this page; each new value restarts the trolley shake (its key)
  const [trolleyShakeCount, setTrolleyShakeCount] = useState(0);

  // Clicking the navigation bar's cart icon while on this page shakes the trolley left and right.
  useEffect(() => {
    function shakeTrolley() {
      setTrolleyShakeCount((shakeCount) => shakeCount + 1);
    }
    window.addEventListener(CART_ICON_CLICKED_ON_CART_PAGE_EVENT, shakeTrolley);
    return () => window.removeEventListener(CART_ICON_CLICKED_ON_CART_PAGE_EVENT, shakeTrolley);
  }, []);

  const chosenAddress =
    addresses.find((address) => address.id === (chosenAddressId ?? defaultAddressId)) ?? addresses[0] ?? null;
  // The milk bought one-time (the cart then offers "Switch to subscription")
  const milkInCart = oneTimeItems.some((item) => item.productId === MILK_PRODUCT_ID);
  // Products in the cart (as in the design: "4 items" and the count next to "Your items")
  const itemCount = oneTimeItems.length;

  // Money for the one-time items: MRP, the products' own discount, the coupon, delivery
  const itemTotalAtMrp = oneTimeItems.reduce((sum, item) => sum + Math.max(item.originalPrice, item.price) * item.quantity, 0);
  const itemTotal = oneTimeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountOnMrp = itemTotalAtMrp - itemTotal;
  /*
    The coupon is checked by the database (with today's prices), against the plan first, then the items;
    again whenever the cart changes. The order works the discount out again itself.
  */
  const couponCart: CouponCart = useMemo(
    () => ({
      items: oneTimeItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      plan: cartSubscription
        ? {
            productId: cartSubscription.product.productId,
            planId: cartSubscription.planId,
            months: cartSubscription.months,
            days: cartSubscription.days,
            bottlesPerDay: cartSubscription.bottlesPerDay,
          }
        : null,
    }),
    [oneTimeItems, cartSubscription],
  );
  /*
    Only the coupons the owner put in this kind of cart's list (Coupons & offers → Coupons in the cart): one-time
    products, a milk plan, or both, each checked by the database on this cart. No coupons in the list: the drop-down says so (a code can
    still be typed).
  */
  const cartCoupons = useCartCoupons(couponCart);
  const hasCartCoupons = cartCoupons.length > 0;
  const couponCheck = useCouponCheck(appliedCode, couponCart);
  const appliedCoupon = couponCheck && "code" in couponCheck ? couponCheck : null;
  const isCouponForPlan = Boolean(cartSubscription && appliedCoupon?.isForPlan);
  const couponDiscount = appliedCoupon ? Math.min(appliedCoupon.discount, isCouponForPlan && cartSubscription ? cartSubscription.planTotal : itemTotal) : 0;
  const planCouponDiscount = isCouponForPlan ? couponDiscount : 0;
  const itemsCouponDiscount = isCouponForPlan ? 0 : couponDiscount;
  const afterDiscounts = itemTotal - itemsCouponDiscount;
  // With a plan the items come with its deliveries, so their delivery is free too
  // Delivery: the owner's charges per product; free with a plan (the items come with its deliveries) or from
  // the free-delivery amount
  const deliveryQuote = quoteDelivery(
    oneTimeItems.map((item) => ({ productId: productIdOfCartItem(item.productId, productPages), total: item.price * item.quantity })),
    afterDiscounts,
    Boolean(cartSubscription),
    deliverySettings,
  );
  const deliveryFee = deliveryQuote.fee;
  // Platform fee (set in the database): only with a milk plan, once per checkout, paid with the plan's order.
  // One-time items alone pay none (their delivery fee still applies). It doesn't count towards free delivery
  // or a coupon's minimum order.
  const platformFee = cartSubscription ? deliverySettings.platformFee : 0;
  const isDeliveryFree = deliveryFee === 0;
  const toPay = afterDiscounts + deliveryFee;
  const youSave = discountOnMrp + itemsCouponDiscount + (deliveryQuote.crossedOutFee ?? deliveryFee) - deliveryFee;
  // The plan's part
  const planToPay = cartSubscription ? cartSubscription.planTotal - planCouponDiscount : 0;
  const planSaving = cartSubscription ? cartSubscription.oneTimeTotal - cartSubscription.planTotal + planCouponDiscount : 0;

  // Apply: the typed code, or the one tapped in the drop-down (the database checks it on this cart)
  async function applyCoupon(code = couponInput) {
    if (!code.trim()) {
      setCouponError("Enter a coupon code");
      return;
    }
    setIsCouponListOpen(false);
    const result = await checkCouponOnServer(code, couponCart);
    if ("error" in result) {
      setCouponError(result.error);
      return;
    }
    setAppliedCode(result.code);
    setCouponInput("");
    setCouponError("");
  }

  /*
    The drop-down: the cart's running coupons (not the one already applied), narrowed by what is typed.
    One this cart can't use yet (e.g. below its minimum order) is shown greyed with the reason.
  */
  const typedCouponWords = couponInput.trim().toUpperCase();
  const couponChoices = cartCoupons
    .filter((choice) => choice.code !== appliedCoupon?.code)
    .filter((choice) => !typedCouponWords || choice.code.includes(typedCouponWords));

  /*
    Picking a delivery address. For a new subscription, an address that already gets a running plan of the
    same milk and bottle size (e.g. A2 Milk 1 L) is not picked: the "same address" pop-up offers to extend
    that plan or to choose another address. A different milk (Jersey, Skimmed) or size can go to the same address.
  */
  function pickAddress(addressId: string, addressDetails: AddressDetails, profileDetails?: ProfileDetailsFromAddress) {
    const planAtThisAddress = cartSubscription
      ? runningPlans.find(
          (plan) =>
            plan.product.productId === cartSubscription.product.productId &&
            plan.deliverTo.endsWith(` · ${formatAddressLine(addressDetails)}`),
        )
      : undefined;
    if (planAtThisAddress) {
      setHasPickedAddress(false);
      setPlanAtPickedAddress(planAtThisAddress);
      return;
    }
    // No Profile yet: an address picked from the list first opens the form for the Profile's details
    if (isProfileMissing && !profileDetails) {
      openAddressForm({ ...addressDetails, id: addressId });
      return;
    }
    setChosenAddressId(addressId);
    setHasPickedAddress(true);
    setIsAddressPickerOpen(false);
    // The form's Profile details, with this address, fill the empty Profile
    if (profileDetails) void fillEmptyProfileFromAddress(addressId, addressDetails, profileDetails);
  }

  // Add new address or Edit (same pop-up as My Addresses); the saved address becomes the picked one
  function saveAddress(addressDetails: AddressDetails, shouldBeDefault: boolean, profileDetails?: ProfileDetailsFromAddress) {
    let savedAddressId: string;
    if (addressBeingEdited) {
      updateAddress(addressBeingEdited.id, addressDetails, shouldBeDefault);
      savedAddressId = addressBeingEdited.id;
    } else {
      savedAddressId = addAddress(addressDetails, shouldBeDefault);
    }
    setIsAddressFormOpen(false);
    setAddressBeingEdited(null);
    pickAddress(savedAddressId, addressDetails, profileDetails);
  }

  /*
    Back arrow: to the page the customer came from (e.g. the product page with "Checkout to Cart" or
    "Start subscription"); the home page when the cart was opened directly (nothing to go back to).
  */
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  // "Select address" (or the address card) opens the address pop-up
  function openAddressPicker() {
    setIsAddressPickerOpen(true);
  }

  function openAddressForm(address: SavedAddress | null) {
    setAddressBeingEdited(address);
    setIsAddressFormOpen(true);
  }

  // Removing the picked address means the customer has to pick again
  function removeSavedAddress(addressId: string) {
    if (hasPickedAddress && addressId === chosenAddress?.id) {
      setHasPickedAddress(false);
      setChosenAddressId(null);
    }
    removeAddress(addressId);
  }

  /*
    The plan in the cart as one order's details: every bottle at the plan's price per litre, free delivery.
    With a running plan given, it extends that plan (same address) instead of starting a new one.
  */
  function planPart(deliverTo: string, planToExtend?: RunningPlan): CheckoutPart | null {
    if (!cartSubscription) return null;
    return {
      cartItems: [
        {
          ...cartSubscription.product,
          price: cartSubscription.pricePerLitre,
          originalPrice: cartSubscription.product.price,
          quantity: cartSubscription.bottleCount,
        },
      ],
      checkout: {
        total: cartSubscription.planTotal - planCouponDiscount + platformFee,
        couponCode: isCouponForPlan ? appliedCoupon?.code : undefined,
        // Which coupon list the database checks the code against
        cartType: oneTimeItems.length > 0 ? "subscription-and-one-time" : "subscription",
        couponDiscount: planCouponDiscount || undefined,
        deliveryFee: 0,
        deliverTo: planToExtend ? planToExtend.deliverTo : deliverTo,
        deliveryMobile: deliveryMobileOf(chosenAddress),
        area: chosenAddress?.area,
        paymentMethod,
        subscription: {
          planId: cartSubscription.planId,
          planName: cartSubscription.planName,
          months: cartSubscription.months,
          days: cartSubscription.days,
          bottlesPerDay: cartSubscription.bottlesPerDay,
          pricePerLitre: cartSubscription.pricePerLitre,
          bottleCount: cartSubscription.bottleCount,
          extendsOrderId: planToExtend?.orderId,
          bottleLabel: cartSubscription.bottleLabel,
          unitName: cartSubscription.unitName,
        },
      },
    };
  }

  // The one-time items as their own order's details (with a plan: same address, free delivery, no platform fee)
  function itemsPart(deliverTo: string): CheckoutPart | null {
    if (oneTimeItems.length === 0) return null;
    return {
      cartItems: oneTimeItems,
      checkout: {
        total: toPay,
        couponCode: appliedCoupon && !isCouponForPlan ? appliedCoupon.code : undefined,
        couponDiscount: itemsCouponDiscount || undefined,
        deliveryFee,
        deliverTo,
        deliveryMobile: deliveryMobileOf(chosenAddress),
        area: chosenAddress?.area,
        paymentMethod,
      },
    };
  }

  /*
    Pay now (Razorpay, test mode): the server has the database price the plan and / or the items and save
    them as orders awaiting payment (one payment for both), then the Razorpay pop-up takes exactly that
    amount (the customer picks UPI, card or net banking there). Only once the server has checked Razorpay's
    signature are the orders paid; then the cart is emptied and "Your order has been placed" shows. If the
    database's total isn't the one shown (prices changed), nothing is charged and the cart takes today's
    prices. Cancelling or a failed payment keeps the cart for another try (a failed one gets a receipt).
  */
  // planToExtend: the running plan this plan extends ("Extend Plan", or the same-address pop-up's Extend)
  async function placeTheOrder(planToExtend: RunningPlan | null = planBeingExtended) {
    const deliverTo = planToExtend
      ? planToExtend.deliverTo
      : chosenAddress
        ? `${chosenAddress.name} · ${formatAddressLine(chosenAddress)}`
        : null;
    if (!deliverTo || isPlacingOrder) return;
    setIsPlacingOrder(true);
    setPlaceOrderError("");

    const isScriptReady = await loadRazorpayCheckoutScript();
    if (!isScriptReady || !window.Razorpay) {
      setIsPlacingOrder(false);
      setPlaceOrderError("We couldn't reach the payment service. Please check your internet and try again.");
      return;
    }

    const plan = planPart(deliverTo, planToExtend ?? undefined);
    const items = itemsPart(deliverTo);
    // The saved address the orders go to (its map pin reaches the delivery agent); an extended plan keeps its own
    const addressId = planToExtend ? undefined : chosenAddress?.id;
    if (plan) plan.checkout.addressId = addressId;
    if (items) items.checkout.addressId = addressId;
    const started = await startPayment(plan, items, amountToPay);
    if ("error" in started) {
      setIsPlacingOrder(false);
      setPlaceOrderError(started.error);
      // Prices changed or a product can't be ordered: the cart takes today's prices (a changed plan leaves it)
      if (started.reason === "prices" || started.reason === "unavailable") void refreshCartPrices(Boolean(plan));
      return;
    }

    // Set when Razorpay reports a failed attempt, so closing the pop-up afterwards keeps that message
    let lastFailureMessage = "";
    const razorpayPopup = new window.Razorpay({
      key: started.keyId,
      order_id: started.razorpayOrderId,
      amount: started.amount,
      currency: started.currency,
      name: "Chiranvi Farm",
      description: cartSubscription ? `${cartSubscription.planName} milk plan` : `${itemCount} ${itemCount === 1 ? "item" : "items"}`,
      image: (await getCowEmblemDataUrl()) || undefined,
      prefill: {
        name: chosenAddress?.name,
        contact: chosenAddress?.mobileNumber.replace(/[^\d+]/g, ""),
      },
      theme: { color: "#2F6B3F" },
      // Paid: the server checks Razorpay's signature and only then are the order(s) paid
      handler: async (success: RazorpaySuccessResponse) => {
        const result = await confirmPayment(success, plan, items);
        setIsPlacingOrder(false);
        if ("error" in result) {
          setPlaceOrderError(result.error);
          return;
        }
        finishPaidOrder(result.planOrder, result.itemsOrder);
      },
      modal: {
        ondismiss: () => {
          setIsPlacingOrder(false);
          setPlaceOrderError(lastFailureMessage || "Payment cancelled. No money was taken. You can try again whenever you're ready.");
        },
      },
    });
    razorpayPopup.on("payment.failed", (failure) => {
      // Razorpay's reason without its own full stop (ours follows)
      const reason = failure.error.description?.trim().replace(/\.+$/, "");
      lastFailureMessage = `Payment failed${reason ? `: ${reason}` : ""}. No money was taken. Please try again.`;
      // Kept as a "Payment failed" receipt in My Orders (the server checks with Razorpay that it really failed)
      const failedPaymentId = failure.error.metadata?.payment_id;
      if (failedPaymentId) reportFailedPayment(started.razorpayOrderId, failedPaymentId);
    });
    razorpayPopup.open();
  }

  // Paid: the cart empties (with the milk's quantity from Add Quantity: the plan pays for those bottles now)
  function finishPaidOrder(planOrder: Order | null, itemsOrder: Order | null) {
    emptyTheCart();
    setPlanAtPickedAddress(null);
    setIsAddressPickerOpen(false);
    setHasPickedAddress(false);
    setPlacedOrder(planOrder ?? itemsOrder);
    setPlacedItemsOrder(planOrder ? itemsOrder : null);
    window.scrollTo({ top: 0 });
  }

  /*
    Today's prices from the database (the same an order is charged): a line whose price changed since it went
    into the cart (a price change in the panel, an old "Order again", or a changed browser copy) takes today's
    price, and a note says so. A plan whose price changed leaves the cart, to be chosen again on its page
    (also when the order said so: dropPlan).
  */
  async function refreshCartPrices(dropPlan = false) {
    const productIds = [...oneTimeItems.map((item) => item.productId), ...(cartSubscription ? [cartSubscription.product.productId] : [])];
    const todaysPrices = await priceCartOnServer([...new Set(productIds)]);
    if (!todaysPrices) return;
    let hasChanged = false;
    for (const item of oneTimeItems) {
      const today = todaysPrices.find((line) => line.productId === item.productId);
      // Not sold any more: the order explains it when Pay now is tapped
      if (!today?.isFound || (today.price === item.price && today.originalPrice === item.originalPrice)) continue;
      const { quantity, ...product } = item;
      removeCartItem(item.productId);
      for (let packNumber = 0; packNumber < quantity; packNumber += 1) addProductToCart({ ...product, price: today.price, originalPrice: today.originalPrice });
      hasChanged = true;
    }
    if (cartSubscription) {
      const today = todaysPrices.find((line) => line.productId === cartSubscription.product.productId);
      if (dropPlan || (today?.isFound && today.price !== cartSubscription.product.price)) {
        removeSubscriptionFromCart();
        setPricesUpdatedNote("Your milk plan's price has changed. Please choose your plan again on the milk's page.");
        return;
      }
    }
    if (hasChanged) setPricesUpdatedNote("Prices in your cart were updated to today's prices. Please check them before paying.");
  }

  // Checked when the cart opens and whenever its products or prices change
  const priceCheckKey = [
    ...oneTimeItems.map((item) => `${item.productId}:${item.price}:${item.originalPrice}`),
    cartSubscription ? `plan:${cartSubscription.product.productId}:${cartSubscription.product.price}` : "",
  ].join("|");
  useEffect(() => {
    if (priceCheckKey.replace(/\|/g, "") === "") return;
    void refreshCartPrices();
    // priceCheckKey holds what the check depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceCheckKey]);

  // Remove the plan: its milk from Add Quantity goes too (it was the plan's bottles a day, not a purchase)
  function removeSubscriptionFromCart() {
    if (cartSubscription) removeCartItem(cartSubscription.product.productId);
    setCartSubscription(null);
  }

  // Tomorrow before 7 AM
  const deliveryLine = "Delivery tomorrow by 7 AM";

  /*
    Delivery address card (under the items): the default address until one is confirmed in the pop-up
    ("Select address" there); clicking it opens the pop-up. Extending a plan keeps that plan's address.
  */
  const deliveryAddressCard = (
    <section className={styles["checkout-card"]} aria-labelledby="delivery-address-heading">
      <div className={styles["checkout-card-heading-row"]}>
        <h2 id="delivery-address-heading" className={styles["checkout-card-heading"]}>
          Delivery address
        </h2>
        {planBeingExtended ? (
          <span className={styles["checkout-muted-note"]}>Same address as your plan</span>
        ) : hasPickedAddress ? (
          <span className={styles["delivery-address-status-confirmed"]}>Confirmed</span>
        ) : (
          <span className={styles["delivery-address-status-pending"]}>Not confirmed yet</span>
        )}
      </div>
      {planBeingExtended ? (
        <p className={styles["delivery-address-plan-line"]}>{planBeingExtended.deliverTo}</p>
      ) : chosenAddress ? (
        <div className={styles["delivery-address-row"]}>
          <button
            type="button"
            className={`${styles["delivery-address-box"]} ${hasPickedAddress ? styles["delivery-address-box-confirmed"] : ""}`}
            onClick={openAddressPicker}
          >
            <span className={styles["delivery-address-top-row"]}>
              <span className={styles["delivery-address-label"]}>{chosenAddress.label}</span>
              {chosenAddress.id === defaultAddressId && <span className={styles["address-pick-default-badge"]}>Default</span>}
              {hasPickedAddress && <span className={styles["delivery-address-change"]}>Change</span>}
            </span>
            <span className={styles["delivery-address-name"]}>{chosenAddress.name}</span>
            <span className={styles["delivery-address-line"]}>{formatAddressLine(chosenAddress)}</span>
            <span className={styles["delivery-address-line"]}>{chosenAddress.mobileNumber}</span>
          </button>
          {/* Add new address: straight to the address form; the saved address becomes the delivery address */}
          <button type="button" className={styles["checkout-address-add"]} onClick={() => openAddressForm(null)}>
            <span className={styles["checkout-address-add-circle"]} aria-hidden="true">
              +
            </span>
            Add new address
          </button>
        </div>
      ) : (
        <button type="button" className={styles["delivery-address-box"]} onClick={openAddressPicker}>
          <span className={styles["delivery-address-name"]}>+ Add a delivery address</span>
          <span className={styles["delivery-address-line"]}>We currently deliver only to selected locations in Bengaluru.</span>
        </button>
      )}
    </section>
  );

  // Empty cart (or not loaded yet): the original "My Cart" page
  // The plan the placed subscription order started or extended (its new last day, after an extension)
  const placedPlan = placedOrder?.subscription
    ? (runningPlans.find((plan) => plan.orderId === (placedOrder.subscription?.extendsOrderId ?? placedOrder.orderId)) ?? null)
    : null;

  // What Pay now charges: the plan and the one-time items together
  const amountToPay = planToPay + (oneTimeItems.length > 0 ? toPay : 0) + platformFee;
  const amountSaved = planSaving + (oneTimeItems.length > 0 ? youSave : 0);

  if (!placedOrder && (!isCartLoaded || (cartItems.length === 0 && !cartSubscription))) {
    return (
      <div className={styles["cart-page"]}>
        {/* Navigation bar, placed exactly like on the landing page */}
        <SiteNavigationPlacement />

        <main className={styles["cart-page-content"]}>
          <div className={styles["cart-page-title-row"]}>
            <Link href="/" aria-label="Back to the home page" className={styles["cart-page-back-button"]}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
            </Link>
            <h1 className={styles["cart-page-title"]}>
              My Cart <span className={styles["cart-page-item-count"]}>(0)</span>
            </h1>
          </div>

          {isCartLoaded && (
            <section className={styles["empty-cart-card"]} aria-labelledby="empty-cart-heading">
              <span className={styles["empty-cart-icon-circle"]} aria-hidden="true">
                <svg
                  key={trolleyShakeCount}
                  viewBox="0 0 24 24"
                  className={`${styles["empty-cart-icon"]} ${trolleyShakeCount > 0 ? styles["empty-cart-icon-shaking"] : ""}`}
                >
                  <path d="M2.5 3.5h2.4l2.3 11h11l2-8H6.2" />
                  <circle cx="9" cy="19" r="1.6" />
                  <circle cx="16.5" cy="19" r="1.6" />
                </svg>
              </span>
              <h2 id="empty-cart-heading" className={styles["empty-cart-heading"]}>
                Your cart is empty
              </h2>
              <p className={styles["empty-cart-description"]}>Your farm-fresh favourites are waiting for you!</p>
              <Link href="/products" className={styles["empty-cart-start-shopping-button"]}>
                Start Shopping
              </Link>
            </section>
          )}
        </main>

        {/* Below the empty cart: the landing page's Best Sellers, so shopping can start right here */}
        {isCartLoaded && (
          <div className={styles["cart-page-best-sellers"]}>
            <BestSellersSection placement="cart" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles["checkout-page"]}>
      <header className={styles["checkout-top-bar"]}>
        <Link href="/" className={styles["checkout-logo"]} aria-label="Chiranvi Farm home">
          <Image src="/images/brand/chiranvi-farm-logo.webp" alt="Chiranvi Farm" width={516} height={240} priority />
        </Link>
        <CheckoutStepBar
          current={placedOrder ? "done" : planBeingExtended || hasPickedAddress ? "payment" : "address"}
        />
      </header>

      <main className={styles["checkout-content"]}>
        {placedOrder ? (
          /* ---------- Order placed ---------- */
          <section className={styles["order-placed-card"]} aria-labelledby="order-placed-heading">
            <span className={styles["order-placed-icon"]} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M6 12.5l4 4 8-9" />
              </svg>
            </span>
            <h1 id="order-placed-heading" className={styles["order-placed-heading"]}>
              {placedOrder.subscription?.extendsOrderId
                ? "Your plan has been extended"
                : placedOrder.subscription
                  ? "Your subscription has started"
                  : "Your order has been placed"}
            </h1>
            <p className={styles["order-placed-text"]}>
              {placedOrder.subscription?.extendsOrderId
                ? `${placedOrder.subscription.planName} added (${placedOrder.subscription.bottleCount.toLocaleString("en-IN")} bottles)${
                    placedPlan ? ` · Your plan now runs until ${formatPlanDate(placedPlan.endsOn)}` : ""
                  }`
                : placedOrder.subscription
                  ? `${placedOrder.subscription.planName} · ${placedOrder.subscription.bottlesPerDay} × ${placedOrder.subscription.bottleLabel ?? "1 L"} every morning · ${placedOrder.subscription.bottleCount.toLocaleString("en-IN")} bottles`
                  : "Thank you for shopping with Chiranvi Farm"}
            </p>
            {/* Paid together with the plan: the one-time items' own order */}
            {placedItemsOrder && (
              <p className={styles["order-placed-text"]}>
                Your {placedItemsOrder.items.length} {placedItemsOrder.items.length === 1 ? "item arrives" : "items arrive"} (order {placedItemsOrder.orderId}) tomorrow by 7 AM ·{" "}
                <Link href="/account/orders">Track them</Link>
              </p>
            )}
            <dl className={styles["order-placed-details"]}>
              <div>
                <dt>Order</dt>
                <dd>{placedOrder.orderId}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>{rupees(placedOrder.total + (placedItemsOrder?.total ?? 0))}</dd>
              </div>
              <div>
                <dt>{placedOrder.subscription?.extendsOrderId ? "Plan runs until" : placedOrder.subscription ? "First delivery" : "Delivery"}</dt>
                <dd>{placedOrder.subscription?.extendsOrderId && placedPlan ? formatPlanDate(placedPlan.endsOn) : "Tomorrow by 7 AM"}</dd>
              </div>
            </dl>
            {placedOrder.deliverTo && <p className={styles["order-placed-address"]}>Delivering to {placedOrder.deliverTo}</p>}
            <div className={styles["order-placed-buttons"]}>
              {placedOrder.subscription ? (
                <Link href="/account/subscription" className={styles["checkout-primary-button"]}>
                  View my subscription
                </Link>
              ) : (
                <Link href="/account/orders" className={styles["checkout-primary-button"]}>
                  Track your order
                </Link>
              )}
              <Link href="/" className={styles["checkout-secondary-button"]}>
                Continue shopping
              </Link>
            </div>
          </section>
        ) : (
          /* ---------- Checkout ---------- */
          <>
            <div className={styles["checkout-title-row"]}>
              <button type="button" className={styles["checkout-back-button"]} aria-label="Go back" onClick={goBack}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19 12H5M11 6l-6 6 6 6" />
                </svg>
              </button>
              <h1 className={styles["checkout-title"]}>Cart</h1>
              {/* Right end of the row: back to the products to add more (phones show only the button) */}
              <div className={styles["checkout-add-more"]}>
                <span className={styles["checkout-add-more-question"]}>Missed something?</span>
                <Link href="/products" className={styles["checkout-add-more-button"]}>
                  Add products
                </Link>
              </div>
            </div>
            <p className={styles["checkout-subtitle"]}>
              {planBeingExtended
                ? `Extending your ${planBeingExtended.planName} plan (currently ends on ${formatPlanDate(planBeingExtended.endsOn)})`
                : cartSubscription
                ? `${cartSubscription.planName} subscription${itemCount > 0 ? ` + ${itemCount} ${itemCount === 1 ? "item" : "items"}` : ""} · First delivery tomorrow by 7 AM`
                : `${itemCount} ${itemCount === 1 ? "item" : "items"} · ${deliveryLine}`}
            </p>

            <div className={styles["checkout-columns"]}>
              {/* Step 1: the plan (highlighted), then the one-time items, then the delivery address */}
              <div className={styles["checkout-left-column"]}>
                {cartSubscription && (
                  <section
                    className={`${styles["checkout-card"]} ${styles["subscription-cart-card-highlighted"]}`}
                    aria-labelledby="checkout-subscription-heading"
                  >
                    <div className={styles["checkout-card-heading-row"]}>
                      <h2 id="checkout-subscription-heading" className={styles["checkout-card-heading"]}>
                        {planBeingExtended ? "Extend your plan" : "Your subscription"}
                      </h2>
                      <button type="button" className={`${styles["checkout-text-button"]} ${styles["subscription-cart-remove-button"]}`} onClick={removeSubscriptionFromCart}>
                        Remove
                      </button>
                    </div>

                    <div className={styles["subscription-cart-item"]}>
                      <span className={styles["checkout-item-image-area"]}>
                        <Image
                          src={cartSubscription.product.imageSource}
                          alt={cartSubscription.product.name}
                          width={cartSubscription.product.imageWidth}
                          height={cartSubscription.product.imageHeight}
                          sizes="64px"
                          className={styles["checkout-item-image"]}
                        />
                      </span>
                      <div className={styles["checkout-item-details"]}>
                        <h3 className={styles["checkout-item-name"]}>
                          {cartSubscription.product.name}
                          {/* The plan (3 / 6 / 12 Months) as a green badge */}
                          <span className={styles["subscription-cart-plan-badge"]}>
                            {planBeingExtended ? `+ ${cartSubscription.planName}` : cartSubscription.planName}
                          </span>
                        </h3>
                        <p className={styles["checkout-item-pack"]}>
                          {cartSubscription.bottlesPerDay} × {cartSubscription.bottleLabel ?? "1 L"}{" "}
                          {cartSubscription.bottlesPerDay === 1 ? "bottle" : "bottles"} every morning ·{" "}
                          {cartSubscription.bottleCount.toLocaleString("en-IN")} bottles
                        </p>
                        <p className={styles["checkout-item-prices"]}>
                          <span className={styles["checkout-item-price"]}>{rupees(cartSubscription.pricePerLitre)} / {cartSubscription.unitName ?? "litre"}</span>
                          {cartSubscription.product.price > cartSubscription.pricePerLitre && (
                            <s className={styles["checkout-item-old-price"]}>{rupees(cartSubscription.product.price)}</s>
                          )}
                        </p>
                      </div>
                      <p className={styles["subscription-cart-item-total"]}>
                        <span className={styles["checkout-item-total"]}>{rupees(cartSubscription.planTotal)}</span>
                        {cartSubscription.oneTimeTotal > cartSubscription.planTotal && (
                          <s className={styles["checkout-item-old-price"]}>{rupees(cartSubscription.oneTimeTotal)}</s>
                        )}
                      </p>
                    </div>

                    <p className={styles["checkout-fresh-note"]}>
                      <span className={styles["checkout-fresh-dot"]} aria-hidden="true" />
                      {planBeingExtended
                        ? `Same delivery address: ${planBeingExtended.deliverTo}`
                        : "Delivered every morning by 7 AM · Pause anytime · Free delivery"}
                    </p>
                  </section>
                )}

                {oneTimeItems.length > 0 && (
                  <section className={styles["checkout-card"]} aria-labelledby="checkout-items-heading">
                    <div className={styles["checkout-card-heading-row"]}>
                      <h2 id="checkout-items-heading" className={styles["checkout-card-heading"]}>
                        Your items <span className={styles["checkout-count-pill"]}>{oneTimeItems.length}</span>
                      </h2>
                      <span className={styles["checkout-muted-note"]}>Prices include all taxes</span>
                    </div>

                    <ul className={styles["checkout-item-list"]}>
                      {oneTimeItems.map((item) => (
                        <li key={item.productId} className={styles["checkout-item"]}>
                          <span className={styles["checkout-item-image-area"]}>
                            <Image src={item.imageSource} alt={item.name} width={item.imageWidth} height={item.imageHeight} sizes="64px" className={styles["checkout-item-image"]} />
                          </span>
                          <div className={styles["checkout-item-details"]}>
                            <h3 className={styles["checkout-item-name"]}>{item.name}</h3>
                            <p className={styles["checkout-item-pack"]}>{item.packSize}</p>
                            <p className={styles["checkout-item-prices"]}>
                              <span className={styles["checkout-item-price"]}>{rupees(item.price)}</span>
                              {item.originalPrice > item.price && <s className={styles["checkout-item-old-price"]}>{rupees(item.originalPrice)}</s>}
                            </p>
                          </div>
                          <div className={styles["checkout-quantity"]} role="group" aria-label={`${item.name} quantity`}>
                            <button type="button" aria-label={`Remove one ${item.name}`} className={styles["checkout-quantity-minus"]} onClick={() => changeCartItemQuantity(item.productId, -1)}>
                              −
                            </button>
                            <span className={styles["checkout-quantity-number"]} aria-live="polite">
                              {item.quantity}
                            </span>
                            <button type="button" aria-label={`Add one more ${item.name}`} className={styles["checkout-quantity-plus"]} onClick={() => changeCartItemQuantity(item.productId, 1)}>
                              +
                            </button>
                          </div>
                          <p className={styles["checkout-item-total"]}>{rupees(item.price * item.quantity)}</p>
                        </li>
                      ))}
                    </ul>

                    <p className={styles["checkout-fresh-note"]}>
                      <span className={styles["checkout-fresh-dot"]} aria-hidden="true" />
                      Milk and paneer are packed fresh on the morning of delivery.
                    </p>

                    {/* Milk bought one-time by mistake: switch to a plan on the milk page (Subscribe tab) */}
                    {milkInCart && (
                      <div className={styles["subscription-cart-switch-row"]}>
                        <p className={styles["subscription-cart-switch-text"]}>
                          <strong>Want this milk every morning?</strong> Switch to a subscription to save on every bottle, with free
                          delivery.
                        </p>
                        <Link href={`/products/${MILK_PRODUCT_ID}`} className={styles["subscription-cart-switch-button"]}>
                          Switch to subscription
                        </Link>
                      </div>
                    )}
                  </section>
                )}
                {deliveryAddressCard}
              </div>

                            {/* Order summary */}
              <aside className={`${styles["checkout-card"]} ${styles["checkout-summary"]}`} aria-labelledby="checkout-summary-heading">
                <h2 id="checkout-summary-heading" className={styles["checkout-card-heading"]}>
                  Order summary
                </h2>

                {/* Coupon code: typed, or chosen from the coupons the panel put in this kind of cart's list */}
                <div ref={couponPickerRef} className={styles["checkout-coupon-picker"]}>
                  <form
                    className={styles["checkout-coupon-form"]}
                    onSubmit={(submitEvent) => {
                      submitEvent.preventDefault();
                      void applyCoupon();
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
                      <path d="M7.5 7.5h.01" />
                    </svg>
                    <input
                      value={couponInput}
                      placeholder="Choose or enter coupon code"
                      aria-label="Coupon code"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={isCouponListOpen}
                      aria-controls="checkout-coupon-choices"
                      onFocus={() => setIsCouponListOpen(true)}
                      onClick={() => setIsCouponListOpen(true)}
                      onChange={(changeEvent) => {
                        setCouponInput(changeEvent.target.value.toUpperCase());
                        setCouponError("");
                        setIsCouponListOpen(true);
                      }}
                    />
                    <button
                      type="button"
                      className={styles["checkout-coupon-list-toggle"]}
                      aria-label={isCouponListOpen ? "Hide coupons" : "Show coupons"}
                      aria-expanded={isCouponListOpen}
                      onClick={() => setIsCouponListOpen(!isCouponListOpen)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    <button type="submit">Apply</button>
                  </form>
                  {isCouponListOpen && (
                    <ul id="checkout-coupon-choices" className={styles["checkout-coupon-dropdown"]} aria-label="Coupons you can use">
                      {couponChoices.map(({ code, description, problem }) => (
                        <li key={code}>
                          <button
                            type="button"
                            className={styles["checkout-coupon-choice"]}
                            disabled={Boolean(problem)}
                            onClick={() => void applyCoupon(code)}
                          >
                            <span className={styles["checkout-coupon-choice-code"]}>{code}</span>
                            <span className={styles["checkout-coupon-choice-description"]}>{problem ?? description}</span>
                            {!problem && <span className={styles["checkout-coupon-choice-apply"]}>Apply</span>}
                          </button>
                        </li>
                      ))}
                      {couponChoices.length === 0 && (
                        <li className={styles["checkout-coupon-dropdown-empty"]}>
                          {!hasCartCoupons
                          ? "No coupons available"
                          : typedCouponWords
                            ? "No coupon matches this code"
                            : "No other coupons for this order"}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                {appliedCoupon && (
                    <p className={styles["checkout-coupon-applied"]}>
                      <span className={styles["checkout-coupon-badge"]} aria-hidden="true">
                        %
                      </span>
                      <span className={styles["checkout-coupon-applied-text"]}>
                        <strong>{appliedCoupon.code}</strong> applied · {appliedCoupon.description}
                      </span>
                      <button type="button" className={styles["checkout-coupon-remove"]} onClick={() => setAppliedCode(null)}>
                        Remove
                      </button>
                    </p>
                )}
                {couponError && <p className={styles["checkout-coupon-error"]}>{couponError}</p>}
                {appliedCode && !appliedCoupon && couponCheck && "error" in couponCheck && (
                  <p className={styles["checkout-coupon-error"]}>{couponCheck.error}</p>
                )}

                {/*
                  The plan's price (its saving shows under To pay), the items at MRP and their discount, then delivery,
                  the coupon and the platform fee
                */}
                <dl className={styles["checkout-bill"]}>
                  {cartSubscription && (
                    <div>
                      <dt>Subscription fee</dt>
                      <dd>{rupees(cartSubscription.planTotal)}</dd>
                    </div>
                  )}
                  {oneTimeItems.length > 0 && (
                    <>
                      <div>
                        <dt>Item total (MRP)</dt>
                        <dd>{rupees(itemTotalAtMrp)}</dd>
                      </div>
                      {discountOnMrp > 0 && (
                        <div>
                          <dt>Discount on MRP</dt>
                          <dd className={styles["checkout-bill-saving"]}>−{rupees(discountOnMrp)}</dd>
                        </div>
                      )}
                    </>
                  )}
                  <div>
                    <dt>Delivery fee</dt>
                    <dd>
                      {/* The charge before free delivery or an offer, struck through */}
                      {deliveryQuote.crossedOutFee !== null && (
                        <>
                          <s className={styles["checkout-bill-struck"]}>{rupees(deliveryQuote.crossedOutFee)}</s>{" "}
                        </>
                      )}
                      {isDeliveryFree ? (
                        <span className={styles["checkout-bill-saving"]}>FREE</span>
                      ) : deliveryQuote.crossedOutFee !== null ? (
                        <span className={styles["checkout-bill-saving"]}>{rupees(deliveryFee)}</span>
                      ) : (
                        rupees(deliveryFee)
                      )}
                    </dd>
                  </div>
                  {appliedCoupon && (
                    <div>
                      <dt>Coupon {appliedCoupon.code}</dt>
                      <dd className={styles["checkout-bill-saving"]}>−{rupees(couponDiscount)}</dd>
                    </div>
                  )}
                  {/* Only with a milk plan */}
                  {platformFee > 0 && (
                    <div>
                      <dt>Platform fee</dt>
                      <dd>{rupees(platformFee)}</dd>
                    </div>
                  )}
                </dl>
                {/* One-time orders: free delivery from the owner's amount (₹500 → "above ₹499") */}
                {!cartSubscription && (
                  <p className={styles["checkout-free-delivery-hint"]}>
                    {deliveryQuote.amountToFreeDelivery > 0
                      ? `Free delivery on orders above ${rupees(deliverySettings.freeFrom - 1)}. Add ${rupees(deliveryQuote.amountToFreeDelivery)} more.`
                      : `Free delivery on orders above ${rupees(deliverySettings.freeFrom - 1)}`}
                  </p>
                )}

                <p className={styles["checkout-to-pay"]}>
                  <span>To pay</span>
                  <span className={styles["checkout-to-pay-amount"]}>{rupees(amountToPay)}</span>
                </p>
                {amountSaved > 0 && (
                  <p className={styles["checkout-you-save"]}>
                    You save {rupees(amountSaved)} on this {cartSubscription && oneTimeItems.length === 0 ? "plan" : "order"}
                  </p>
                )}

                <div className={styles["checkout-place-row"]}>
                  <span className={styles["checkout-place-row-total"]}>
                    <span className={styles["checkout-place-row-amount"]}>{rupees(amountToPay)}</span>
                    <span className={styles["checkout-place-row-label"]}>To pay</span>
                  </span>
                  {planBeingExtended ? (
                    /* Extending a plan: same address, so straight to paying */
                    isLoggedIn ? (
                      <button type="button" className={styles["checkout-place-button"]} onClick={() => void placeTheOrder()} disabled={isPlacingOrder}>
                        {isPlacingOrder ? "Placing your order…" : `Pay now · ${rupees(amountToPay)}`}
                      </button>
                    ) : (
                      <Link href="/login" className={styles["checkout-place-button"]} onClick={() => rememberPageAfterLogin("/cart")}>
                        Log in to pay
                      </Link>
                    )
                  ) : !hasPickedAddress || !chosenAddress ? (
                    <button type="button" className={styles["checkout-place-button"]} onClick={openAddressPicker}>
                      Select address
                    </button>
                  ) : isLoggedIn ? (
                    <button type="button" className={styles["checkout-place-button"]} onClick={() => void placeTheOrder()} disabled={isPlacingOrder}>
                      {isPlacingOrder ? "Placing your order…" : `Pay now · ${rupees(amountToPay)}`}
                    </button>
                  ) : (
                    <Link href="/login" className={styles["checkout-place-button"]} onClick={() => rememberPageAfterLogin("/cart")}>
                      Log in to pay
                    </Link>
                  )}
                </div>
                {placeOrderError && (
                  <p className={styles["checkout-place-order-error"]} role="alert">
                    {placeOrderError}
                  </p>
                )}
                {pricesUpdatedNote && (
                  <p className={styles["checkout-prices-updated-note"]} role="status">
                    {pricesUpdatedNote}
                  </p>
                )}
                <p className={styles["checkout-terms"]}>
                  {!hasPickedAddress && !planBeingExtended ? "Next: select the delivery address. " : ""}By placing this order you agree to our <Link href="/privacy-policy">Privacy policy</Link> and{" "}
                  <Link href="/refund">Refund policy</Link>
                </p>

                <ul className={styles["checkout-promises"]}>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path className={styles["checkout-promise-icon-filled"]} d="M6 11h12v9.5H6z" />
                      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                    </svg>
                    Secure payment
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                      <path d="M20 4v4h-4" />
                    </svg>
                    Easy refunds
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path className={styles["checkout-promise-icon-filled"]} d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" />
                      <path className={styles["checkout-promise-icon-vein"]} d="M5 19l7-7" />
                    </svg>
                    Freshness promise
                  </li>
                </ul>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* Address pop-up: the My Addresses cards; picking one confirms it (closes, ticks Select address) */}
      {isAddressPickerOpen && (
        <CheckoutPopupFrame labelledBy="checkout-address-heading" isWide onClose={closeAddressPicker}>
          <div>
            <div className={styles["address-pick-heading-row"]}>
              <div>
                <h2 id="checkout-address-heading" className={styles["address-pick-heading"]}>
                  Select delivery address
                </h2>
                <p className={styles["address-pick-description"]}>We currently deliver only to selected locations in Bengaluru.</p>
              </div>
              <button type="button" className={styles["address-pick-add-button"]} onClick={() => openAddressForm(null)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add new address
              </button>
            </div>

            {addresses.length === 0 ? (
              <p className={styles["address-pick-empty-message"]}>No saved addresses yet. Add one to get deliveries.</p>
            ) : (
              <ul className={styles["address-pick-list"]} role="radiogroup" aria-label="Delivery address">
                {addresses.map((address) => {
                  const isPicked = hasPickedAddress && address.id === chosenAddress?.id;
                  const isDefault = address.id === defaultAddressId;
                  function pickThisAddress() {
                    pickAddress(address.id, address);
                  }
                  return (
                    <li
                      key={address.id}
                      role="radio"
                      aria-checked={isPicked}
                      aria-label={`Deliver to ${address.label}: ${address.name}, ${formatAddressLine(address)}`}
                      tabIndex={0}
                      className={`${styles["address-pick-card"]} ${isPicked ? styles["address-pick-card-picked"] : ""}`}
                      onClick={pickThisAddress}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          pickThisAddress();
                        }
                      }}
                    >
                      <div className={styles["address-pick-card-heading-row"]}>
                        <h3 className={styles["address-pick-label"]}>{address.label}</h3>
                        {isDefault ? (
                          <span className={styles["address-pick-default-badge"]}>Default</span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Make ${address.label} the default address`}
                            className={styles["address-pick-switch-button"]}
                            onClick={(event) => {
                              event.stopPropagation();
                              setDefaultAddress(address.id);
                            }}
                          >
                            Set as Default
                          </button>
                        )}
                      </div>
                      <p className={styles["address-pick-name"]}>{address.name}</p>
                      <p className={styles["address-pick-line"]}>{formatAddressLine(address)}</p>
                      <p className={styles["address-pick-line"]}>{address.mobileNumber}</p>
                      <div className={styles["address-pick-actions"]}>
                        <button
                          type="button"
                          className={styles["address-pick-action-button"]}
                          onClick={(event) => {
                            event.stopPropagation();
                            openAddressForm(address);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${styles["address-pick-action-button"]} ${styles["address-pick-remove-button"]}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSavedAddress(address.id);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CheckoutPopupFrame>
      )}

      {planAtPickedAddress && cartSubscription && (
        <SameAddressPlanDialog
          plan={planAtPickedAddress}
          newPlan={cartSubscription}
          amountToPay={amountToPay}
          isLoggedIn={isLoggedIn}
          onExtend={(plan) => {
            closeSameAddressDialog();
            void placeTheOrder(plan);
          }}
          onClose={closeSameAddressDialog}
        />
      )}

      {isAddressFormOpen && (
        <AddressFormDialog
          addressToEdit={addressBeingEdited}
          isDefaultAtStart={addressBeingEdited ? addressBeingEdited.id === defaultAddressId : addresses.length === 0}
          asksProfileDetails={isProfileMissing}
          onSave={saveAddress}
          onClose={closeAddressForm}
        />
      )}
    </div>
  );
}
