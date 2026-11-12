import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/*
  Coming soon: until launch, people opening the real domain (e.g. from a Google search) see only a
  "Coming soon" page. The Vercel links (*.vercel.app) and localhost still open the full site, so the
  team keeps building and testing there.
  Launch day: in Vercel → Settings → Environment Variables, add SITE_IS_LIVE = true (Production) and
  redeploy. The real domain then opens the full site, no code change needed.
*/
const comingSoonDomains = ["chiranvifarm.com", "www.chiranvifarm.com"];

// The page is sent straight from here (not a Next.js page) so the site's pop-ups and toasts never
// show on top of it. The logo is a normal file in public/, which this proxy lets through.
const comingSoonPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chiranvi Farm | Coming soon</title>
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@700&display=swap" rel="stylesheet">
<style>
  .coming-soon-page { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; padding: 24px; box-sizing: border-box; background: #FBF3E1; }
  .coming-soon-logo { width: min(300px, 70vw); height: auto; }
  .coming-soon-title { margin: 0; font-family: "Ubuntu", sans-serif; font-weight: 700; font-size: clamp(32px, 7vw, 56px); color: #1F4D2E; text-align: center; }
</style>
</head>
<body class="coming-soon-page">
  <img class="coming-soon-logo" src="/images/brand/chiranvi-farm-logo.webp" alt="Chiranvi Farm" width="516" height="240">
  <h1 class="coming-soon-title">Coming soon</h1>
</body>
</html>`;

/*
  Next.js runs this before every page: it keeps the Supabase login fresh (see lib/supabase/proxy.ts).
  (In Next.js 16 this file is called proxy.ts; older guides call it middleware.ts.)
*/
export async function proxy(request: NextRequest) {
  const domain = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const isSiteLive = process.env.SITE_IS_LIVE === "true";
  // /api stays open on the real domain so payment callbacks keep working.
  const isApiRequest = request.nextUrl.pathname.startsWith("/api");

  if (!isSiteLive && comingSoonDomains.includes(domain) && !isApiRequest) {
    return new Response(comingSoonPageHtml, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return await updateSession(request);
}

// Run on pages only: skip Next.js's own files, the tab icon and pictures, which never need a login check.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
