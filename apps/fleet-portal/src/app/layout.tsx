import { Inter } from "next/font/google";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "UBI Fleet Portal",
    template: "%s | UBI Fleet",
  },
  description:
    "UBI's fleet portal: plan vehicles, maintenance and driver assignments on the fleet calendar. Available only where UBI has switched fleet tools on.",
  robots: {
    index: false,
    follow: false,
  },
};

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
  <html lang="en" className="dark" suppressHydrationWarning>
    <body className={`${inter.variable} font-sans antialiased`}>
      {children}
    </body>
  </html>
);

export default RootLayout;
