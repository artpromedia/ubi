// Booking options on the fare editor (rides only) — each behind its own deny-by-default flag:
//  - ask a SAVED driver first (A04 item 3), with the rider's explicit choice of what happens if
//    they don't offer in time (open to all drivers, or close free) — never pre-selected;
//  - service needs (A06 part D): hard REQUIREMENTS can be chosen only where the server reports
//    verified supply ("Not available in this area" otherwise, with its fallback); PREFERENCES
//    only affect the order of offers;
//  - book for another ADULT (A06 part B): their name and phone, and the requester's two
//    attestations — minors are refused with plain copy;
//  - bill an ORGANIZATION (A06 part C): organization, cost centre and expense category under the
//    organization's policy, whose verdict comes from the server on the quote.
// Nothing here prices anything or decides eligibility: the server validates every input again
// and each refusal is shown in plain words by the fare editor.
import type React from "react";
import { Pressable, TextInput, View, type TextStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Banner, Card, Chip, Text, useTheme } from "@ubi/mobile-ui";
import { useFlag } from "@ubi/mobile-core";
import {
  MpPassengerInputSchema,
  ORG_BOOKER_ROLES,
  TEST_IDS,
  dynamicTestId,
  type MpPublishRequest,
  type MpServicePreference,
  type MpServiceRequirement,
} from "@ubi/contracts";
import { marketplaceApi, type MpQuoteEnvelope } from "../../api/marketplace";
import { businessApi, type OrganizationView } from "../../api/business";
import { accountApi } from "../../api/account";
import {
  BUSINESS_PAYMENT_METHOD_ID,
  WALLET_PAYMENT_LABEL,
  WALLET_PAYMENT_METHOD_ID,
} from "../../lib/payment";
import { MINORS_COPY, businessRefusal } from "./confidenceCopy";
import { BusinessVerdict } from "./BusinessParts";
import { StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider;

export type PassengerDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  isAdult: boolean;
  consentConfirmed: boolean;
};

export type PayerChoice =
  | { kind: "personal" }
  | {
      kind: "organization";
      organizationId: string;
      organizationName: string;
      costCentreId: string | null;
      costCentreName: string | null;
      expenseCategory: string;
      /** A colleague the booker books for (a member); null = the requester travels. */
      travellerId: string | null;
    };

export type BookingOptionsState = {
  preferred: { driverId: string; name: string } | null;
  /** The rider's explicit fallback choice; null until they make it. */
  fallbackToMarket: boolean | null;
  requirements: MpServiceRequirement[];
  preferences: MpServicePreference[];
  rider: "me" | "other";
  passenger: PassengerDraft;
  payer: PayerChoice;
};

export const EMPTY_BOOKING_OPTIONS: BookingOptionsState = {
  preferred: null,
  fallbackToMarket: null,
  requirements: [],
  preferences: [],
  rider: "me",
  passenger: {
    firstName: "",
    lastName: "",
    phone: "",
    isAdult: false,
    consentConfirmed: false,
  },
  payer: { kind: "personal" },
};

export type BookingOptionFlags = {
  preferred: boolean;
  needs: boolean;
  guest: boolean;
  business: boolean;
};

/** The four deny-by-default flags; hooks run unconditionally. */
export function useBookingOptionFlags(): BookingOptionFlags {
  const preferred = useFlag("marketplace_preferred_drivers");
  const needs = useFlag("marketplace_accessibility_requirements");
  const guest = useFlag("marketplace_guest_bookings");
  const business = useFlag("business_travel");
  return { preferred, needs, guest, business };
}

/**
 * The colleague a booker books for — only while "Someone else" is chosen. A colleague picked
 * earlier stays in the draft but is never sent once the rider switches back to "Me" (the server
 * would refuse a traveller without a named passenger).
 */
const travellerOf = (s: BookingOptionsState, on: BookingOptionFlags) =>
  on.guest && s.rider === "other" && s.payer.kind === "organization"
    ? s.payer.travellerId
    : null;

