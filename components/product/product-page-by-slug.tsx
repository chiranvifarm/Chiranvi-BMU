"use client";

import { useEffect } from "react";
import { notFound, useRouter } from "next/navigation";
import { rememberPageAfterLogin, useIsLoggedIn, useIsLoginStatusKnown } from "@/components/login/login-status";
import { useHaveProductPagesLoaded, useProductPages } from "@/store/product-pages-store";
import OneTimeProductPage from "./one-time-product-page";
import SubscriptionProductPage from "./subscription-product-page";

/*
  /products/<slug>: finds the product page with this address and draws it with the template for its kind
  (subscription or one-time). The starting pages are known on the server too; pages added in the Chiranvi
  Panel are only known once the browser has read its saved list, so until then nothing is drawn, and after
  that an unknown address shows "not found". Drafts show only in the panel's preview (?preview=1).
  Only for logged-in visitors: anyone else is sent to the login, which then comes back to this page.
*/

export default function ProductPageBySlug({ slug, isPreview }: { slug: string; isPreview: boolean }) {
  const productPages = useProductPages();
  const hasReadSavedPages = useHaveProductPagesLoaded();
  const page = productPages.find((productPage) => productPage.slug === slug && (productPage.status === "published" || isPreview));
  const isLoggedIn = useIsLoggedIn();
  const isLoginStatusKnown = useIsLoginStatusKnown();
  const router = useRouter();

  // Not logged in: log in first, then come back to this page. Waits until the saved login has been read.
  useEffect(() => {
    if (!isLoginStatusKnown || isLoggedIn) return;
    rememberPageAfterLogin(window.location.pathname + window.location.search);
    router.replace("/login");
  }, [isLoginStatusKnown, isLoggedIn, router]);

  // Nothing is shown until the visitor is known to be logged in
  if (!isLoggedIn) return null;

  if (!page) {
    if (hasReadSavedPages) notFound();
    return null;
  }
  return page.kind === "subscription" ? <SubscriptionProductPage page={page} /> : <OneTimeProductPage page={page} />;
}
