// Design handoff D01 + D06 + D07 (handoff-marketplace/rn/driver/RequestFeedScreen.tsx),
// adapted for repo imports and contracts TEST_IDS. Repo additions, both documented on the
// props: `parkedConfirm` (the explicit "I am safely parked" attestation, task C — the only
// way out of moving/stale without telemetry) and `quickLinks` (task D navigation entries to
// Wallet/Rates/Jobs). Neither weakens the motion gate: while moving, bid affordances are
// NOT RENDERED (never disabled-and-tempting), one deferred banner max, no countdowns.
import React from "react";
import { View, FlatList, Pressable } from "react-native";
import {
  Screen,
  Text,
  Card,
  Banner,
  Button,
  Chip,
  StatusPill,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MpEarningsBreakdown } from "../../api/marketplace";
import { EarningsBreakdownCard } from "./EarningsBreakdownCard";
import { MP_DRIVER_TID } from "./testIds";

/** D01 + D06 + D07. Driver app is dark-default (ThemeProvider defaultMode="dark").
 * Moving mode: bid affordances are NOT RENDERED (never disabled-and-tempting); one deferred banner max. */
export type FeedRequest = {
  requestId: string;
  revision: number;
  title: string; // privacy-limited: area → area
  meta: string; // "Ride · Economy · 12.4 km · ~28 min · pickup 1.2 km from you"
  askedMinor: Money;
  askedByLabel: string; // "rider asks" | "sender asks"
  capabilityBadge: string | null;
  expiresLabel: string;
  // A04.1: the server-composed breakdown, rendered verbatim (null from an older server:
  // then no breakdown is shown — the client never builds one of its own).
  earnings: MpEarningsBreakdown | null;
  // A04.2: the server says this request ends in the driver's homeward area.
  homeward: boolean;
};
export type MyBid = {
  bidId: string;
  title: string;
  amountMinor: Money;
  status: "awaiting" | "lost" | "expired" | "won_elsewhere";
  holdMinor: Money;
  holdState: "held" | "release_pending" | "released";
  holdDetail: string; // "confirmed 9:40" | "closes 2:05"
};
export type RequestFeedProps = {
  motion: "parked_confirmed" | "moving" | "stale_location";
  online: boolean;
  areaLabel: string;
  earningsTodayLabel: string;
  tab: "feed" | "myBids";
  onTab: (t: "feed" | "myBids") => void;
  requests: FeedRequest[];
  onOpen: (id: string) => void;
  deferredPrompt: string | null; // moving: "1 request near your drop-off" — no actions attached
  reconnected: boolean; // show "refreshed from server" pill once after reconnect
  myBids: MyBid[];
  // Repo addition (task C): explicit parked attestation; server stays the authority.
  parkedConfirm: null | {
    confirming: boolean;
    error: string | null;
    onConfirm: () => void;
  };
  // Repo addition (task D): Root-screen entries (WalletHolds / Rates / Jobs).
  quickLinks: { key: string; label: string; onPress: () => void }[];
  // A04.2: the server's statement of how the driver's preferences shaped this page
  // (null when none are saved). The toggle re-asks the server with preferences=ignore.
  preferences: null | {
    note: string;
    hiddenLabel: string | null;
    toggleLabel: string;
    onToggle: () => void;
  };
};

