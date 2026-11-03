import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/*
  Next.js runs this before every page: it keeps the Supabase login fresh (see lib/supabase/proxy.ts).
  (In Next.js 16 this file is called proxy.ts; older guides call it middleware.ts.)
*/
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

// Run on pages only: skip Next.js's own files, the tab icon and pictures, which never need a login check.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
