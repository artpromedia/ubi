import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

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
      <body className="font-sans antialiased bg-background text-white">
        {children}
      </body>
    </html>
  );
}
