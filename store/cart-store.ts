import { useSyncExternalStore } from "react";
import {
  getAccountState,
  subscribeToAccountState,
  updateAccountState,
  useIsAccountStateLoaded,
} from "./account-state";
import { getStockLeftOfPack } from "./products-store";

/*
  Shopping cart, kept with the customer's login in the database (store/account-state.ts), so it follows them
  to any phone or laptop; nothing is kept in the browser. Logging out empties it. Each item keeps the product
  details the cart page shows, plus its quantity (the prices shown are checked again against the database:
  orders are always charged the database's prices).
  "Add to cart" before logging in: the product is remembered (in memory) as pending; logging in then adds it
  to the cart and returns to the landing page.
  A cart kept in this browser before the database is moved into the saved cart once, then deleted here.
*/

export type CartProduct = {
  productId: string;
  name: string;
  imageSource: string;
  imageWidth: number;
  imageHeight: number;
  packSize: string;
  price: number;
  originalPrice: number;
};

export type CartItem = CartProduct & { quantity: number };

const emptyCart: CartItem[] = [];
let pendingCartProduct: CartProduct | null = null;

// The browser's cart from before the database: moved into the saved cart once, then deleted
const OLD_CART_KEYS = { cart: "chiranvi-cart", coupon: "chiranvi-cart-coupon", subscription: "chiranvi-cart-subscription" };
let hasMovedOldCart = false;

function moveOldBrowserCart() {
  if (hasMovedOldCart || typeof window === "undefined") return;
  hasMovedOldCart = true;
  try {
    const oldCart = JSON.parse(window.localStorage.getItem(OLD_CART_KEYS.cart) ?? "null");
    const oldSubscription = JSON.parse(window.localStorage.getItem(OLD_CART_KEYS.subscription) ?? "null");
    const oldCoupon = window.localStorage.getItem(OLD_CART_KEYS.coupon);
    if (Array.isArray(oldCart) && oldCart.length > 0 && getAccountState().cart.length === 0) {
      updateAccountState({ cart: oldCart, cartSubscription: oldSubscription, cartCoupon: oldCoupon });
    }
    Object.values(OLD_CART_KEYS).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage blocked or unreadable: nothing to move.
  }
}

function subscribeToCart(onChange: () => void) {
  moveOldBrowserCart();
  return subscribeToAccountState(onChange);
}

function getCartItems() {
  return getAccountState().cart as CartItem[];
}

function saveCartItems(newCartItems: CartItem[]) {
  updateAccountState({ cart: newCartItems });
}

// Items in the cart. On the server the cart is empty.
export function useCartItems() {
  return useSyncExternalStore(subscribeToCart, () => getCartItems() as CartItem[], () => emptyCart);
}

// True once the saved cart has been read (the cart page waits for it, so it doesn't flash "empty")
export function useIsCartLoaded() {
  return useIsAccountStateLoaded();
}

// Total number of packs in the cart (shown on the navigation bar's cart badge).
export function countCartPacks(items: CartItem[]) {
  return items.reduce((packCount, cartItem) => packCount + cartItem.quantity, 0);
}

/*
  One order holds up to 9 of a product, all its packs together (6 x 1 litre + 3 x 500 ml is the limit), and other
  products have their own 9. An order placed empties the cart, so the customer can buy 9 more. The database
  checks the same limit (private.save_order). A press past the limit does nothing and shows the message for a
  few seconds on the page (useCartLimitMessage).
  One-time orders also stop at what is left of the pack, after the plans' share: with 4 bottles left, the 5th press shows
  that it is out of stock. A plan's bottles a day are not stopped by it (isForPlan): plans have their own share.
*/
const MOST_OF_A_PRODUCT = 9;
const CART_LIMIT_MESSAGE = "You can add up to 9 of each item per order.";
const CART_LIMIT_MESSAGE_SECONDS = 3.5;

