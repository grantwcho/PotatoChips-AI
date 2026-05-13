import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Potato Chips AI for media and general inquiries.",
};

export default function ContactPage() {
  return (
    <div
      className="marketing-contact-page marketing-page-light"
      style={contactPageStyle}
    >
      <div className="marketing-contact-shell" style={contactShellStyle}>
        <h1 className="marketing-contact-title" style={contactTitleStyle}>
          Contact
        </h1>

        <p className="marketing-contact-intro" style={contactIntroStyle}>
          Thank you for your interest in Potato Chips AI, the only edible AI
          chip!
        </p>

        <p className="marketing-contact-copy" style={contactCopyStyle}>
          For inquiries, email{" "}
          <a href="mailto:press@potatochips.ai" style={contactLinkStyle}>
            press@potatochips.ai
          </a>
          .
        </p>
      </div>
    </div>
  );
}

const contactPageStyle = {
  background: "#f7f7f7",
  color: "#000000",
  minHeight: "clamp(48rem, 78vh, 62rem)",
  padding: "clamp(9rem, 14vw, 13rem) 0 clamp(7rem, 11vw, 10rem)",
} satisfies CSSProperties;

const contactShellStyle = {
  marginLeft: "clamp(2rem, 15vw, 19.5rem)",
  marginRight: "auto",
  width: "min(72rem, calc(100vw - clamp(2rem, 15vw, 19.5rem) - 2rem))",
} satisfies CSSProperties;

const contactTitleStyle = {
  color: "#000000",
  fontFamily: "var(--font-google-sans), system-ui, sans-serif",
  fontSize: "clamp(4rem, 5vw, 6.35rem)",
  fontWeight: 700,
  letterSpacing: "-0.07em",
  lineHeight: 0.95,
  margin: 0,
} satisfies CSSProperties;

const contactIntroStyle = {
  color: "#000000",
  fontSize: "clamp(1.32rem, 1.55vw, 1.85rem)",
  fontWeight: 700,
  letterSpacing: "-0.045em",
  lineHeight: 1.18,
  margin: "clamp(3rem, 5vw, 4.4rem) 0 0",
  maxWidth: "38rem",
} satisfies CSSProperties;

const contactCopyStyle = {
  color: "#000000",
  fontSize: "clamp(1.12rem, 1.25vw, 1.5rem)",
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 1.3,
  margin: "clamp(4.75rem, 8vw, 7rem) 0 0",
} satisfies CSSProperties;

const contactLinkStyle = {
  color: "inherit",
  textDecoration: "underline",
  textDecorationThickness: "1px",
  textUnderlineOffset: "0.16em",
} satisfies CSSProperties;