/** The organization query params a business quote carries (the advisory verdict). */
export function businessQuoteParams(
  s: BookingOptionsState,
  on: BookingOptionFlags,
): { organizationId?: string; costCentreId?: string; travellerId?: string } {
  if (!on.business || s.payer.kind !== "organization") return {};
  const travellerId = travellerOf(s, on);
  return {
    organizationId: s.payer.organizationId,
    ...(s.payer.costCentreId ? { costCentreId: s.payer.costCentreId } : {}),
    ...(travellerId ? { travellerId } : {}),
  };
}

/**
 * Refusal reasons that depend on the amount checked. The quote's verdict is taken at the
 * SUGGESTED fare, so for these alone it only blocks sending when the rider sends that same fare;
 * any other fare is decided by the server's own check at publish (and again at selection).
 */
const AMOUNT_DEPENDENT_REASONS: ReadonlySet<string> = new Set([
  "trip_cap_exceeded",
  "budget_insufficient",
]);

/** True when the verdict refused only for amount reasons, at a fare the rider is not sending. */
export function refusedAtOtherFareOnly(
  check: BusinessCheckState | undefined,
): boolean {
  const v = check?.check;
  return (
    v?.status === "refused" &&
    check?.checkedAtRequestedFare === false &&
    v.reasons.length > 0 &&
    v.reasons.every((r) => AMOUNT_DEPENDENT_REASONS.has(r))
  );
}

const PASSENGER_FIELD_TEXT: Record<string, string> = {
  firstName: "Enter the passenger’s first name (letters only).",
  lastName: "Family name: letters only.",
  phone:
    "Enter their mobile number with the country code, e.g. +2348012345678.",
};

/** Input checks mirroring the contract (the server decides): what still blocks sending. */
export function passengerProblems(p: PassengerDraft): string[] {
  const parsed = MpPassengerInputSchema.safeParse({
    firstName: p.firstName,
    ...(p.lastName.trim() ? { lastName: p.lastName } : {}),
    phone: p.phone.replace(/[\s-]/g, ""),
    isAdult: p.isAdult,
    consentConfirmed: p.consentConfirmed,
  });
  const out: string[] = [];
  if (!parsed.success)
    for (const key of ["firstName", "lastName", "phone"])
      if (parsed.error.issues.some((i) => i.path[0] === key))
        out.push(PASSENGER_FIELD_TEXT[key]);
  if (!p.isAdult) out.push(MINORS_COPY);
  if (!p.consentConfirmed)
    out.push(
      "Confirm they agreed to this ride and to a text from UBI with their trip link.",
    );
  return out;
}

/** The organization's advisory verdict for the chosen payer (a separate quote read). */
export type BusinessCheckState = {
  check: MpQuoteEnvelope["business"] | undefined;
  /** The check could not be answered, or was refused outright (e.g. not a booker). */
  error: unknown;
  checking: boolean;
  /**
   * Whether the verdict's checked amount is the fare the rider will send (the container
   * compares the two server/packaged amounts; nothing is computed). Absent = assume so.
   */
  checkedAtRequestedFare?: boolean;
};

export type PublishExtras = {
  body: Pick<
    MpPublishRequest,
    | "paymentMethodId"
    | "preferredDriver"
    | "serviceNeeds"
    | "passenger"
    | "business"
  >;
  /** Plain reasons the request can't be sent yet (client input checks only). */
  problems: string[];
  summary: { label: string; value: string }[];
  paymentLabel: string;
};

