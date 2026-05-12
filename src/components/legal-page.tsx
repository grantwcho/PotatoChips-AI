import type { ReactNode } from "react";
import { CharacterTextReveal } from "@/components/character-text-reveal";

type LegalSection = {
  title: string;
  body: ReactNode;
};

type LegalPageProps = {
  title: string;
  description?: ReactNode;
  sections: LegalSection[];
};

export function LegalPage({ title, description, sections }: LegalPageProps) {
  return (
    <div className="marketing-page-light">
      <section className="pt-32 pb-12 lg:pt-36 lg:pb-16">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div
              className={
                description
                  ? "grid gap-10 lg:grid-cols-[minmax(0,0.6fr)_minmax(20rem,0.4fr)] lg:items-start"
                  : ""
              }
            >
              <div>
                <h1 className="max-w-5xl font-display text-[clamp(2.45rem,5.3vw,4.55rem)] leading-[0.95] tracking-[-0.05em] text-balance">
                  <CharacterTextReveal text={title} />
                </h1>
              </div>

              {description ? (
                <div className="marketing-fade-up marketing-fade-up-delay-2 max-w-xl pt-3 text-[1.04rem] leading-[1.86] text-black/78 lg:pt-16 lg:text-[1.12rem]">
                  {description}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="pt-2 pb-20 lg:pt-4 lg:pb-24">
        <div className="marketing-container">
          <div className="marketing-rail space-y-16 lg:space-y-20">
            {sections.map((section) => (
              <section
                key={section.title}
                className="grid gap-6 lg:grid-cols-[minmax(16rem,0.33fr)_minmax(0,0.67fr)] lg:gap-16 lg:items-start"
              >
                <div>
                  <h2 className="font-display text-[clamp(1.85rem,2.35vw,2.75rem)] leading-[0.98] tracking-[-0.04em] text-black">
                    {section.title}
                  </h2>
                </div>
                <div className="max-w-[46rem] space-y-6 text-[1.04rem] leading-[1.86] text-black/80 lg:text-[1.12rem]">
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
