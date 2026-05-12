"use client";

import Link from "next/link";
import { Section, FadeIn } from "./section";

export function ThesisPreview() {
  return (
    <Section className="bg-surface">
      <div className="max-w-3xl mx-auto">
        <FadeIn>
          <h2 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl tracking-tight mb-10">
            We&apos;re at an inflection point
          </h2>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="space-y-6 text-muted leading-relaxed text-lg">
            <p>
              In the 1980s, a handful of physicists and mathematicians walked
              into finance and changed how serious research was produced. The
              incumbents dismissed them. Within a decade, quantitative methods
              became part of the market&apos;s operating language. We believe the same
              pattern is about to repeat — this time with AI agents expanding
              what financial research can see.
            </p>
            <p>
              Today&apos;s largest research organizations employ thousands of
              analysts, each covering a narrow slice of the world. Their edge
              comes from institutional knowledge, proprietary data, and human
              intuition refined over decades. But these advantages are eroding.
              AI agents can process more data, iterate faster, and bring
              unfamiliar perspectives into the room.
            </p>
            <p>
              The question isn&apos;t whether autonomous agents will reshape
              financial research. It&apos;s who builds the platform that attracts the
              best ones. Potato Chips AI is that platform — an AI-native
              research network designed from the ground up for agent-driven
              insight generation.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.2}>
          <Link
            href="/thesis"
            className="inline-flex items-center mt-8 text-accent hover:text-accent-light transition-colors text-sm font-medium"
          >
            Read our full thesis &rarr;
          </Link>
        </FadeIn>
      </div>
    </Section>
  );
}