/** Turns the options into publish fields — only for sections whose flag is on. */
export function publishExtrasOf(
  s: BookingOptionsState,
  on: BookingOptionFlags,
  businessCheck: BusinessCheckState | undefined,
): PublishExtras {
  const problems: string[] = [];
  const summary: { label: string; value: string }[] = [];
  const body: PublishExtras["body"] = {
    paymentMethodId: WALLET_PAYMENT_METHOD_ID,
  };
  let paymentLabel = WALLET_PAYMENT_LABEL;
  if (on.preferred && s.preferred) {
    if (s.fallbackToMarket === null)
      problems.push(
        "Choose what happens if " +
          s.preferred.name +
          " doesn’t offer in time.",
      );
    else {
      body.preferredDriver = {
        driverId: s.preferred.driverId,
        fallbackToMarket: s.fallbackToMarket,
      };
      summary.push({
        label: "Asked first",
        value:
          s.preferred.name +
          (s.fallbackToMarket
            ? " · then all drivers"
            : " · closes free if they don’t offer"),
      });
    }
  }
  if (on.needs && (s.requirements.length || s.preferences.length)) {
    body.serviceNeeds = {
      ...(s.requirements.length ? { requirements: s.requirements } : {}),
      ...(s.preferences.length ? { preferences: s.preferences } : {}),
    };
    summary.push({
      label: "Service needs",
      value:
        s.requirements.length +
        " required · " +
        s.preferences.length +
        " preferred",
    });
  }
  if (on.guest && s.rider === "other") {
    const issues = passengerProblems(s.passenger);
    problems.push(...issues);
    if (!issues.length) {
      body.passenger = {
        firstName: s.passenger.firstName.trim(),
        ...(s.passenger.lastName.trim()
          ? { lastName: s.passenger.lastName.trim() }
          : {}),
        phone: s.passenger.phone.replace(/[\s-]/g, ""),
        isAdult: true,
        consentConfirmed: true,
      };
      summary.push({
        label: "Passenger",
        value: s.passenger.firstName.trim() + " · trip link by text",
      });
    }
  }
  if (on.business && s.payer.kind === "organization") {
    const travellerId = travellerOf(s, on);
    if (on.guest && s.rider === "other" && !travellerId)
      problems.push(
        "Choose which colleague is travelling — a business ride is for a member of " +
          s.payer.organizationName +
          ".",
      );
    // A refusal the server stated (on the verdict, or as the check's own refusal) blocks
    // sending; an unanswered check doesn't — the publish is decided again server-side. A
    // verdict refused only for amount reasons at a DIFFERENT fare than the one being sent
    // doesn't block either: the server checks the sent fare itself.
    if (
      (businessCheck?.check?.status === "refused" &&
        !refusedAtOtherFareOnly(businessCheck)) ||
      businessRefusal(businessCheck?.error)
    )
      problems.push(
        "This trip is outside " +
          s.payer.organizationName +
          "’s travel policy or budget — see why above, or pay personally.",
      );
    body.paymentMethodId = BUSINESS_PAYMENT_METHOD_ID;
    body.business = {
      organizationId: s.payer.organizationId,
      ...(s.payer.costCentreId ? { costCentreId: s.payer.costCentreId } : {}),
      ...(s.payer.expenseCategory.trim()
        ? { expenseCategory: s.payer.expenseCategory.trim() }
        : {}),
      ...(travellerId ? { travellerId } : {}),
    };
    paymentLabel = s.payer.organizationName + " budget";
    summary.push({
      label: "Billed to",
      value:
        s.payer.organizationName +
        (s.payer.costCentreName ? " · " + s.payer.costCentreName : ""),
    });
  }
  return { body, problems, summary, paymentLabel };
}

// ── Sections ────────────────────────────────────────────────────────────────

function Section({
  testID,
  title,
  children,
}: {
  testID: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card testID={testID} style={{ gap: 8 }}>
      <Text variant="label" tone="text3">
        {title}
      </Text>
      {children}
    </Card>
  );
}

