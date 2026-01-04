import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";

const geistSans = localFont({
  src: "../../../../packages/ui/fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "../../../../packages/ui/fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    template: "%s | UBI Send - Merchant Portal",
    default: "UBI Send - Merchant Portal",
  },
  description:
    "Manage your deliveries, track shipments, and grow your business with UBI Send.",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#10AEBA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-white`}
      >
        {children}
      </body>
    </html>
  );
}
