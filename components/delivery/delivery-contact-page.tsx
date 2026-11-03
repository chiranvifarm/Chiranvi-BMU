"use client";

import { callLink, whatsAppLink } from "@/store/delivery-agent-store";
import { DeliveryPageHeading, deliveryButtonStyles } from "./delivery-panel-layout";
import styles from "./delivery-contact-page.module.css";

/*
  Work → Contact farm (/delivery/contact): call or WhatsApp the farm, the same number as on the website's
  Contact us page.
*/

const FARM_PHONE = "9902881718";

export default function DeliveryContactPage() {
  return (
    <>
      <DeliveryPageHeading title="Contact farm" description="Call or message Chiranvi Farm." />

      <section className={styles["delivery-contact-card"]} aria-label="Chiranvi Farm">
        <span className={styles["delivery-contact-name"]}>Chiranvi Farm</span>
        <span className={styles["delivery-contact-number"]}>+91 {`${FARM_PHONE.slice(0, 5)} ${FARM_PHONE.slice(5)}`}</span>
        <div className={styles["delivery-contact-buttons"]}>
          <a href={callLink(FARM_PHONE)} className={deliveryButtonStyles.filled}>
            Call
          </a>
          <a href={whatsAppLink(FARM_PHONE)} target="_blank" rel="noopener noreferrer" className={deliveryButtonStyles.outlined}>
            WhatsApp
          </a>
        </div>
      </section>
    </>
  );
}
