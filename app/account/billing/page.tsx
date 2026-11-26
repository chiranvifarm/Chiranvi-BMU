import type { Metadata } from "next";
import BillingPage from "@/components/account/billing/billing-page";

export const metadata: Metadata = {
  title: "Billing & payment | Chiranvi Farm",
};

export default function AccountBillingPage() {
  return <BillingPage />;
}
