import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Review the rules that govern access to and use of Potato Chips AI's website, product information, and brand materials.",
};

const sections = [
  {
    title: "Acceptance of Terms",
    body: (
      <>
        <p>
          By accessing or using this website, you agree to these Terms of
          Service and any other policies, product notices, promotion rules, or
          purchase terms that apply to specific parts of the site. If you do not
          agree, you should not use the website.
        </p>
        <p>
          We may update these terms from time to time. Your continued use of
          the site after changes become effective constitutes acceptance of the
          revised terms.
        </p>
      </>
    ),
  },
  {
    title: "Permitted Use",
    body: (
      <>
        <p>
          The site is provided for brand storytelling, product information,
          recipe development, packaging experiments, customer communications,
          promotions, and any order or pre-order experiences we choose to make
          available. You may use the site only in compliance with applicable law
          and these terms.
        </p>
        <p>
          You may not use the site to interfere with operations, gain
          unauthorized access, impersonate another person or entity, distribute
          malicious code, or harvest information at scale without permission.
        </p>
      </>
    ),
  },
  {
    title: "Product Information",
    body: (
      <>
        <p>
          We try to present product descriptions, ingredients, nutrition
          information, allergen statements, availability, pricing, and imagery
          accurately. Product details may change over time, and packaging,
          labels, or checkout notices may contain more current information than
          the website.
        </p>
        <p>
          If you have allergies, sensitivities, dietary restrictions, or medical
          nutrition concerns, review the package label before consuming any
          product and consult an appropriate professional when needed. Do not
          rely on website copy alone for allergy or health decisions.
        </p>
      </>
    ),
  },
  {
    title: "Purchases, Pre-orders, and Promotions",
    body: (
      <>
        <p>
          If the site allows purchases, pre-orders, samples, giveaways, or other
          promotions, additional terms may apply, including checkout terms,
          shipping terms, refund or return policies, eligibility rules, and
          promotional deadlines. Those specific terms control for that
          transaction or promotion if they conflict with these general terms.
        </p>
        <p>
          We may limit quantities, reject or cancel orders, correct pricing or
          product errors, substitute or discontinue products, and refuse service
          where permitted by law. We will provide shipping, delay, cancellation,
          and refund information where required by applicable law.
        </p>
      </>
    ),
  },
  {
    title: "Feedback and User Content",
    body: (
      <>
        <p>
          If you send us feedback, reviews, photos, recipe ideas, social media
          posts, or other materials, you represent that you have the right to
          provide them and that they do not violate third-party rights or
          applicable law.
        </p>
        <p>
          You grant Potato Chips AI permission to review, store, edit, publish,
          and use those materials to operate, improve, and promote the brand,
          unless we agree otherwise in writing.
        </p>
      </>
    ),
  },
  {
    title: "Intellectual Property",
    body: (
      <>
        <p>
          The site, its design, branding, text, graphics, software, and other
          content are owned by Potato Chips AI or its licensors and are
          protected by applicable intellectual property laws. Except as
          expressly permitted, you may not reproduce, modify, distribute,
          display, or create derivative works from site content, packaging
          artwork, product names, logos, or brand assets without prior written
          permission.
        </p>
      </>
    ),
  },
  {
    title: "AI and Recipe Content",
    body: (
      <>
        <p>
          Potato Chips AI uses AI-themed storytelling, recipe development, and
          generated or AI-assisted creative content as part of the brand
          experience. That content is for entertainment, marketing, and general
          informational purposes.
        </p>
        <p>
          AI-themed copy, recipe narratives, images, or product concepts on the
          site are not professional nutrition, medical, legal, or food safety
          advice, and they may not reflect final commercial products.
        </p>
      </>
    ),
  },
  {
    title: "Disclaimers",
    body: (
      <>
        <p>
          The site and its content are provided on an &quot;as is&quot; and
          &quot;as available&quot; basis. To the fullest extent permitted by law,
          Potato Chips AI disclaims warranties of any kind, whether express or
          implied, including warranties of merchantability, fitness for a
          particular purpose, non-infringement, accuracy, and availability.
        </p>
        <p>
          We do not warrant that the site will be uninterrupted, secure, or
          error-free, that product information will always be current, or that
          any defects will be corrected.
        </p>
      </>
    ),
  },
  {
    title: "Limitation of Liability",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, Potato Chips AI and its
          affiliates will not be liable for any indirect, incidental,
          consequential, special, exemplary, or punitive damages, or for any loss
          of profits, data, goodwill, business opportunity, or other intangible
          losses arising from or related to your use of the site, product
          information, promotions, or brand materials.
        </p>
      </>
    ),
  },
  {
    title: "Governing Law",
    body: (
      <>
        <p>
          These Terms of Service are governed by the laws of the State of
          Delaware, without regard to conflict-of-law principles, unless
          otherwise required by applicable law.
        </p>
      </>
    ),
  },
];

export default function TermsOfServicePage() {
  return (
    <LegalPage
      title="Terms of Service"
      sections={sections}
    />
  );
}
