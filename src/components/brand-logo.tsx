type BrandLogoProps = {
  variant: "adaptive" | "black" | "white";
  alt?: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

const BRAND_NAME = "Potato Chips AI";

function BrandWordmark({
  alt,
  className,
  toneClass,
}: {
  alt: string;
  className?: string;
  toneClass: string;
}) {
  return (
    <span
      aria-label={alt}
      className={`inline-flex items-baseline whitespace-nowrap font-google-sans text-[clamp(1.35rem,4.7vw,2rem)] font-semibold leading-none tracking-normal ${toneClass} ${className ?? ""}`}
    >
      {BRAND_NAME}
    </span>
  );
}

export function BrandLogo({
  variant,
  alt = BRAND_NAME,
  className,
  priority = false,
  sizes = "(max-width: 768px) 176px, 240px",
}: BrandLogoProps) {
  void priority;
  void sizes;

  if (variant === "adaptive") {
    return (
      <>
        <BrandWordmark
          alt={alt}
          className={`${className ?? ""} dark:hidden`}
          toneClass="text-black"
        />
        <BrandWordmark
          alt={alt}
          className={`${className ?? ""} hidden dark:block`}
          toneClass="text-white"
        />
      </>
    );
  }

  return (
    <BrandWordmark
      alt={alt}
      className={className}
      toneClass={variant === "white" ? "text-white" : "text-black"}
    />
  );
}
