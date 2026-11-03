import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/*
  Supabase connection with the SECRET key, for our own server code only (API routes such as
  app/api/payments/*). It is not a logged-in person: it may run the database functions kept for the
  server, e.g. marking an order paid once Razorpay's signature has been checked. Never import this file
  into a client component, and never give the secret key a NEXT_PUBLIC_ name.
*/
export function createAdminClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
