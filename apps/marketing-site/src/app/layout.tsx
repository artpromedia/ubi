import type { Metadata } from "next";
import "@/styles/globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.ubi.africa"),
  title: "UBI — Life moves. Move with UBI.",
  description:
    "Explore rides, food and package delivery with UBI. Discover driver opportunities and services available in your city.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "UBI — Life moves. Move with UBI.",
    description: "Make room for more of your day. Explore UBI in your city.",
    type: "website",
    url: "/",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
