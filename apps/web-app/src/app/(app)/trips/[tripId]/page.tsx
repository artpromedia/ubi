import { HandoffBanner, HandoffFallbackNote } from "@/components/travel/HandoffBanner";
import { TripItems } from "./trip-items";

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Board 23f (mobile web) — booking management from an SMS link; rides need the app (live tracking) and say so; everything else works here. */
export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ ref?: string | string[]; c?: string | string[] }>;
}) {
  const { tripId } = await params;
  const sp = await searchParams;
  const referralCode = one(sp.ref);
  const campaign = one(sp.c);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-[#F5F5F5]">
      <HandoffBanner tripId={tripId} referralCode={referralCode} campaign={campaign} />
      <main className="flex-1 space-y-2.5 p-4">
        <TripItems tripId={tripId} />
      </main>
      <HandoffFallbackNote referralCode={referralCode} campaign={campaign} />
    </div>
  );
}
