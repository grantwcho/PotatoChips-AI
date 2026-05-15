import type { Viewport } from "next";
import { Hero } from "@/components/hero";

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function Home() {
  return (
    <>
      <link
        as="image"
        fetchPriority="high"
        href="/videos/merged-poster.jpg"
        rel="preload"
      />
      <link
        as="video"
        href="/videos/merged.mp4"
        rel="preload"
        type="video/mp4"
      />
      <div className="marketing-page-home">
        <Hero />
      </div>
    </>
  );
}
