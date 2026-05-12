import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how Potato Chips AI handles information from site visitors, customers, and people who contact the brand.",
};

const sections = [
  {
    title: "Scope",
    body: (
      <>
        <p>
          This Privacy Policy describes how Potato Chips AI collects and uses
          information through our public website, contact forms, product pages,
          promotions, recipe development, order or preorder flows, and related
          communications. It applies to information you provide directly to us,
          information we collect automatically when you use the site, and
          information we receive from service providers that help us run the
          Potato Chips AI brand.
        </p>
        <p>
          This notice is designed for site visitors, customers, retail or media
          contacts, promotional partners, and anyone else who interacts with us
          online. If a separate program, promotion, wholesale relationship, or
          purchase flow provides more specific privacy terms, those specific terms
          apply to that interaction.
        </p>
      </>
    ),
  },
  {
    title: "Information We Collect",
    body: (
      <>
        <p>Depending on how you interact with the site, we may collect:</p>
        <ul className="list-disc space-y-3 pl-6">
          <li>
            identity and contact details, such as your name, email address,
            phone number, mailing address, company or retailer name, and message
            content;
          </li>
          <li>
            order, preorder, giveaway, or sampling details, such as products
            selected, shipping information, delivery preferences, and customer
            service history;
          </li>
          <li>
            payment-related information processed by our payment providers, such
            as transaction status, billing details, and limited payment metadata;
          </li>
          <li>
            technical and usage information, such as browser type, device
            characteristics, IP address, referrer, and pages visited; and
          </li>
          <li>
            feedback, reviews, survey responses, social media handles, photos,
            recipe ideas, or other content you choose to send us.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "How We Use Information",
    body: (
      <>
        <p>We use information collected through the site to:</p>
        <ul className="list-disc space-y-3 pl-6">
          <li>respond to customer, retail, wholesale, press, and general inquiries;</li>
          <li>
            process, fulfill, support, or troubleshoot purchases, preorders,
            samples, giveaways, and product-related requests;
          </li>
          <li>
            send transactional messages, product updates, launch announcements,
            and promotional communications where permitted;
          </li>
          <li>
            improve our website, product storytelling, packaging, recipes,
            customer support, and brand experience;
          </li>
          <li>
            detect fraud, abuse, spam, scraping, payment issues, or other harmful
            activity;
          </li>
          <li>
            comply with legal, regulatory, tax, accounting, and recordkeeping
            obligations; and
          </li>
          <li>
            manage recalls, safety notices, product quality issues, or other
            operational updates if they become necessary.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Cookies and Analytics",
    body: (
      <>
        <p>
          We may use cookies, local storage, server logs, and comparable
          technologies to understand how the site is used, keep forms and
          checkout-like experiences working, remember basic preferences, and
          improve performance. These tools may capture IP address, browser and
          device information, timestamps, referring pages, and interaction
          patterns.
        </p>
        <p>
          We may also use analytics or infrastructure providers to help us
          understand traffic, product interest, campaign performance, and
          operational health. You can control or restrict some cookie behavior
          through your browser settings, although doing so may affect certain
          site features.
        </p>
      </>
    ),
  },
  {
    title: "How We Share Information",
    body: (
      <>
        <p>
          We do not sell personal information for money. We may share
          information with service providers and advisors who help us host the
          site, process payments, fulfill orders, ship products, manage
          communications, analyze performance, prevent fraud, secure systems, or
          comply with legal obligations.
        </p>
        <p>
          We may also disclose information when reasonably necessary to protect
          our rights, investigate misuse of the site, comply with law or lawful
          process, support product safety or recall obligations, or support
          financing, restructuring, acquisition, sale, or other business
          transactions involving Potato Chips AI.
        </p>
      </>
    ),
  },
  {
    title: "Children's Privacy",
    body: (
      <>
        <p>
          The site is intended for a general audience and is not directed to
          children under 13. We do not knowingly collect personal information
          from children under 13. If you believe a child has provided personal
          information to us, please contact us so we can take appropriate steps.
        </p>
      </>
    ),
  },
  {
    title: "Retention and Security",
    body: (
      <>
        <p>
          We retain information for as long as reasonably necessary for the
          purposes described in this policy, including order support, customer
          service, marketing preferences, recordkeeping, dispute resolution,
          product safety, and compliance. Retention periods may differ based on
          the nature of the information, sensitivity of the data, and applicable
          legal obligations.
        </p>
        <p>
          We use administrative, technical, and organizational safeguards
          designed to protect information from unauthorized access, misuse,
          alteration, and loss. No internet-connected system is perfectly
          secure, so we cannot guarantee absolute security.
        </p>
      </>
    ),
  },
  {
    title: "Your Choices",
    body: (
      <>
        <p>
          You may choose not to submit information through the site, although
          some features, promotions, order-related requests, or customer support
          workflows will not function without the requested details. You may
          unsubscribe from marketing emails using the instructions in those
          messages where available.
        </p>
        <p>
          You may also contact us to request access, correction, or deletion of
          information, subject to our legal, safety, security, and recordkeeping
          obligations.
        </p>
        <p>
          If you would like to ask a privacy question or submit a request,
          please use our <Link href="/contact" className="underline">Contact Us</Link>{" "}
          page.
        </p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      sections={sections}
    />
  );
}