let cartLimitMessage: string | null = null;
let cartLimitMessageTimer: ReturnType<typeof setTimeout> | null = null;
const cartLimitMessageListeners = new Set<() => void>();

function setCartLimitMessage(message: string | null) {
  cartLimitMessage = message;
  cartLimitMessageListeners.forEach((onChange) => onChange());
}

function showCartLimitMessage(message = CART_LIMIT_MESSAGE) {
  if (cartLimitMessageTimer) clearTimeout(cartLimitMessageTimer);
  setCartLimitMessage(message);
  cartLimitMessageTimer = setTimeout(() => setCartLimitMessage(null), CART_LIMIT_MESSAGE_SECONDS * 1000);
}

function subscribeToCartLimitMessage(onChange: () => void) {
  cartLimitMessageListeners.add(onChange);
  return () => {
    cartLimitMessageListeners.delete(onChange);
  };
}

// The limit message while it is showing, otherwise null
export function useCartLimitMessage() {
  return useSyncExternalStore(subscribeToCartLimitMessage, () => cartLimitMessage, () => null);
}

// Every pack of a product has the product's name
function isProductAtLimit(productName: string, cartItems: CartItem[]) {
  const packsInCart = cartItems.filter((cartItem) => cartItem.name === productName);
  return countCartPacks(packsInCart) >= MOST_OF_A_PRODUCT;
}

// "Out of stock. You can only buy 1 bottle." With none left, only that it is out of stock.
function outOfStockMessage(productId: string, packSize: string) {
  const packsLeft = getStockLeftOfPack(productId) ?? 0;
  if (packsLeft <= 0) return "This item is out of stock.";
  const packWord = packSize.match(/bottle|jar/i)?.[0].toLowerCase() ?? "pack";
  return `Out of stock. You can only buy ${packsLeft} ${packWord}${packsLeft === 1 ? "" : "s"}.`;
}

// True when one more of this pack would be more than is left for one-time orders
function isOverStock(productId: string, cartItems: CartItem[]) {
  const packsLeft = getStockLeftOfPack(productId);
  if (packsLeft === null) return false;
  const planMilkId = (getAccountState().cartSubscription as CartSubscription | null)?.product.productId;
  const packsInCart = productId === planMilkId ? 0 : (cartItems.find((cartItem) => cartItem.productId === productId)?.quantity ?? 0);
  return packsInCart + 1 > packsLeft;
}

/*
  Adds one pack of the product (or one more, if it is already in the cart), up to the limits above.
  A plan waiting from "Start subscription" stays: the cart page shows the plan and the one-time items
  together and checks them out in one payment.
*/
export function addProductToCart(product: CartProduct, isForPlan = false) {
  const cartItems = getCartItems();
  if (isProductAtLimit(product.name, cartItems)) {
    showCartLimitMessage();
    return;
  }
  if (!isForPlan && isOverStock(product.productId, cartItems)) {
    showCartLimitMessage(outOfStockMessage(product.productId, product.packSize));
    return;
  }
  const isAlreadyInCart = cartItems.some((cartItem) => cartItem.productId === product.productId);
  saveCartItems(
    isAlreadyInCart
      ? cartItems.map((cartItem) =>
          cartItem.productId === product.productId ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem,
        )
      : [...cartItems, { ...product, quantity: 1 }],
  );
}

// Takes the product out of the cart (all its packs), e.g. the milk once its plan is paid.
export function removeCartItem(productId: string) {
  saveCartItems(getCartItems().filter((cartItem) => cartItem.productId !== productId));
}

// + adds one pack (up to the limit), - removes one; at 0 the product leaves the cart.
export function changeCartItemQuantity(productId: string, quantityChange: 1 | -1, isForPlan = false) {
  const cartItems = getCartItems();
  const changedItem = cartItems.find((cartItem) => cartItem.productId === productId);
  if (quantityChange === 1 && changedItem && isProductAtLimit(changedItem.name, cartItems)) {
    showCartLimitMessage();
    return;
  }
  if (quantityChange === 1 && !isForPlan && isOverStock(productId, cartItems)) {
    showCartLimitMessage(outOfStockMessage(productId, changedItem?.packSize ?? ""));
    return;
  }
  saveCartItems(
    cartItems
      .map((cartItem) =>
        cartItem.productId === productId ? { ...cartItem, quantity: cartItem.quantity + quantityChange } : cartItem,
      )
      .filter((cartItem) => cartItem.quantity > 0),
  );
}

