import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins, Ubuntu } from "next/font/google";
import BulkOrderPopup from "@/components/bulk-order/bulk-order-popup";
import NetworkStatus from "@/components/network-status/network-status";
import ProfileReminderToast, { OrderUpdateToast } from "@/components/profile-reminder/profile-reminder-toast";
import SmoothScroll from "@/components/smooth-scroll/smooth-scroll";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// The site's fonts for the bulk order pop-up (each page loads them only inside itself)
const poppinsFont = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins" });
const ubuntuFont = Ubuntu({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-ubuntu" });

export const metadata: Metadata = {
  title: "Dairy Store",
  description: "Online dairy products store",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        {/* Smooth scrolling on every page (Lenis, same feel as cleverln.com) */}
        <SmoothScroll>{children}</SmoothScroll>
        {/* "No internet connection" screen over any page while offline */}
        <NetworkStatus />
        {/* "We take bulk orders!" pop-up on the customer pages (10 s after landing, once per visit) */}
        <div className={`${poppinsFont.variable} ${ubuntuFont.variable}`}>
          <BulkOrderPopup />
          {/* After the bulk order pop-up: "Log in" or "Complete your profile" notification (see the component) */}
          <ProfileReminderToast />
          {/* A logged-in customer's order changed status */}
          <OrderUpdateToast />
        </div>
      </body>
    </html>
  );
}
