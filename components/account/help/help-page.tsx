"use client";

import { useState } from "react";
import { AccountPageHeading } from "../account-dashboard-layout";
import styles from "./help-page.module.css";

/*
  "Help" dashboard page (design): a search box and topic buttons that narrow the questions,
  the frequently asked questions (click to open or close an answer; the first starts open)
  and the ways to contact us (WhatsApp, call, email).
  Answers other than the first, and the contact number and email, are placeholders until the
  real ones are provided.
*/

const helpTopics = [
  { id: "delivery", label: "Delivery", iconPaths: ["M3 7h11v9H3z", "M14 10h4l3 3v3h-7", "M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01"] },
  { id: "payments", label: "Payments", iconPaths: ["M4 7h16v12H4z", "M4 7l2-3h12l2 3", "M16 13h.01"] },
  { id: "subscription", label: "Subscription", iconPaths: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4M16 3v4", "M9 15l2 2 4-4"] },
  { id: "milk-quality", label: "Milk quality", iconPaths: ["M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"] },
];

const frequentlyAskedQuestions = [
  {
    topicId: "subscription",
    question: "How do I pause my delivery?",
    answer: "Go to Subscription and press Pause subscription. A pause is for 8 days or more. Ask before 8 PM; our team approves it, and your plan ends later by those days.",
  },
  {
    topicId: "delivery",
    question: "Can I change my delivery slot?",
    answer: "Yes. Message us on WhatsApp or call us before 9 PM and we will move your delivery from the next morning.",
  },
  {
    topicId: "delivery",
    question: "How do I return empty bottles?",
    answer: "Leave the rinsed empty bottles at your door; our delivery partner collects them with the next delivery.",
  },
];

const contactOptions = [
  {
    label: "WhatsApp",
    detail: "+91 99028 81718",
    href: "https://wa.me/919902881718",
    iconColour: "green",
    iconPaths: ["M5 5h14v10H9l-4 4z"],
  },
  {
    label: "Call us",
    detail: "6 AM – 9 PM",
    href: "tel:+919902881718",
    iconColour: "blue",
    iconPaths: ["M6 3h3l2 5-2 1.5a11 11 0 0 0 5.5 5.5L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z"],
  },
  {
    label: "Email",
    detail: "care@chiranvi.in",
    href: "mailto:care@chiranvi.in",
    iconColour: "yellow",
    iconPaths: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
  },
] as const;

function HelpIcon({ iconPaths }: { iconPaths: readonly string[] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {iconPaths.map((iconPath) => (
        <path key={iconPath} d={iconPath} />
      ))}
    </svg>
  );
}

export default function HelpPage() {
  const [searchText, setSearchText] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(
    () => new Set([frequentlyAskedQuestions[0].question]),
  );

  const searchWords = searchText.trim().toLowerCase();
  const shownQuestions = frequentlyAskedQuestions.filter(
    (faq) =>
      (!selectedTopicId || faq.topicId === selectedTopicId) &&
      (!searchWords || `${faq.question} ${faq.answer}`.toLowerCase().includes(searchWords)),
  );

  function toggleQuestion(question: string) {
    setOpenQuestions((previousQuestions) => {
      const newQuestions = new Set(previousQuestions);
      if (newQuestions.has(question)) newQuestions.delete(question);
      else newQuestions.add(question);
      return newQuestions;
    });
  }

  return (
    <>
      <AccountPageHeading title="Help" description="Find answers or talk to us." />

      <label className={styles["help-search-box"]}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          type="search"
          value={searchText}
          placeholder="Search help"
          aria-label="Search help"
          className={styles["help-search-input"]}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </label>

      {/* Topic buttons: click to show only that topic's questions, click again to show all */}
      <ul className={styles["help-topic-list"]}>
        {helpTopics.map((helpTopic) => {
          const isSelected = selectedTopicId === helpTopic.id;
          return (
            <li key={helpTopic.id}>
              <button
                type="button"
                aria-pressed={isSelected}
                className={`${styles["help-topic-button"]} ${isSelected ? styles["help-topic-button-selected"] : ""}`}
                onClick={() => setSelectedTopicId(isSelected ? null : helpTopic.id)}
              >
                <span className={styles["help-icon-box"]}>
                  <HelpIcon iconPaths={helpTopic.iconPaths} />
                </span>
                {helpTopic.label}
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className={styles["help-section-heading"]}>Frequently asked questions</h2>
      <div className={styles["help-card"]}>
        {shownQuestions.length === 0 ? (
          <p className={styles["help-no-results"]}>No questions match yet. Contact us below and we will help.</p>
        ) : (
          <ul>
            {shownQuestions.map((faq, faqIndex) => {
              const isOpen = openQuestions.has(faq.question);
              const answerId = `help-answer-${faqIndex}`;
              return (
                <li key={faq.question} className={styles["help-question-row"]}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    className={styles["help-question-button"]}
                    onClick={() => toggleQuestion(faq.question)}
                  >
                    {faq.question}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className={`${styles["help-question-arrow"]} ${isOpen ? styles["help-question-arrow-open"] : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {isOpen && (
                    <p id={answerId} className={styles["help-answer"]}>
                      {faq.answer}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <h2 className={styles["help-section-heading"]}>Contact us</h2>
      <ul className={styles["help-contact-list"]}>
        {contactOptions.map((contactOption) => (
          <li key={contactOption.label}>
            <a
              href={contactOption.href}
              target={contactOption.href.startsWith("https") ? "_blank" : undefined}
              rel={contactOption.href.startsWith("https") ? "noreferrer" : undefined}
              className={styles["help-contact-card"]}
            >
              <span className={`${styles["help-icon-box"]} ${styles[`help-icon-box-${contactOption.iconColour}`]}`}>
                <HelpIcon iconPaths={contactOption.iconPaths} />
              </span>
              <span className={styles["help-contact-text"]}>
                <span className={styles["help-contact-label"]}>{contactOption.label}</span>
                <span className={styles["help-contact-detail"]}>{contactOption.detail}</span>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true" className={styles["help-contact-arrow"]}>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
