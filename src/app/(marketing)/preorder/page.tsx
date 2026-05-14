import type { Metadata } from "next";
import { Suspense } from "react";
import { PreorderProductPage } from "@/components/preorder-product-page";

export const metadata: Metadata = {
  title: "Pre-order",
  description: "Pre-order the Potato Chips AI bag.",
};

function PreorderProductFallback() {
  return (
    <section className="marketing-preorder-page marketing-page-light min-h-[48rem] bg-[#f7f7f7]" />
  );
}

export default function PreorderPage() {
  return (
    <Suspense fallback={<PreorderProductFallback />}>
      <PreorderProductPage />
    </Suspense>
  );
}
