import { QueryProvider } from "@/components/providers/query-provider";

export default function GrowthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
