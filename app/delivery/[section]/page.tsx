"use client";

import { notFound, useParams } from "next/navigation";
import DeliveryContactPage from "@/components/delivery/delivery-contact-page";
import DeliveryLeavesPage from "@/components/delivery/delivery-leaves-page";
import { DELIVERY_PANEL_PAGES, DeliveryComingNext } from "@/components/delivery/delivery-panel-layout";
import DeliveryProfilePage from "@/components/delivery/delivery-profile-page";
import DeliveryReportsPage from "@/components/delivery/delivery-reports-page";

// Profile, Manager reports, Leaves & attendance and Contact farm
const SECTION_PAGES: Record<string, () => React.JSX.Element> = {
  profile: DeliveryProfilePage,
  "manager-reports": DeliveryReportsPage,
  leaves: DeliveryLeavesPage,
  contact: DeliveryContactPage,
};

export default function DeliverySectionRoute() {
  const { section } = useParams<{ section: string }>();
  const page = DELIVERY_PANEL_PAGES.find((panelPage) => panelPage.href === `/delivery/${section}`);
  if (!page) notFound();
  const SectionPage = SECTION_PAGES[section];
  return SectionPage ? <SectionPage /> : <DeliveryComingNext label={page.label} />;
}
