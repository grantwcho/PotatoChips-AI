import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CharacterTextReveal } from "@/components/character-text-reveal";
import {
  getStockCoverageEntry,
  getStockCoverageUniverse,
  getStockResearchArticle,
} from "@/lib/stocks/coverage-data";

function formatArticleDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export async function generateStaticParams() {
  const params = getStockCoverageUniverse().flatMap((entry) =>
    (entry.researchProgram?.publishedResearch ?? []).map((article) => ({
      symbol: entry.symbol.toLowerCase(),
      slug: article.slug,
    }))
  );

  return params.length > 0
    ? params
    : [{ symbol: "__placeholder__", slug: "__placeholder__" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string; slug: string }>;
}): Promise<Metadata> {
  const { symbol, slug } = await params;
  const profile = getStockCoverageEntry(symbol);
  const article = getStockResearchArticle(symbol, slug);

  if (!profile || !article) {
    return { title: "Stock Research" };
  }

  return {
    title: `${article.title} | ${profile.companyName} Research`,
    description: article.dek,
  };
}

export default async function StockResearchArticlePage({
  params,
}: {
  params: Promise<{ symbol: string; slug: string }>;
}) {
  const { symbol, slug } = await params;
  const profile = getStockCoverageEntry(symbol);
  const article = getStockResearchArticle(symbol, slug);

  if (!profile || !article) {
    notFound();
  }

  return (
    <div className="marketing-page-light" style={{ backgroundColor: "#ffffff" }}>
      <section className="pt-40 pb-24 lg:pt-44 lg:pb-32">
        <div className="marketing-container">
          <div className="marketing-rail">
            <div className="mx-auto max-w-[78rem]">
              <header className="mx-auto max-w-[58rem] text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/42">
                  {article.category}
                </p>
                <h1 className="mx-auto mt-6 max-w-[14ch] font-display text-[clamp(2.2rem,3.7vw,4rem)] leading-[0.99] tracking-[-0.045em] text-balance text-black">
                  <CharacterTextReveal text={article.title} />
                </h1>
                <p className="mx-auto mt-8 max-w-[42rem] text-[1.08rem] leading-[1.95] text-black/68">
                  {article.dek}
                </p>

                <div className="mx-auto mt-10 max-w-[46rem] pt-6">
                  <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-5 text-sm text-black/72 lg:gap-x-12">
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Published
                      </p>
                      <p className="mt-2 text-black">{formatArticleDate(article.publishedAt)}</p>
                    </div>
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Report Type
                      </p>
                      <p className="mt-2 text-black">{article.briefType}</p>
                    </div>
                    <div className="min-w-[8rem]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/42">
                        Company
                      </p>
                      <p className="mt-2 text-black">
                        {profile.companyName} ({profile.symbol})
                      </p>
                    </div>
                  </div>
                </div>
              </header>

              <article className="mx-auto mt-20 min-w-0 max-w-[42rem] pt-12 lg:mt-24 lg:max-w-[44rem] lg:pt-14">
                <div className="space-y-16 lg:space-y-20">
                  {article.sections.map((section) => (
                    <section key={section.heading}>
                      <h2 className="max-w-[16ch] font-display text-[clamp(1.75rem,2.45vw,2.65rem)] leading-[1.02] tracking-[-0.04em] text-black">
                        {section.heading}
                      </h2>
                      <div className="mt-7 space-y-7 text-[1.06rem] leading-[1.95] text-black/74 lg:text-[1.08rem]">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
