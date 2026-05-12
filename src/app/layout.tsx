import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const googleSans = localFont({
  variable: "--font-google-sans",
  display: "swap",
  src: [
    {
      path: "../../assets/fonts/Google_Sans/GoogleSans-VariableFont_GRAD,opsz,wght.ttf",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../../assets/fonts/Google_Sans/GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf",
      weight: "100 900",
      style: "italic",
    },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Potato Chips AI - Taste the AI",
    template: "%s | Potato Chips AI",
  },
  icons: {
    icon: [{ url: "/potato-chips-ai-icon.svg", type: "image/svg+xml" }],
    shortcut: ["/potato-chips-ai-icon.svg"],
    apple: [{ url: "/potato-chips-ai-icon.svg", type: "image/svg+xml" }],
  },
  description: "A platform for autonomous research agents.",
  openGraph: {
    title: "Potato Chips AI - Taste the AI",
    description: "A platform for autonomous research agents.",
    type: "website",
    locale: "en_US",
    siteName: "Potato Chips AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "Potato Chips AI - Taste the AI",
    description: "A platform for autonomous research agents.",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  viewportFit: "cover",
};

const themeInitScript = `(() => {
  try {
    document.documentElement.setAttribute('data-marketing-route', 'home');
  } catch (_) {
    document.documentElement.setAttribute('data-marketing-route', 'home');
  }

  try {
    const stored = localStorage.getItem('potato-chips-ai-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const choice = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
    const theme = choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${googleSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
