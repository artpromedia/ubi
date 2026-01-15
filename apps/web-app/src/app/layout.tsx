import "@/styles/globals.css";
import { Inter } from "next/font/google";

import type { Metadata, Viewport } from "next";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "UBI - Your Ride, Your Way",
    template: "%s | UBI",
  },
  description:
    "Book rides, order food, and send packages across Africa with UBI - the mobility super-app designed for you.",
  keywords: [
    "ride-hailing",
    "food delivery",
    "package delivery",
    "mobility",
    "Africa",
    "Nigeria",
    "Kenya",
    "South Africa",
    "Ghana",
    "Rwanda",
    "Ethiopia",
  ],
  authors: [{ name: "UBI Africa" }],
  creator: "UBI Africa",
  publisher: "UBI Africa",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://app.ubi.africa",
  ),
  alternates: {
    canonical: "/",
    languages: {
      en: "/en",
      sw: "/sw",
      zu: "/zu",
      ha: "/ha",
      am: "/am",
      fr: "/fr",
      pt: "/pt",
    },
  },
  openGraph: {
    title: "UBI - Your Ride, Your Way",
    description:
      "Book rides, order food, and send packages across Africa with UBI.",
    url: "https://app.ubi.africa",
    siteName: "UBI",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "UBI - African Mobility Super-App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "UBI - Your Ride, Your Way",
    description:
      "Book rides, order food, and send packages across Africa with UBI.",
    images: ["/og-image.png"],
    creator: "@ubi_africa",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* Skip to main content for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
        >
          Skip to main content
        </a>

        {/* Main content */}
        {children}
      </body>
    </html>
  );
}
