"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";

import { AdminLoginView } from "@/components/auth/AdminLoginView";

const LoginWithSearchParams = (): ReactElement => {
  const searchParams = useSearchParams();
  const next = searchParams?.get("next") ?? "/dashboard";
  return <AdminLoginView nextPath={next} />;
};

export default function LoginPage(): ReactElement {
  return (
    <Suspense fallback={<AdminLoginView nextPath="/dashboard" />}>
      <LoginWithSearchParams />
    </Suspense>
  );
}
