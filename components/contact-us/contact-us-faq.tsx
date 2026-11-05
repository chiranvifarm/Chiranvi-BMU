"use client";

import { useState } from "react";
import styles from "./contact-us-page.module.css";

/*
  "Frequently asked questions" on the Contact Us page: one question open at a time (all closed
  when the page loads). Clicking a question opens it; clicking the open one closes it.
  The plus / minus circle shows whether a question is open.
  Only the first answer comes from the design; the others are placeholder text to be replaced.
*/

const frequentlyAskedQuestions = [
  {
    question: "How do I start a daily milk subscription?",
    answer:
      "Message us on WhatsApp with your address and daily quantity, or use the form above. Deliveries start the next morning.",
  },
  {
    question: "Can I pause or change my delivery?",
    answer:
      "Yes. Let us know before the evening and we will change the next morning’s delivery for you. To pause, use Pause subscription on your Subscription page, for 8 days or more.",
  },
  {
    question: "Where do you deliver?",
    answer:
      "We deliver to homes and apartments in and around our service areas. Share your address with us and we will confirm.",
  },
  {
    question: "Can I visit the farm?",
    answer: "We’d love to have you. Send us a message with a day that suits you and we will arrange a farm visit.",
  },
  {
    question: "Do you take bulk or B2B orders?",
    answer:
      "Yes, we supply bulk orders for events, shops and businesses. Tell us what you need using the form above.",
  },
];

export default function ContactUsFaq() {
  const [openQuestionIndex, setOpenQuestionIndex] = useState<number | null>(null);

  return (
    <section className={styles["contact-us-faq-section"]} aria-labelledby="contact-us-faq-heading">
      <p className={styles["contact-us-eyebrow"]}>Quick answers</p>
      <h2 id="contact-us-faq-heading" className={styles["contact-us-faq-heading"]}>
        Frequently asked questions
      </h2>

      <ul className={styles["contact-us-faq-list"]}>
        {frequentlyAskedQuestions.map((frequentlyAskedQuestion, questionIndex) => {
          const isOpen = questionIndex === openQuestionIndex;
          return (
            <li key={frequentlyAskedQuestion.question} className={styles["contact-us-faq-item"]}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`contact-us-faq-answer-${questionIndex}`}
                className={styles["contact-us-faq-question"]}
                onClick={() => setOpenQuestionIndex(isOpen ? null : questionIndex)}
              >
                {frequentlyAskedQuestion.question}
                <span
                  className={`${styles["contact-us-faq-toggle"]} ${isOpen ? styles["contact-us-faq-toggle-open"] : ""}`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M6 12h12" />
                    {!isOpen && <path d="M12 6v12" />}
                  </svg>
                </span>
              </button>
              <div
                id={`contact-us-faq-answer-${questionIndex}`}
                className={`${styles["contact-us-faq-answer"]} ${isOpen ? styles["contact-us-faq-answer-open"] : ""}`}
              >
                <p className={styles["contact-us-faq-answer-text"]}>{frequentlyAskedQuestion.answer}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
