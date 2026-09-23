// Design handoff R04 + R07 (handoff-marketplace/rn/rider/OfferInboxScreen.tsx), adapted for repo
// imports and contracts TEST_IDS, and extended for A06 part A offer comparison: every offer shows
// the SERVER's total, pickup estimate, verified driver card (or "details unavailable"), rating with
// its count as served, defined reliability, service fit and reasoned badges; sorting is a request
// to the server (`?sort=`), never a client ranking.
import type React from "react";
import { View, FlatList, Pressable } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Chip,
  Banner,
  StatusPill,
  Skeleton,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId, type MpOfferSort } from "@ubi/contracts";
import type { OfferDriverCard, ReliabilityLine } from "./offerView";
import { StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider;

/** R04 + R07. List order is STABLE across updates (a new server order applies on an explicit sort only). */
export type Offer = {
  bidId: string;
  bidVersion: number; // server
  /** What the rider pays for this offer — the server's total (or the offered fare from older servers). */
  payableMinor: Money;
  /** Server-phrased "You pay …" and what it includes (absent from older servers). */
  totalLabel: string | null;
  totalNote: string | null;
  deltaLabel: string | null; // e.g. "+₦200" (server-phrased)
  kind: "immediate" | "finishing_trip"; // R09 branch
  driver: OfferDriverCard;
  vehicleLine: string;
  pickupLabel: string; // the server's pickup ESTIMATE label
  reliability: ReliabilityLine | null;
  fitLabel: string | null;
  /** The server's "a driver you saved" criterion, when it holds (never a client guess). */
  savedLabel: string | null;
  badges: { code: string; label: string }[];
  expiresLabel: string;
  withdrawn: boolean;
};

export type OfferOrderView = {
  sort: MpOfferSort;
  options: { key: MpOfferSort; chip: string; label: string }[];
  /** The order the list is in, its tie-breaks and the no-default-winner note — server words. */
  label: string;
  tieBreak: string | null;
  note: string | null;
  /** True while the server has not yet answered the newly chosen sort. */
  pending: boolean;
};

export type OfferInboxProps = {
  phase: "searching" | "offers" | "no_offers" | "winner_unavailable";
  connection: "online" | "reconnecting";
  requestedMinor: Money;
  elapsedLabel: string;
  expiresLabel: string;
  envelopeLabel: string; // "Eligible drivers within 3 km can see your request"
  widenedBanner: string | null; // R09 expansion, preserves existing bids
  order: OfferOrderView;
  onSort: (s: MpOfferSort) => void;
  offers: Offer[];
  onOpenOffer: (bidId: string) => void;
  unavailableNotice: string | null; // R07b, includes release confirmation copy
  onCancel: () => void;
  onRepost: (kind: "suggested" | "same_wider") => void;
  /** A02: the exact multi-stop route these offers are for (absent for a plain route). */
  routeContext?: { title: string; line: string; detail: string } | null;
  /** A02 pre-award route edit (open ride requests, marketplace_multi_stop on). */
  onEditRoute?: (() => void) | null;
  /** A04 item 3: the saved driver asked first — the window, and what happens after it. */
  preferred?: { title: string; body: string; tone: "info" | "warn" } | null;
  /** Why a closed request ended, when the server said (e.g. the preferred driver lapsed). */
  closedOutcome?: { title: string; body: string } | null;
  /** A06 part B / C panels (passenger trip link, organization billing) rendered above the list. */
  panels?: React.ReactNode;
};

function OfferCard({ o, onOpen }: { o: Offer; onOpen: () => void }) {
  const t = useTheme();
  const d = o.driver;
  const summary = [
    d.name,
    d.statusLabel,
    o.totalLabel ?? "Offer",
    d.ratingLabel,
    d.tripsLabel,
    o.reliability?.label,
    o.pickupLabel,
    o.withdrawn ? "Withdrawn" : null,
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <Pressable
      testID={dynamicTestId(TID.offers.card, o.bidId)}
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityState={{ disabled: o.withdrawn }}
      disabled={o.withdrawn}
      onPress={onOpen}
    >
      <Card
        style={{ marginBottom: 12, gap: 6, opacity: o.withdrawn ? 0.6 : 1 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor:
                o.kind === "finishing_trip"
                  ? t.colors.travelTint
                  : t.colors.primaryTint,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="bodyStrong">{d.initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              variant="bodyStrong"
              style={
                o.withdrawn ? { textDecorationLine: "line-through" } : null
              }
            >
              {d.name}
            </Text>
            <StateTag
              testID={dynamicTestId(TID.offerCard.driverStatus, o.bidId)}
              label={d.statusLabel}
              tone={
                d.status === "verified"
                  ? "ok"
                  : d.status === "not_verified"
                    ? "warn"
                    : "neutral"
              }
            />
          </View>
          <View
            testID={dynamicTestId(TID.offerCard.total, o.bidId)}
            style={{ alignItems: "flex-end", gap: 2 }}
          >
            <MoneyText money={o.payableMinor} variant="title" />
            {o.withdrawn ? (
              <StatusPill status="cancelled" suffix="withdrawn" />
            ) : o.kind === "finishing_trip" ? (
              <StatusPill status="scheduled" suffix="finishing a trip" />
            ) : o.deltaLabel ? (
              <Text variant="label" tone="warnInk">
                {o.deltaLabel}
              </Text>
            ) : null}
          </View>
        </View>
        {o.totalNote ? (
          <Text variant="caption" tone="text3">
            {o.totalNote}
          </Text>
        ) : null}
        <Text
          testID={dynamicTestId(TID.offerCard.rating, o.bidId)}
          variant="caption"
          tone="text2"
        >
          {d.ratingLabel}
          {d.tripsLabel ? " · " + d.tripsLabel : ""}
        </Text>
        <Text
          testID={dynamicTestId(TID.offerCard.vehicle, o.bidId)}
          variant="caption"
          tone="text2"
        >
          {o.vehicleLine}
          {d.plateMasked ? " · " + d.plateMasked : ""}
        </Text>
        {o.reliability ? (
          <View testID={dynamicTestId(TID.offerCard.reliability, o.bidId)}>
            <Text variant="caption" tone="text2">
              {"Reliability: " + o.reliability.label}
            </Text>
            {o.reliability.basis ? (
              <Text variant="caption" tone="text3">
                {o.reliability.basis}
              </Text>
            ) : null}
          </View>
        ) : null}
        {o.fitLabel ? (
          <Text
            testID={dynamicTestId(TID.offerCard.fit, o.bidId)}
            variant="caption"
            tone="text2"
          >
            {o.fitLabel}
          </Text>
        ) : null}
        {o.savedLabel ? <StateTag label={o.savedLabel} tone="info" /> : null}
        {o.badges.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {o.badges.map((b) => (
              <StateTag
                key={b.code}
                testID={dynamicTestId(
                  TID.offerCard.badge,
                  o.bidId + "." + b.code,
                )}
                label={b.label}
                tone="info"
              />
            ))}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          <Text
            testID={dynamicTestId(TID.offerCard.pickup, o.bidId)}
            variant="caption"
            tone="text2"
            style={{ flex: 1 }}
          >
            {o.pickupLabel}
          </Text>
          <Text variant="caption" tone="text3" tabular>
            expires {o.expiresLabel}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export function OfferInboxScreen(p: OfferInboxProps) {
  if (p.phase === "no_offers") {
    return (
      <Screen title={p.closedOutcome ? p.closedOutcome.title : "No offers yet"}>
        {p.closedOutcome ? (
          <Banner
            testID={TID.offers.preferredOutcome}
            tone="neutral"
            body={p.closedOutcome.body}
          />
        ) : (
          <Text variant="body" tone="text2">
            Your request expired without offers. A fare closer to the suggestion
            usually gets answers faster.
          </Text>
        )}
        <Button
          testID={TID.offers.repost}
          label="Repost at suggested fare"
          onPress={() => p.onRepost("suggested")}
        />
        <Button
          label="Repost same fare · wider search"
          kind="secondary"
          onPress={() => p.onRepost("same_wider")}
        />
      </Screen>
    );
  }
  const header = (
    <View style={{ gap: 12 }}>
      {p.connection === "reconnecting" ? (
        <Banner
          tone="neutral"
          body="Showing your last synced offers. Choosing a driver resumes when you're back online — offers are re-checked first."
        />
      ) : null}
      {p.unavailableNotice ? (
        <Banner tone="error" title="Choose again" body={p.unavailableNotice} />
      ) : null}
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="text2">
            You asked
          </Text>
          <MoneyText money={p.requestedMinor} variant="title" />
        </View>
        <View>
          <Text variant="caption" tone="text2">
            Elapsed {p.elapsedLabel}
          </Text>
        </View>
      </Card>
      {p.preferred ? (
        <Banner
          testID={TID.offers.preferred}
          tone={p.preferred.tone}
          title={p.preferred.title}
          body={p.preferred.body}
        />
      ) : null}
      {p.panels}
      {p.routeContext ? (
        <Card
          testID={TID.offersRoute.context}
          accessible
          accessibilityLabel={
            p.routeContext.title +
            ". " +
            p.routeContext.line +
            ". " +
            p.routeContext.detail
          }
          style={{ gap: 4 }}
        >
          <Text variant="bodySmStrong">{p.routeContext.title}</Text>
          <Text variant="caption" tone="text2">
            {p.routeContext.line}
          </Text>
          <Text variant="caption" tone="text3">
            {p.routeContext.detail}
          </Text>
        </Card>
      ) : null}
      {p.onEditRoute ? (
        <Button
          testID={TID.offersRoute.editRoute}
          label="Edit stops · drivers re-offer"
          kind="secondary"
          size="md"
          onPress={p.onEditRoute}
        />
      ) : null}
      {p.phase === "offers" || p.phase === "winner_unavailable" ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {p.order.options.map((o) => (
              <Chip
                key={o.key}
                testID={dynamicTestId(TID.offers.sort, o.key)}
                label={o.chip}
                selected={p.order.sort === o.key}
                onPress={() => p.onSort(o.key)}
              />
            ))}
          </View>
          <View
            testID={TID.offers.order}
            accessible
            accessibilityLabel={[p.order.label, p.order.tieBreak, p.order.note]
              .filter(Boolean)
              .join(". ")}
          >
            <Text variant="caption" tone="text2">
              {p.order.pending ? "Sorting… " : ""}
              {p.order.label}
              {p.order.tieBreak ? " (" + p.order.tieBreak + ")" : ""}
            </Text>
            {p.order.note ? (
              <Text variant="caption" tone="text3">
                {p.order.note}
              </Text>
            ) : null}
            <Text variant="caption" tone="text3">
              New offers are added at the end so nothing moves while you read.
            </Text>
          </View>
        </View>
      ) : null}
      {p.widenedBanner ? <Banner tone="warn" body={p.widenedBanner} /> : null}
    </View>
  );
  return (
    <Screen
      title={
        p.phase === "searching"
          ? "Your request is live"
          : p.offers.length + (p.offers.length === 1 ? " offer" : " offers")
      }
      subtitle={"Expires " + p.expiresLabel}
      action={
        p.connection === "reconnecting"
          ? undefined
          : {
              label: "Cancel",
              onPress: p.onCancel,
              testID: TID.offers.cancelRequest,
            }
      }
      scroll={false}
    >
      <View style={{ paddingHorizontal: 20, flex: 1 }}>
        {p.phase === "searching" ? (
          <View style={{ gap: 12 }}>
            {header}
            <Card>
              <Skeleton width="60%" />
              <Skeleton width="82%" />
            </Card>
            <Card>
              <Skeleton width="72%" />
              <Skeleton width="48%" />
            </Card>
            <Text variant="caption" tone="text2" align="center">
              {p.envelopeLabel}
            </Text>
          </View>
        ) : (
          <FlatList
            testID={TID.offers.list}
            data={p.offers}
            keyExtractor={(o) => o.bidId}
            ListHeaderComponent={
              <View style={{ paddingBottom: 12 }}>{header}</View>
            }
            renderItem={({ item: o }) => (
              <OfferCard o={o} onOpen={() => p.onOpenOffer(o.bidId)} />
            )}
          />
        )}
      </View>
    </Screen>
  );
}
