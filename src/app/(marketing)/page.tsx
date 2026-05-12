import type { Viewport } from "next";
import { Hero } from "@/components/hero";

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function Home() {
  return (
    <div className="marketing-page-home">
      <Hero />
    </div>
  );
}
