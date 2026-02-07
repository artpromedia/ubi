"use client";

import { useDriverStore } from "@/store/driver-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isOnboarded } = useDriverStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/auth/login");
    } else if (isOnboarded) {
      router.replace("/dashboard");
    } else {
      router.replace("/onboarding");
    }
  }, [isAuthenticated, isOnboarded, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ubi-black">
      <div className="flex flex-col items-center gap-4">
        <UBILogo />
        <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

function UBILogo() {
  return (
    <svg
      width="120"
      height="60"
      viewBox="0 0 120 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-14 w-auto"
    >
      {/* U - sitting lower */}
      <path
        d="M8 18 L8 42 Q8 54 20 54 Q32 54 32 42 L32 18"
        stroke="#FFFFFF"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      {/* b - bounced up */}
      <path
        d="M46 4 L46 44 M46 26 Q46 18 56 18 Q68 18 68 31 Q68 44 56 44 Q46 44 46 36"
        stroke="#FFFFFF"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* i */}
      <line
        x1="84"
        y1="24"
        x2="84"
        y2="52"
        stroke="#FFFFFF"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Green dot */}
      <circle cx="84" cy="12" r="6" fill="#1DB954" />
    </svg>
  );
}
