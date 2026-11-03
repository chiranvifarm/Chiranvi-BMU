import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/*
  Keeps the Supabase login fresh. Runs before every page (called from proxy.ts in the project root):
  reads the login cookies, renews the session with Supabase when it is about to expire, and writes the
  renewed cookies onto both the incoming request (so this page sees them) and the response (so the
  browser saves them).
*/
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Checks the login and renews it if needed. Keep this straight after createServerClient.
  await supabase.auth.getClaims();

  return response;
}