/*
  One-time items come down to what is left, with the message: bottles chosen on the Subscribe tab (not stopped by
  stock) become a one-time purchase on the One-time tab or in the cart. A plan's own milk is left alone.
*/
export function fitCartToStock() {
  const cartItems = getCartItems();
  const planMilkId = (getAccountState().cartSubscription as CartSubscription | null)?.product.productId;
  const fittedItems = cartItems
    .map((cartItem) => {
      const packsLeft = cartItem.productId === planMilkId ? null : getStockLeftOfPack(cartItem.productId);
      return packsLeft !== null && cartItem.quantity > packsLeft ? { ...cartItem, quantity: Math.max(packsLeft, 0) } : cartItem;
    })
    .filter((cartItem) => cartItem.quantity > 0);
  const changedItem = cartItems.find((cartItem) => !fittedItems.includes(cartItem));
  if (!changedItem) return;
  saveCartItems(fittedItems);
  showCartLimitMessage(outOfStockMessage(changedItem.productId, changedItem.packSize));
}

// The coupon applied at checkout, kept with the cart so a refresh does not drop it
export function setAppliedCouponCode(code: string | null) {
  updateAccountState({ cartCoupon: code });
}

export function useAppliedCouponCode() {
  return useSyncExternalStore(subscribeToCart, () => getAccountState().cartCoupon, () => null);
}

/*
  A milk subscription waiting to be paid ("Start subscription" on the milk page). While there is one,
  the cart page checks out only the subscription; the one-time items stay in the cart for later.
*/
export type CartSubscription = {
  product: CartProduct;
  planId: string;
  planName: string; // "6 Months"
  months: number;
  days: number;
  bottlesPerDay: number;
  pricePerLitre: number;
  bottleCount: number;
  planTotal: number; // what the customer pays
  oneTimeTotal: number; // the same bottles at the one-time price
  bottleLabel?: string; // "500 ml" (missing: "1 L")
  unitName?: string; // what the price is per: "500 ml" (missing: "litre")
  extendsOrderId?: string; // "Extend Plan" on My Subscription: adds these days to that running plan
};

/*
  Start subscription puts the plan here; null takes it out (paid, switched or removed).
  The milk's quantity (Add Quantity) stays in the cart while the plan waits, so going back to the milk
  page keeps it; once the plan is paid, the cart page takes that milk out (removeCartItem).
*/
export function setCartSubscription(subscription: CartSubscription | null) {
  updateAccountState({ cartSubscription: subscription });
}

export function useCartSubscription() {
  return useSyncExternalStore(subscribeToCart, () => getAccountState().cartSubscription as CartSubscription | null, () => null);
}

// Logging out, or an order placed: the cart (its coupon and any subscription) starts empty.
export function emptyTheCart() {
  pendingCartProduct = null;
  updateAccountState({ cart: emptyCart, cartSubscription: null, cartCoupon: null });
}

// "Add to cart" before logging in: remember the product until the login finishes.
export function rememberPendingCartProduct(product: CartProduct) {
  pendingCartProduct = product;
}

// The login was closed without logging in: forget the remembered product, so a later login doesn't add it.
export function forgetPendingCartProduct() {
  pendingCartProduct = null;
}

// After logging in: add the remembered product (if any) to the cart. True when a product was added.
export function addPendingProductToCart() {
  const productToAdd = pendingCartProduct;
  pendingCartProduct = null;
  if (productToAdd) addProductToCart(productToAdd);
  return productToAdd !== null;
}
