import Image, { type StaticImageData } from "next/image";

import logoTextBlack from "../../assets/logos/logo_text_black.png";
import logoTextWhite from "../../assets/logos/logo_text_white.png";

type BrandLogoProps = {
  variant: "adaptive" | "black" | "white";
  alt?: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

const BRAND_NAME = "Potato Chips AI";

function BrandWordmarkImage({
  alt,
  className,
  priority,
  sizes,
  src,
}: {
  alt: string;
  className?: string;
  priority: boolean;
  sizes: string;
  src: StaticImageData;
}) {
  return (
    <Image
      alt={alt}
      className={`block h-auto ${className ?? ""}`}
      preload={priority}
      sizes={sizes}
      src={src}
    />
  );
}

export function BrandLogo({
  variant,
  alt = BRAND_NAME,
  className,
  priority = false,
  sizes = "(max-width: 768px) 176px, 240px",
}: BrandLogoProps) {
  if (variant === "adaptive") {
    return (
      <>
        <BrandWordmarkImage
          alt={alt}
          className={`${className ?? ""} dark:hidden`}
          priority={priority}
          sizes={sizes}
          src={logoTextBlack}
        />
        <BrandWordmarkImage
          alt={alt}
          className={`${className ?? ""} hidden dark:block`}
          priority={priority}
          sizes={sizes}
          src={logoTextWhite}
        />
      </>
    );
  }

  return (
    <BrandWordmarkImage
      alt={alt}
      className={className}
      priority={priority}
      sizes={sizes}
      src={variant === "white" ? logoTextWhite : logoTextBlack}
    />
  );
}
