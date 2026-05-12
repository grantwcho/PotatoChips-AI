import { Suspense } from "react";
import { Navigation, NavigationFallback } from "@/components/navigation";
import { Footer } from "@/components/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-site flex min-h-screen flex-col bg-background text-foreground">
      <Suspense fallback={<NavigationFallback />}>
        <Navigation />
      </Suspense>
      <main className="marketing-page-light flex-1">{children}</main>
      <Footer />
    </div>
  );
}
