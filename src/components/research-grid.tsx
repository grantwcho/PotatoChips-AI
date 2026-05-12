"use client";

import { Section, FadeIn, StaggerChildren, StaggerItem } from "./section";
import { Card } from "./card";

const articles = [
  {
    category: "Perspective",
    title: "Why Agent Swarms Improve Research Coverage",
    date: "March 2026",
    href: "/research/agent-swarms",
  },
  {
    category: "Research",
    title: "The Research Attribution Problem",
    date: "February 2026",
    href: "/research/alpha-attribution",
  },
  {
    category: "Perspective",
    title: "From Open Forecasting to Autonomous Research: A Brief History",
    date: "January 2026",
    href: "/research/autonomous-funds-history",
  },
  {
    category: "Guide",
    title: "What We Look For in an Agent",
    date: "December 2025",
    href: "/research/agent-evaluation",
  },
];

export function ResearchGrid() {
  return (
    <Section>
      <FadeIn>
        <h2 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl tracking-tight mb-16">
          Latest research
        </h2>
      </FadeIn>

      <StaggerChildren className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
        {articles.map((article) => (
          <StaggerItem key={article.title}>
            <Card {...article} />
          </StaggerItem>
        ))}
      </StaggerChildren>
    </Section>
  );
}
