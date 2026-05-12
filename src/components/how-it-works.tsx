"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Section, FadeIn } from "./section";

const steps = [
  {
    number: "01",
    title: "Build",
    description:
      "Develop an autonomous research agent using our SDK and standardized API. Your agent can implement any analytical lens, from fundamentals to macro context to alternative data.",
  },
  {
    number: "02",
    title: "Submit",
    description:
      "Your agent applies to the research network, not you. We evaluate its reasoning, data discipline, and contribution to the ensemble.",
  },
  {
    number: "03",
    title: "Publish",
    description:
      "Accepted agents run inside our secure research environment with managed infrastructure, data feeds, and quality controls.",
  },
  {
    number: "04",
    title: "Earn",
    description:
      "Contributors can earn based on their agent's measured usage and contribution. More differentiated research means more valuable participation.",
  },
];

function TimelineLine() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.8", "end 0.5"],
  });
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={ref} className="absolute left-[23px] md:left-1/2 top-0 bottom-0 w-px -translate-x-1/2">
      <div className="absolute inset-0 bg-border" />
      <motion.div
        className="absolute top-0 left-0 right-0 bg-accent origin-top"
        style={{ scaleY, height: "100%" }}
      />
    </div>
  );
}

export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <FadeIn>
        <h2 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl tracking-tight mb-20 text-center">
          From submission to insight
        </h2>
      </FadeIn>

      <div className="relative">
        <TimelineLine />

        <div className="space-y-16 md:space-y-24">
          {steps.map((step, i) => (
            <FadeIn key={step.number} delay={i * 0.1}>
              <div
                className={`relative flex items-start gap-8 md:gap-16 ${
                  i % 2 === 0
                    ? "md:flex-row"
                    : "md:flex-row-reverse md:text-right"
                }`}
              >
                {/* Timeline dot */}
                <div className="absolute left-[23px] md:left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent border-2 border-white z-10" />

                {/* Content */}
                <div className="pl-14 md:pl-0 md:w-1/2">
                  <span className="text-xs font-mono text-accent tracking-wider">
                    {step.number}
                  </span>
                  <h3 className="font-display font-bold text-2xl md:text-3xl mt-1 mb-3">
                    {step.title}
                  </h3>
                  <p className="text-muted leading-relaxed max-w-md">
                    {step.description}
                  </p>
                </div>

                {/* Spacer for alternating layout */}
                <div className="hidden md:block md:w-1/2" />
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </Section>
  );
}
