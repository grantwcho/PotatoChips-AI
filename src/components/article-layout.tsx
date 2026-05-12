"use client";

import { FadeIn } from "@/components/section";
import { CharacterTextReveal } from "@/components/character-text-reveal";

interface ArticleLayoutProps {
  category: string;
  title: string;
  date: string;
  children: React.ReactNode;
}

export function ArticleLayout({
  category,
  title,
  date,
  children,
}: ArticleLayoutProps) {
  return (
    <article className="pt-32 pb-24 md:pt-40 md:pb-32">
      <div className="max-w-[680px] mx-auto px-6">
        <header className="mb-16">
          <FadeIn>
            <p className="text-xs text-muted uppercase tracking-wider mb-4">
              {category}
            </p>
          </FadeIn>
          <h1 className="font-display font-bold text-3xl md:text-4xl lg:text-5xl tracking-tight leading-[1.1] mb-6">
            <CharacterTextReveal text={title} />
          </h1>
          <FadeIn delay={0.1}>
            <div className="flex items-center gap-3 text-sm text-muted">
              <span>Potato Chips AI Research</span>
              <span className="w-1 h-1 rounded-full bg-muted" />
              <span>{date}</span>
            </div>
          </FadeIn>
        </header>

        <FadeIn delay={0.1}>
          <div className="prose-gpt">{children}</div>
        </FadeIn>
      </div>
    </article>
  );
}