export function RequestFeedScreen(p: RequestFeedProps) {
  const t = useTheme();
  if (p.motion === "moving") {
    return (
      <Screen scroll={false} bg="bg">
        <View
          style={{ flex: 1, justifyContent: "flex-end", padding: 16, gap: 8 }}
        >
          {/* Navigation/map stays primary; nothing tappable overlays it */}
          {p.deferredPrompt ? (
            <Card
              testID={TEST_IDS.mp.driver.feed.movingBanner}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: t.colors.warn,
                }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{p.deferredPrompt}</Text>
                <Text variant="caption" tone="text2">
                  Details when you’re safely stopped. It won’t interrupt again.
                </Text>
              </View>
            </Card>
          ) : null}
          <Text variant="caption" tone="text3" align="center">
            No countdowns, no repeated alerts, no penalty for ignoring. Your
            earlier bids stay live.
          </Text>
          {p.parkedConfirm ? (
            <>
              {p.parkedConfirm.error ? (
                <Banner tone="error" body={p.parkedConfirm.error} />
              ) : null}
              <Button
                label="I am safely parked"
                kind="secondary"
                loading={p.parkedConfirm.confirming}
                onPress={p.parkedConfirm.onConfirm}
              />
            </>
          ) : null}
        </View>
      </Screen>
    );
  }
  return (
    <Screen scroll={false} bg="bg">
      <View style={{ padding: 16, gap: 8 }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: p.online ? t.colors.ok : t.colors.text3,
            }}
          />
          <Text variant="bodyStrong">
            {p.online ? "Online · " + p.areaLabel : "Offline"}
          </Text>
          <Text
            variant="bodySmStrong"
            tone="ok"
            style={{ marginLeft: "auto" }}
            tabular
          >
            {p.earningsTodayLabel}
          </Text>
        </Card>
        {p.motion === "stale_location" ? (
          <Banner
            tone="warn"
            body="Location signal stale — bidding paused until GPS recovers. We can’t estimate your pickup time."
          />
        ) : null}
        {p.motion === "stale_location" && p.parkedConfirm ? (
          <>
            {p.parkedConfirm.error ? (
              <Banner tone="error" body={p.parkedConfirm.error} />
            ) : null}
            <Button
              label="I am safely parked"
              kind="secondary"
              size="md"
              loading={p.parkedConfirm.confirming}
              onPress={p.parkedConfirm.onConfirm}
            />
          </>
        ) : null}
        {p.reconnected ? (
          <StatusPill status="done" suffix="refreshed from server" />
        ) : null}
        {p.quickLinks.length ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {p.quickLinks.map((l) => (
              <Chip key={l.key} label={l.label} onPress={l.onPress} />
            ))}
          </View>
        ) : null}
        {p.preferences ? (
          <Card
            testID={MP_DRIVER_TID.feed.prefsBanner}
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="text2">
                {p.preferences.note}
              </Text>
              {p.preferences.hiddenLabel ? (
                <Text variant="caption" tone="text3">
                  {p.preferences.hiddenLabel}
                </Text>
              ) : null}
            </View>
            <Chip
              testID={MP_DRIVER_TID.feed.prefsToggle}
              label={p.preferences.toggleLabel}
              onPress={p.preferences.onToggle}
            />
          </Card>
        ) : null}
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: t.colors.bg2,
          borderTopLeftRadius: t.radius.sheet,
          borderTopRightRadius: t.radius.sheet,
          borderTopWidth: 1,
          borderTopColor: t.colors.border,
          padding: 20,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable accessibilityRole="tab" onPress={() => p.onTab("feed")}>
            <Text variant="heading" tone={p.tab === "feed" ? "text" : "text3"}>
              Open requests
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            testID={TEST_IDS.mp.driver.feed.myBids}
            onPress={() => p.onTab("myBids")}
          >
            <Text
              variant="heading"
              tone={p.tab === "myBids" ? "text" : "text3"}
            >
              My offers
            </Text>
          </Pressable>
        </View>
        {p.tab === "feed" ? (
          <FlatList
            testID={TEST_IDS.mp.driver.feed.list}
            data={p.requests}
            keyExtractor={(r) => r.requestId}
            ListFooterComponent={
              <Text variant="caption" tone="text3" align="center">
                Viewing a request never takes you off availability
              </Text>
            }
            renderItem={({ item: r }) => (
              <Pressable
                testID={dynamicTestId(
                  TEST_IDS.mp.driver.feed.card,
                  r.requestId,
                )}
                accessibilityRole="button"
                onPress={() => p.onOpen(r.requestId)}
              >
                <Card style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{r.title}</Text>
                      <Text variant="caption" tone="text2">
                        {r.meta}
                      </Text>
                      {r.homeward ? (
                        <Text
                          testID={dynamicTestId(
                            MP_DRIVER_TID.feed.homewardTag,
                            r.requestId,
                          )}
                          variant="caption"
                          tone="ok"
                        >
                          Ends in your homeward area
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <MoneyText money={r.askedMinor} variant="title" />
                      <Text variant="caption" tone="text2">
                        {r.askedByLabel}
                      </Text>
                    </View>
                  </View>
                  {r.earnings ? (
                    <View style={{ marginTop: 8 }}>
                      <EarningsBreakdownCard
                        earnings={r.earnings}
                        variant="compact"
                        idSuffix={r.requestId}
                      />
                    </View>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 10,
                    }}
                  >
                    {r.capabilityBadge ? (
                      <StatusPill status="live" suffix={r.capabilityBadge} />
                    ) : (
                      <Text variant="caption" tone="text3">
                        Exact addresses after you’re chosen
                      </Text>
                    )}
                    <Text
                      variant="caption"
                      tone="text3"
                      style={{ marginLeft: "auto" }}
                      tabular
                    >
                      expires {r.expiresLabel}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            )}
          />
        ) : (
          <FlatList
            data={p.myBids}
            keyExtractor={(b) => b.bidId}
            ListFooterComponent={
              <Text variant="caption" tone="text3" align="center">
                No winner price or identity is shown — just your own result and
                your money back.
              </Text>
            }
            renderItem={({ item: b }) => (
              <Card
                style={{
                  marginBottom: 12,
                  opacity: b.status === "expired" ? 0.6 : 1,
                }}
              >
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{b.title}</Text>
                    {b.status === "awaiting" ? (
                      <StatusPill
                        status="processing"
                        suffix="awaiting requester"
                      />
                    ) : b.status === "lost" ? (
                      <StatusPill
                        status="cancelled"
                        suffix="requester chose another driver"
                      />
                    ) : b.status === "won_elsewhere" ? (
                      <StatusPill
                        status="cancelled"
                        suffix="you won another request"
                      />
                    ) : (
                      <StatusPill status="expired" />
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      variant="bodySmStrong"
                      tone={b.holdState === "held" ? "warnInk" : "ok"}
                      tabular
                    >
                      {b.holdState === "held"
                        ? ""
                        : b.holdState === "release_pending"
                          ? "release pending · "
                          : "released · "}
                    </Text>
                    <MoneyText
                      money={b.holdMinor}
                      variant="bodySmStrong"
                      tone={b.holdState === "held" ? "warnInk" : "ok"}
                    />
                    <Text variant="caption" tone="text3">
                      {b.holdDetail}
                    </Text>
                  </View>
                </View>
              </Card>
            )}
          />
        )}
      </View>
    </Screen>
  );
}
