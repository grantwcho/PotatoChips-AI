import type { Metadata } from "next";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Potato Chips AI for contributor, customer, media, and general inquiries.",
};

export default function ContactPage() {
  return (
    <div className="marketing-page-light">
      <section className="pt-32 pb-14 lg:pt-36 lg:pb-20">
        <div className="marketing-container">
          <div className="marketing-rail">
            <h1 className="max-w-5xl font-display text-[clamp(2.45rem,5.3vw,4.55rem)] leading-[0.95] tracking-[-0.05em] text-balance">
              <CharacterTextReveal text="Contact Us" />
            </h1>
          </div>
        </div>
      </section>

      <section className="pt-2 pb-20 lg:pt-4 lg:pb-24">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.69fr)_minmax(19rem,0.31fr)] lg:gap-16 lg:items-start">
              <div className="max-w-none">
                <ContactForm />
              </div>
              <div aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
