import Link from "next/link";

interface CardProps {
  category: string;
  title: string;
  date: string;
  href: string;
}

export function Card({ category, title, date, href }: CardProps) {
  return (
    <Link href={href} className="group block">
      <article className="py-6 border-t border-border">
        <p className="text-xs text-muted uppercase tracking-wider mb-2">
          {category}
        </p>
        <h3 className="text-lg font-semibold font-display mb-2 group-hover:text-accent transition-colors duration-200">
          {title}
        </h3>
        <div className="flex items-center justify-between">
          <time className="text-sm text-muted">{date}</time>
          <span className="text-sm text-accent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Read &rarr;
          </span>
        </div>
      </article>
    </Link>
  );
}
