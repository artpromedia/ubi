import { QueryProvider } from "@/components/providers/query-provider";

export default function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
