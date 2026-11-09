import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Who is logged in. The real login is Supabase Auth (phone OTP, see login-panel.tsx): Supabase keeps the
  session in this browser and renews it, so the login stays after a refresh and after closing the tab,
  until Log out. This file follows that session and gives the rest of the site the logged-in mobile
  number (10 digits), with the same functions as before, so the cart, account pages and Chiranvi Panel
  did not have to change. The number comes only from the Supabase session: nothing about the login is kept
  in browser storage. (An older copy, "chiranvi-login" in localStorage, is deleted.) Stores that aren't
  React components read it with readLoggedInMobileNumber().
  Other open tabs follow along (Supabase tells every tab about a login or logout).

  Page after login: the cart icon, profile icon and account pages note where the visitor wanted to go,
  so the login opens that page afterwards (the cart page when nothing was noted).
*/

// Where an older version kept a copy of the number in this browser (deleted, never read)
const OLD_LOGIN_STORAGE_KEY = "chiranvi-login";

// The logged-in mobile number, 10 digits (for example "8754852810"), or null when logged out.
let loggedInMobileNumber: string | null = null;
// True once Supabase has said whether there is a session (pages wait for this before sending anyone to the login)
let isSessionChecked = false;
let isFollowingSupabase = false;
let pageAfterLogin: string | null = null;
const loginStatusListeners = new Set<() => void>();

function announceLoginStatusChange() {
  loginStatusListeners.forEach((onChange) => onChange());
}

// The logged-in number changed (a login, a renewal for another number, or a logout)
function setLoggedInMobileNumber(mobileNumber: string | null) {
  loggedInMobileNumber = mobileNumber;
  announceLoginStatusChange();
}

// "+918754852810" or "918754852810" (how Supabase keeps phones) → "8754852810"
function tenDigitsOf(phone: string | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/*
  Follows the Supabase session from the first time the login state is needed in the browser:
  the session found on opening the site, a login, a renewal, a logout (also in other tabs).
*/
function followSupabaseSession() {
  if (isFollowingSupabase || typeof window === "undefined") return;
  isFollowingSupabase = true;
  try {
    window.localStorage.removeItem(OLD_LOGIN_STORAGE_KEY);
  } catch {
    // Storage blocked (private window): there is no old copy to delete
  }
  createClient().auth.onAuthStateChange((event, session) => {
    // Called from inside Supabase: the work is done just after, as Supabase advises
    window.setTimeout(() => {
      const sessionMobile = tenDigitsOf(session?.user?.phone);
      if (sessionMobile !== loggedInMobileNumber) setLoggedInMobileNumber(sessionMobile);
      if (event === "INITIAL_SESSION" && !isSessionChecked) {
        isSessionChecked = true;
        announceLoginStatusChange();
      }
    }, 0);
  });
}

// After "Verify & log in" succeeded with Supabase: show the logged-in state straight away.
// mobileNumber: the 10 digits that were typed on the login page.
export function rememberLogin(mobileNumber: string) {
  setLoggedInMobileNumber(mobileNumber);
}

// Log out of Supabase (in every tab of this browser) and forget the number and the noted page
export function logOut() {
  pageAfterLogin = null;
  setLoggedInMobileNumber(null);
  void createClient().auth.signOut();
}

// Where to go once the login finishes (for example "/account" when the profile icon was clicked).
export function rememberPageAfterLogin(pagePath: string) {
  pageAfterLogin = pagePath;
}

// The noted page (or null), forgotten once read.
export function takePageAfterLogin() {
  const notedPage = pageAfterLogin;
  pageAfterLogin = null;
  return notedPage;
}

function subscribeToLoginStatus(onChange: () => void) {
  loginStatusListeners.add(onChange);
  followSupabaseSession();
  return () => {
    loginStatusListeners.delete(onChange);
  };
}

function getLoggedInMobileNumber() {
  return loggedInMobileNumber;
}

/*
  The logged-in number (10 digits) or null, for code that isn't a React component (a store saving an address
  or an order). It is known once a page has shown the login state, which every page does before anyone can save.
*/
export function readLoggedInMobileNumber() {
  return loggedInMobileNumber;
}

function getIsSessionChecked() {
  return isSessionChecked;
}

// The logged-in mobile number (10 digits) or null. On the server (and while the page first loads) null.
export function useLoggedInMobileNumber() {
  return useSyncExternalStore(subscribeToLoginStatus, getLoggedInMobileNumber, () => null);
}

// True once the user has logged in (until they log out). On the server it is false.
export function useIsLoggedIn() {
  return useLoggedInMobileNumber() !== null;
}

/*
  False on the server and until Supabase has said whether this browser has a session, true afterwards.
  Pages that send logged-out visitors away wait for this, so a refresh never sends a logged-in
  visitor to the login before their session has been read.
*/
export function useIsLoginStatusKnown() {
  return useSyncExternalStore(subscribeToLoginStatus, getIsSessionChecked, () => false);
}
