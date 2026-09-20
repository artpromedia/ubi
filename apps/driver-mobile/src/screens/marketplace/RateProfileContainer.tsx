// D09 container — Rates (Root screen). The example calculation is POST
// /v1/mp/rate-profiles/preview — the ONLY place profile maths happens; the client sends
// the raw inputs and renders the server rows verbatim. Saving creates a new version
// server-side; a bounds rejection (rate_profile_out_of_bounds) keeps the current version
// active and shows the server's message unedited.
import React, { useEffect, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Skeleton, Banner } from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import {
  marketplaceApi,
  type MpRatePreview,
  type MpRateProfile,
} from "../../api/marketplace";
import { RateProfileScreen } from "./RateProfileScreen";

/** Display-only server phrasings (scope, components, version lines) are PROPOSED
 * MpRateProfile additions — fixture-served until contracts carry them (see followups). */
type MpRateProfileDto = MpRateProfile & {
  scopeLabel?: string;
  componentsLine?: string;
  versionLine?: string;
};

// Input packaging only, mirroring rider-mobile's fare editor: whole-major digits → minor
// units. No arithmetic on server amounts happens here.
const majorDigits = (minor: number) => String(Math.round(minor / 100));
const toMinor = (raw: string) =>
  (parseInt(raw.replace(/\D/g, ""), 10) || 0) * 100;

export function RateProfileContainer() {
  const nav = useNavigation<{ goBack: () => void }>();
  const q = useQuery({
    queryKey: ["mp", "rateProfiles"],
    queryFn: marketplaceApi.rateProfiles,
  });
  const profile = q.data?.profiles[0] as MpRateProfileDto | undefined;
  const [rateValue, setRateValue] = useState("");
  const [minValue, setMinValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MpRatePreview | null>(null);
  // Inputs the last server preview was computed from — anything newer marks it stale.
  const previewedFor = useRef<string | null>(null);
  const seededFor = useRef<string | null>(null);
  const previewM = useMutation({
    mutationFn: (inputs: {
      perKmMinor: number;
      minimumTripFareMinor: number;
    }) =>
      marketplaceApi.ratePreview({
        cityId: profile!.cityId,
        service: profile!.service,
        vehicleClass: profile!.vehicleClass,
        perKmMinor: inputs.perKmMinor,
        minimumTripFareMinor: inputs.minimumTripFareMinor,
        exampleDistanceMeters: 10_000,
      }),
    onSuccess: (p, inputs) => {
      setPreview(p);
      previewedFor.current =
        inputs.perKmMinor + ":" + inputs.minimumTripFareMinor;
    },
  });
  const refreshPreview = (rateRaw: string, minRaw: string) =>
    previewM.mutate({
      perKmMinor: toMinor(rateRaw),
      minimumTripFareMinor: toMinor(minRaw),
    });
  // Seed the editable inputs from the server profile once per saved version, then preview it.
  useEffect(() => {
    if (!profile) return;
    const key = profile.profileId + ":v" + profile.version;
    if (seededFor.current === key) return;
    seededFor.current = key;
    const rate = majorDigits(profile.perKmMinor);
    const min = majorDigits(profile.minimumTripFareMinor);
    setRateValue(rate);
    setMinValue(min);
    refreshPreview(rate, min);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.profileId, profile?.version]);
  const save = useMutation({
    mutationFn: () =>
      marketplaceApi.saveRateProfile({
        cityId: profile!.cityId,
        service: profile!.service,
        vehicleClass: profile!.vehicleClass,
        perKmMinor: toMinor(rateValue),
        minimumTripFareMinor: toMinor(minValue),
      }),
    onSuccess: (saved) => {
      setSaveError(null);
      track("driver_mp_rates_saved", {
        profileId: saved.profileId,
        version: saved.version,
      });
      void q.refetch();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "rate_profile_out_of_bounds")
        setSaveError(e.message);
      else setSaveError((e as Error).message);
    },
  });
  if (q.isError) {
    const notConfigured =
      q.error instanceof ApiError && q.error.code === "market_not_configured";
    return (
      <Screen title="My rates" onBack={nav.goBack} bg="bg2">
        <Banner
          tone={notConfigured ? "neutral" : "error"}
          title={
            notConfigured
              ? "Not available here yet"
              : "Couldn’t load your rates"
          }
          body={(q.error as Error).message}
        />
      </Screen>
    );
  }
  if (!profile)
    return (
      <Screen title="My rates" onBack={nav.goBack} bg="bg2">
        <Skeleton height={140} />
        <Skeleton height={180} />
      </Screen>
    );
  const inputsKey = toMinor(rateValue) + ":" + toMinor(minValue);
  return (
    <RateProfileScreen
      scopeLabel={
        profile.scopeLabel ??
        profile.cityId + " · " + profile.service + " · " + profile.vehicleClass
      }
      rateValue={rateValue}
      onRate={(v) => setRateValue(v.replace(/\D/g, ""))}
      minValue={minValue}
      onMin={(v) => setMinValue(v.replace(/\D/g, ""))}
      componentsLine={profile.componentsLine ?? "Off · not configured"}
      preview={
        preview
          ? {
              stale: previewedFor.current !== inputsKey,
              rows: preview.rows,
              disclaimer: preview.disclaimer,
            }
          : null
      }
      onRefreshPreview={() => refreshPreview(rateValue, minValue)}
      saveError={saveError}
      versionLine={
        profile.versionLine ??
        "Changes apply to future calculations only — live offers and won jobs keep their agreed amounts. Currently saved as v" +
          profile.version +
          "."
      }
      saving={save.isPending}
      onSave={() => save.mutate()}
      onBack={nav.goBack}
    />
  );
}
