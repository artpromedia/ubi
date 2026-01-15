import { Inter } from "next/font/google";

import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ubi.africa"),
  title: {
    default: "UBI - Africa's Mobility Super-App",
    template: "%s | UBI",
  },
  description:
    "UBI is Africa's leading mobility super-app. Book rides, order food, and send packages across Nigeria, Kenya, South Africa, Ghana, Rwanda, and more.",
  keywords: [
    "UBI",
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
    "super-app",
    "Uber alternative Africa",
    "Bolt alternative",
  ],
  authors: [{ name: "UBI Africa" }],
  creator: "UBI Africa",
  publisher: "UBI Africa",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.ubi.africa",
    siteName: "UBI",
    title: "UBI - Africa's Mobility Super-App",
    description:
      "Book rides, order food, and send packages across Africa with UBI.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "UBI - Africa's Mobility Super-App",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "UBI - Africa's Mobility Super-App",
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
  alternates: {
    canonical: "https://www.ubi.africa",
    languages: {
      en: "https://www.ubi.africa/en",
      fr: "https://www.ubi.africa/fr",
      sw: "https://www.ubi.africa/sw",
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191414" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
