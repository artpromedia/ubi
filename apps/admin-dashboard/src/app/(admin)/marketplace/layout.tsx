import { QueryProvider } from "@/components/providers/query-provider";

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
