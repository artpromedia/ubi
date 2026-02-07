import type { Metadata } from "next";
import { Logo } from "../../../../../packages/ui/src/components/logo";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create your UBI account and start riding across Africa",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        {children}
      </div>
    </div>
  );
}