function Check({
  testID,
  label,
  checked,
  onToggle,
}: {
  testID: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={{
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        minHeight: t.targets.min,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? t.colors.primary : t.colors.border,
          backgroundColor: checked ? t.colors.primaryTint : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? (
          <Text variant="label" tone="ok">
            ✓
          </Text>
        ) : null}
      </View>
      <Text variant="bodySm" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  testID,
  label,
  value,
  onChange,
  placeholder,
  keyboard,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: "phone-pad";
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" tone="text2">
        {label}
      </Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        keyboardType={keyboard}
        placeholderTextColor={t.colors.text3}
        style={[
          t.type.body as TextStyle,
          {
            color: t.colors.text,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.border,
            paddingVertical: 8,
          },
        ]}
      />
    </View>
  );
}

function PreferredSection({
  s,
  set,
}: {
  s: BookingOptionsState;
  set: (next: Partial<BookingOptionsState>) => void;
}) {
  const q = useQuery({
    queryKey: ["mp", "favourites"],
    queryFn: marketplaceApi.favourites,
    retry: false,
  });
  const askable = (q.data?.items ?? []).filter(
    (f) => f.state === "active" && f.canRequest,
  );
  const unavailable = (q.data?.items ?? []).filter(
    (f) => f.state === "active" && !f.canRequest,
  );
  if (q.isPending) return null;
  return (
    <Section testID={TID.preferred.section} title="Ask a saved driver first">
      {q.isError ? (
        <Text variant="caption" tone="text2">
          Your saved drivers couldn’t load — your request goes to every eligible
          driver.
        </Text>
      ) : askable.length === 0 ? (
        <Text testID={TID.preferred.unavailable} variant="caption" tone="text2">
          {unavailable.length
            ? "None of your saved drivers can be asked first right now. Your request goes to every eligible driver."
            : "No saved drivers yet. You can save a driver from a completed trip’s receipt."}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip
              testID={TID.preferred.none}
              label="Any driver"
              selected={!s.preferred}
              onPress={() => set({ preferred: null, fallbackToMarket: null })}
            />
            {askable.map((f) => {
              const name = f.driverProfile.displayName ?? f.driver.displayName;
              return (
                <Chip
                  key={f.driverId}
                  testID={dynamicTestId(TID.preferred.driver, f.driverId)}
                  label={name}
                  selected={s.preferred?.driverId === f.driverId}
                  onPress={() =>
                    set({
                      preferred: { driverId: f.driverId, name },
                      fallbackToMarket: null,
                    })
                  }
                />
              );
            })}
          </View>
          {s.preferred ? (
            <View style={{ gap: 6 }}>
              <Text testID={TID.preferred.note} variant="caption" tone="text2">
                {s.preferred.name +
                  " gets a short window to offer first, under the same fare rules as everyone. Asking first doesn’t guarantee they’re available. If they don’t offer in time:"}
              </Text>
              <Check
                testID={TID.preferred.fallbackOpen}
                label="Open my request to every eligible driver"
                checked={s.fallbackToMarket === true}
                onToggle={() => set({ fallbackToMarket: true })}
              />
              <Check
                testID={TID.preferred.fallbackExpire}
                label="Close my request, free of charge"
                checked={s.fallbackToMarket === false}
                onToggle={() => set({ fallbackToMarket: false })}
              />
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

function NeedsSection({
  s,
  set,
  vehicleClass,
}: {
  s: BookingOptionsState;
  set: (next: Partial<BookingOptionsState>) => void;
  vehicleClass: string;
}) {
  const q = useQuery({
    queryKey: ["mp", "service-needs", vehicleClass],
    queryFn: () => marketplaceApi.serviceNeeds(vehicleClass),
    retry: false,
  });
  if (q.isPending) return null;
  if (q.isError)
    return (
      <Section
        testID={TID.needs.section}
        title="Accessibility and service needs"
      >
        <Text testID={TID.needs.error} variant="caption" tone="text2">
          Service needs couldn’t load, so none can be added to this request. If
          you need an accessible vehicle, contact support before booking.
        </Text>
      </Section>
    );
  const c = q.data;
  const toggle = <T extends string>(list: T[], code: T) =>
    list.includes(code) ? list.filter((x) => x !== code) : [...list, code];
  return (
    <Section testID={TID.needs.section} title="Accessibility and service needs">
      <Text variant="caption" tone="text2">
        Requirements go only to drivers whose vehicle UBI has verified.
      </Text>
      {c.requirements.map((r) =>
        r.availability === "verified" ? (
          <Check
            key={r.code}
            testID={dynamicTestId(TID.needs.requirement, r.code)}
            label={r.title + " — required"}
            checked={s.requirements.includes(r.code)}
            onToggle={() =>
              set({ requirements: toggle(s.requirements, r.code) })
            }
          />
        ) : (
          <View
            key={r.code}
            testID={dynamicTestId(TID.needs.unavailable, r.code)}
            accessible
            accessibilityLabel={
              r.title + ". Not available in this area. " + r.detail
            }
            style={{ gap: 2 }}
          >
            <Text variant="bodySm" tone="text3">
              {r.title}
            </Text>
            <StateTag label="Not available in this area" tone="neutral" />
            <Text variant="caption" tone="text2">
              {r.detail}
            </Text>
          </View>
        ),
      )}
      {c.requirements.some((r) => r.availability !== "verified") ? (
        <Text testID={TID.needs.fallback} variant="caption" tone="text2">
          {c.fallback}
        </Text>
      ) : null}
      {c.preferences.length ? (
        <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
          Preferences change the order of offers only — they never exclude a
          driver or guarantee a vehicle.
        </Text>
      ) : null}
      {c.preferences.map((p) => (
        <Check
          key={p.code}
          testID={dynamicTestId(TID.needs.preference, p.code)}
          label={p.title + " — preferred"}
          checked={s.preferences.includes(p.code)}
          onToggle={() => set({ preferences: toggle(s.preferences, p.code) })}
        />
      ))}
      <Text testID={TID.needs.disclosure} variant="caption" tone="text3">
        {c.disclosure}
      </Text>
    </Section>
  );
}

function GuestSection({
  s,
  set,
  showErrors,
}: {
  s: BookingOptionsState;
  set: (next: Partial<BookingOptionsState>) => void;
  showErrors: boolean;
}) {
  const p = s.passenger;
  const setP = (next: Partial<PassengerDraft>) =>
    set({ passenger: { ...p, ...next } });
  const problems = s.rider === "other" ? passengerProblems(p) : [];
  return (
    <Section testID={TID.guest.section} title="Who’s riding?">
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip
          testID={TID.guest.forMe}
          label="Me"
          selected={s.rider === "me"}
          onPress={() => set({ rider: "me" })}
        />
        <Chip
          testID={TID.guest.forOther}
          label="Someone else (an adult)"
          selected={s.rider === "other"}
          onPress={() => set({ rider: "other" })}
        />
      </View>
      {s.rider === "other" ? (
        <View style={{ gap: 8 }}>
          <Text variant="caption" tone="text2">
            UBI texts them a private trip link with the driver, live status and
            their pickup PIN. They can decline for free before pickup. You stay
            the one who books and cancels.
          </Text>
          <Field
            testID={TID.guest.firstName}
            label="Their first name"
            value={p.firstName}
            onChange={(v) => setP({ firstName: v })}
          />
          <Field
            testID={TID.guest.lastName}
            label="Family name (optional)"
            value={p.lastName}
            onChange={(v) => setP({ lastName: v })}
          />
          <Field
            testID={TID.guest.phone}
            label="Their mobile number"
            value={p.phone}
            onChange={(v) => setP({ phone: v })}
            placeholder="+2348012345678"
            keyboard="phone-pad"
          />
          <Check
            testID={TID.guest.adult}
            label="They are 18 or older"
            checked={p.isAdult}
            onToggle={() => setP({ isAdult: !p.isAdult })}
          />
          <Check
            testID={TID.guest.consent}
            label="They agreed to this ride and to a text from UBI with their trip link"
            checked={p.consentConfirmed}
            onToggle={() => setP({ consentConfirmed: !p.consentConfirmed })}
          />
          <Text testID={TID.guest.minors} variant="caption" tone="text2">
            {MINORS_COPY}
          </Text>
          {showErrors && problems.length ? (
            <View testID={TID.guest.fieldError} style={{ gap: 2 }}>
              {problems.map((m) => (
                <Text key={m} variant="caption" tone="errorInk">
                  {m}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Section>
  );
}

function BusinessSection({
  s,
  set,
  check,
}: {
  s: BookingOptionsState;
  set: (next: Partial<BookingOptionsState>) => void;
  check: BusinessCheckState | undefined;
}) {
  const orgsQ = useQuery({
    queryKey: ["business", "organizations"],
    queryFn: businessApi.organizations,
    retry: false,
  });
  const payer = s.payer;
  const orgId = payer.kind === "organization" ? payer.organizationId : null;
  const org: OrganizationView | undefined = (orgsQ.data ?? []).find(
    (o) => o.id === orgId,
  );
  const costQ = useQuery({
    queryKey: ["business", "cost-centres", orgId],
    queryFn: () => businessApi.costCentres(orgId as string),
    enabled: !!orgId,
    retry: false,
  });
  const canBookOthers =
    !!org && (ORG_BOOKER_ROLES as readonly string[]).includes(org.myRole);
  const needTraveller = !!org && s.rider === "other" && canBookOthers;
  const membersQ = useQuery({
    queryKey: ["business", "members", orgId],
    queryFn: () => businessApi.members(orgId as string),
    enabled: needTraveller,
    retry: false,
  });
  const meQ = useQuery({
    queryKey: ["account", "me"],
    queryFn: accountApi.me,
    enabled: needTraveller,
    retry: false,
  });
  const active = (orgsQ.data ?? []).filter((o) => o.status === "active");
  if (orgsQ.isPending || (!orgsQ.isError && active.length === 0)) return null;
  const setPayer = (next: PayerChoice) => set({ payer: next });
  return (
    <Section testID={TID.business.section} title="Pay with">
      {orgsQ.isError ? (
        <Text testID={TID.business.error} variant="caption" tone="text2">
          Your organizations couldn’t load — this ride is paid personally.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip
              testID={TID.business.personal}
              label={WALLET_PAYMENT_LABEL}
              selected={payer.kind === "personal"}
              onPress={() => setPayer({ kind: "personal" })}
            />
            {active.map((o) => (
              <Chip
                key={o.id}
                testID={dynamicTestId(TID.business.organization, o.id)}
                label={o.name}
                selected={orgId === o.id}
                onPress={() =>
                  setPayer({
                    kind: "organization",
                    organizationId: o.id,
                    organizationName: o.name,
                    costCentreId: null,
                    costCentreName: null,
                    expenseCategory: "",
                    travellerId: null,
                  })
                }
              />
            ))}
          </View>
          {payer.kind === "organization" ? (
            <View style={{ gap: 8 }}>
              <Text variant="caption" tone="text2">
                {"The ride is paid from " +
                  payer.organizationName +
                  "’s budget, never your wallet. The budget is reserved only when you choose an offer — and the policy is checked again then."}
              </Text>
              {costQ.isError ? (
                <Text variant="caption" tone="text2">
                  Cost centres couldn’t load — your default cost centre is used.
                </Text>
              ) : (
                <View
                  style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                >
                  <Chip
                    testID={dynamicTestId(TID.business.costCentre, "default")}
                    label="My default cost centre"
                    selected={!payer.costCentreId}
                    onPress={() =>
                      setPayer({
                        ...payer,
                        costCentreId: null,
                        costCentreName: null,
                      })
                    }
                  />
                  {(costQ.data ?? [])
                    .filter((c) => c.status === "active")
                    .map((c) => (
                      <Chip
                        key={c.costCentreId}
                        testID={dynamicTestId(
                          TID.business.costCentre,
                          c.costCentreId,
                        )}
                        label={c.code + " · " + c.name}
                        selected={payer.costCentreId === c.costCentreId}
                        onPress={() =>
                          setPayer({
                            ...payer,
                            costCentreId: c.costCentreId,
                            costCentreName: c.name,
                          })
                        }
                      />
                    ))}
                </View>
              )}
              <Field
                testID={TID.business.category}
                label="Expense category (optional)"
                value={payer.expenseCategory}
                onChange={(v) =>
                  setPayer({ ...payer, expenseCategory: v.slice(0, 64) })
                }
                placeholder="e.g. Client visit"
              />
              {s.rider === "other" && org && !canBookOthers ? (
                <Banner
                  testID={TID.business.roleNote}
                  tone="warn"
                  body={
                    "Your role in " +
                    org.name +
                    " lets you book business rides for yourself only. Pay personally to book for someone else."
                  }
                />
              ) : null}
              {needTraveller ? (
                <View style={{ gap: 6 }}>
                  <Text variant="caption" tone="text2">
                    Who from {org?.name} is travelling?
                  </Text>
                  <View
                    style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                  >
                    {(membersQ.data ?? [])
                      .filter(
                        (m) =>
                          m.status === "active" &&
                          !!m.displayName &&
                          m.userId !== meQ.data?.id,
                      )
                      .map((m) => (
                        <Chip
                          key={m.userId}
                          testID={dynamicTestId(
                            TID.business.traveller,
                            m.userId,
                          )}
                          label={m.displayName}
                          selected={payer.travellerId === m.userId}
                          onPress={() => {
                            const [first, ...rest] = m.displayName.split(" ");
                            set({
                              payer: { ...payer, travellerId: m.userId },
                              passenger: {
                                ...s.passenger,
                                firstName: s.passenger.firstName || first,
                                lastName:
                                  s.passenger.lastName || rest.join(" "),
                              },
                            });
                          }}
                        />
                      ))}
                  </View>
                </View>
              ) : null}
              {check?.checking ? (
                <Text variant="caption" tone="text2">
                  Checking {payer.organizationName}’s travel policy…
                </Text>
              ) : check?.check ? (
                <BusinessVerdict
                  check={check.check}
                  organizationName={payer.organizationName}
                  atOtherFare={refusedAtOtherFareOnly(check)}
                />
              ) : check?.error ? (
                <View testID={TID.business.verdict} style={{ gap: 4 }}>
                  <StateTag
                    label={
                      businessRefusal(check.error)
                        ? "Not bookable on " + payer.organizationName
                        : "Policy check unavailable"
                    }
                    tone={businessRefusal(check.error) ? "error" : "warn"}
                  />
                  <Text variant="caption" tone="text2">
                    {businessRefusal(check.error)?.body ??
                      "The policy couldn’t be checked right now. It is checked again when you send the request."}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function BookingOptions({
  state,
  onChange,
  vehicleClass,
  flags,
  businessCheck,
  showErrors,
}: {
  state: BookingOptionsState;
  onChange: (next: BookingOptionsState) => void;
  vehicleClass: string;
  flags: BookingOptionFlags;
  businessCheck: BusinessCheckState | undefined;
  showErrors: boolean;
}) {
  const set = (next: Partial<BookingOptionsState>) =>
    onChange({ ...state, ...next });
  if (!flags.preferred && !flags.needs && !flags.guest && !flags.business)
    return null;
  return (
    <View style={{ gap: 12 }}>
      {flags.guest ? (
        <GuestSection s={state} set={set} showErrors={showErrors} />
      ) : null}
      {flags.business ? (
        <BusinessSection s={state} set={set} check={businessCheck} />
      ) : null}
      {flags.preferred ? <PreferredSection s={state} set={set} /> : null}
      {flags.needs ? (
        <NeedsSection s={state} set={set} vehicleClass={vehicleClass} />
      ) : null}
    </View>
  );
}
