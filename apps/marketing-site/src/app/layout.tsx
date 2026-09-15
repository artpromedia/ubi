import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";

import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ubi.africa"),
  title: {
    default: "UBI. Life moves. Move with UBI.",
    template: "%s | UBI",
  },
  description:
    "Explore rides, food and package delivery with UBI. Discover driver opportunities and services available in your city.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "UBI. Life moves. Move with UBI.",
    description: "Make room for more of your day. Explore UBI in your city.",
    type: "website",
    url: "/",
    siteName: "UBI",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F2EA",
};

/** JSON-LD Organization only (board 24e SEO): no AggregateRating, no counts. */
const organisation = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "UBI",
  url: "https://www.ubi.africa",
  logo: "https://www.ubi.africa/brand/ubi-logo-black.svg",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body className="min-h-screen bg-mk-canvas font-sans text-mk-ink antialiased">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisation) }}
        />
      </body>
    </html>
  );
}
