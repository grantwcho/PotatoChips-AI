import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Disclosures",
  description:
    "Review important information about Potato Chips AI product information, AI-themed content, availability, and food safety limits.",
};

const sections = [
  {
    title: "Informational Only",
    body: (
      <>
        <p>
          The content of this website is provided for general informational,
          marketing, and brand storytelling purposes. Nothing on the site should
          be interpreted as medical, nutrition, dietary, legal, or regulatory
          advice.
        </p>
      </>
    ),
  },
  {
    title: "Product Information",
    body: (
      <>
        <p>
          We try to keep product descriptions, ingredients, nutrition
          information, allergen statements, pricing, availability, and imagery
          accurate, but details may change over time. Packaging, labels, and
          checkout notices may contain more current information than the
          website.
        </p>
        <p>
          Always review the product label before consuming Potato Chips AI
          products, especially if you have allergies, sensitivities, dietary
          restrictions, or medical nutrition concerns.
        </p>
      </>
    ),
  },
  {
    title: "Food Safety",
    body: (
      <>
        <p>
          Do not consume any product if the package appears opened, damaged,
          tampered with, expired, or otherwise unsafe. If a product quality,
          safety, or recall issue becomes necessary, we may provide notices
          through the site, email, retail partners, or other appropriate
          channels.
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
          experience. AI-themed recipes, flavor concepts, images, and narratives
          are not professional nutrition, medical, legal, or food safety advice.
        </p>
        <p>
          Concept images, recipe descriptions, and launch materials may not
          reflect final commercial products, packaging, ingredients, or
          availability.
        </p>
      </>
    ),
  },
  {
    title: "Purchases and Promotions",
    body: (
      <>
        <p>
          Product launches, purchases, preorders, samples, giveaways, discounts,
          and promotions may be subject to additional terms, eligibility rules,
          shipping limits, deadlines, refund policies, or availability
          constraints. Specific terms for a transaction or promotion control
          where they differ from general site materials.
        </p>
      </>
    ),
  },
  {
    title: "Third-Party Services",
    body: (
      <>
        <p>
          The site may rely on third-party services for hosting, payments,
          fulfillment, shipping, analytics, communications, fraud prevention, or
          security. We do not control every third-party service and do not
          guarantee uninterrupted availability of those services.
        </p>
      </>
    ),
  },
  {
    title: "Forward-Looking Statements",
    body: (
      <>
        <p>
          Descriptions of future products, flavors, launches, recipes,
          partnerships, distribution plans, or brand experiments are
          forward-looking and may change. Actual products, timing, and
          availability may differ from what appears on the site.
        </p>
      </>
    ),
  },
];

export default function DisclosuresPage() {
  return (
    <LegalPage
      title="Disclosures"
      sections={sections}
    />
  );
}
