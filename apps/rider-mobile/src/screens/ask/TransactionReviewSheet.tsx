import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  Text,
  StatusPill,
  MoneyText,
  Button,
  Row,
  Skeleton,
  Banner,
  useTheme,
} from "@ubi/mobile-ui";
import { ApiError, track, TID } from "@ubi/mobile-core";
import {
  askApi,
  conventionalMarketplaceTarget,
  type Review,
  type ReviewItem,
} from "../../api/ask";
import { MarketplaceReviewBody } from "./MarketplaceReviewBody";

function useCountdown(iso?: string) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const tick = () =>
      setLeft(
        Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)),
      );
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [iso]);
  return left;
}
const mmss = (s: number) =>
  Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

/** A fresh key per review; a retry of the SAME approval reuses it. */
function approvalKey(reviewId: string): string {
  return (
    "ask_confirm_" +
    reviewId.replace(/[^A-Za-z0-9_.:-]/g, "").slice(-24) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function ItemBlock({ item }: { item: ReviewItem }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.colors.border,
        borderRadius: t.radius.card,
        padding: 12,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="bodySmStrong">{item.title}</Text>
        <MoneyText money={item.price} variant="bodySmStrong" />
      </View>
      {item.detail ? (
        <Text variant="caption" tone="text2">
          {item.detail}
        </Text>
      ) : null}
      {item.priceBreakdown?.length ? (
        <Text variant="caption" tone="text2">
          {item.priceBreakdown.map((b) => b.label).join(" · ")}
        </Text>
      ) : null}
      {item.terms.map((tm) => (
        <Text
          key={tm.text}
          variant="caption"
          tone={
            tm.tone === "warning"
              ? "errorInk"
              : tm.tone === "positive"
                ? "primaryInk"
                : "text2"
          }
        >
          {tm.text}
        </Text>
      ))}
    </View>
  );
}

/**
 * Board 20b / D01 AskProposal — AWAITING YOUR CONFIRMATION. Exact server terms,
 * terms version, countdown; the PIN goes through SecureConfirm; 409 ⇒ show the
 * new review, never charge. A marketplace review renders its structured
 * proposal (price, the driver's offer, the commission on its own line) and
 * its approve echoes the persisted scope/revision. When the assistant cannot
 * finish — the offer is gone, the marketplace or the assistant is unavailable
 * — the sheet hands off to the regular request screen: never a dead end.
 */
export function TransactionReviewSheet({
  reviewId,
  onDismiss,
  onExecuting,
}: {
  reviewId: string;
  onDismiss: () => void;
  onExecuting: (executionId: string) => void;
}) {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const [id, setId] = useState(reviewId);
  const q = useQuery({
    queryKey: ["review", id],
    queryFn: () => askApi.getReview(id),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [handoff, setHandoff] = useState<string | undefined>();
  const keys = useRef<Record<string, string>>({});
  const left = useCountdown(q.data?.expiresAt);
  const expired = q.data
    ? left === 0 || q.data.status !== "awaiting_confirmation"
    : false;
  useEffect(() => {
    if (expired && q.data) track("ask_review_expired", { reviewId: id });
  }, [expired]);

  const r = q.data;
  const mp = r?.kind === "marketplace" ? r.marketplace : undefined;

  const handOff = (link: string | undefined, message: string) => {
    setNotice(message);
    setHandoff(link ?? mp?.conventionalFlow ?? "ubi://marketplace/compose");
  };

  const confirm = () => {
    if (!r) return;
    const review = r;
    keys.current[review.id] ??= approvalKey(review.id);
    nav.navigate("SecureConfirm", {
      purpose: mp
        ? mp.stage === "select"
          ? "Approve this offer"
          : "Publish this request"
        : "Confirm booking",
      onProof: async (proof: string) => {
        setBusy(true);
        try {
          const result = await askApi.confirmReview(
            review.id,
            review.termsVersion,
            proof,
            {
              idempotencyKey: keys.current[review.id],
              expect: mp
                ? {
                    scopeFingerprint: mp.scope.fingerprint,
                    requestRevision: mp.selection?.requestRevision,
                    bidId: mp.selection?.bidId,
                  }
                : undefined,
            },
          );
          track("ask_review_confirmed", {
            reviewId: review.id,
            kind: review.kind ?? "travel",
            items: review.items.length,
            totalMinor: review.total.amountMinor,
            termsVersion: review.termsVersion,
          });
          onExecuting(result.executionId);
        } catch (e) {
          if (
            e instanceof ApiError &&
            e.status === 409 &&
            e.code === "http_409"
          ) {
            // The body IS the fresh review to confirm.
            const fresh = e.details as Review;
            setId(fresh.id);
            setNotice(
              mp
                ? "The offer changed before you approved. Nothing was selected — here are the new terms."
                : "A price or term changed before booking. Nothing was charged — here are the new terms.",
            );
          } else if (e instanceof ApiError && e.status === 410) {
            setNotice("This review expired. Ask again for fresh prices.");
          } else if (mp && e instanceof ApiError && e.status === 504) {
            // The gateway gave up waiting, but the approval may still have
            // run: say so, never "nothing was selected". The request screen
            // shows the real outcome, and a selection never runs twice.
            handOff(
              undefined,
              "We couldn't confirm the result yet. Check the request screen — nothing is ever selected or charged twice.",
            );
          } else if (mp && e instanceof ApiError) {
            const details = e.details as
              | { conventionalFlow?: string }
              | undefined;
            handOff(
              details?.conventionalFlow,
              e.code === "feature_disabled" || e.status >= 500
                ? "Ask UBI can't finish this right now. Nothing was selected — continue on the request screen."
                : "That offer can't be approved any more. Nothing was selected — see the current offers.",
            );
          } else if (mp) {
            // No answer at all: the approval may or may not have arrived.
            handOff(
              undefined,
              "We couldn't confirm the result. Check the request screen — nothing is ever selected or charged twice.",
            );
          } else {
            setNotice("We could not confirm right now. Nothing was charged.");
          }
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const openConventional = () => {
    const target = conventionalMarketplaceTarget(handoff);
    track("ask_conventional_handoff", { screen: target.screen });
    onDismiss();
    nav.navigate("Marketplace", target);
  };

  return (
    <Sheet visible onDismiss={onDismiss} testID={TID.ask.review.sheet}>
      {!r ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={20} width="50%" />
          <Skeleton height={90} />
          <Skeleton height={90} />
          {q.isError ? (
            <>
              <Banner
                tone="warn"
                body="Ask UBI can't load this right now. You can still continue on the regular screens."
              />
              <Button
                testID="ask.review.handoff"
                label="Use the regular screen"
                kind="secondary"
                size="md"
                onPress={() => {
                  onDismiss();
                  nav.navigate("Marketplace", { screen: "Details" });
                }}
              />
            </>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {notice ? (
            <Banner tone="warn" body={notice} testID="ask.review.notice" />
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <StatusPill
              status={expired ? "expired" : "awaiting_confirmation"}
            />
            <Text variant="caption" tone="text2">
              Terms v. {r.termsVersion}
              {!expired ? " · held for " + mmss(left) : ""}
            </Text>
          </View>
          {mp ? (
            <>
              <Text variant="title">
                {mp.stage === "select"
                  ? "Select this driver's offer"
                  : "Ask drivers for offers"}
              </Text>
              <MarketplaceReviewBody review={mp} secondsLeft={left} />
            </>
          ) : (
            <>
              <Text variant="title">
                Book {String(r.items.length)}{" "}
                {r.items.length === 1 ? "item" : "items"} ·{" "}
                <MoneyText money={r.total} variant="title" />
              </Text>
              {r.items.map((it) => (
                <ItemBlock key={it.title} item={it} />
              ))}
            </>
          )}
          <View>
            {!mp ? (
              <Row
                label="Savings applied"
                value={
                  r.adjustments?.length ? undefined : (
                    <Text variant="bodySmStrong" tone="text2">
                      none eligible
                    </Text>
                  )
                }
              />
            ) : null}
            {/* Each server adjustment on its own line — never summed here. */}
            {!mp
              ? r.adjustments?.map((a) => (
                  <Row
                    key={a.label}
                    label={a.label}
                    value={
                      <MoneyText
                        money={a.amount}
                        variant="bodySmStrong"
                        tone="primaryInk"
                      />
                    }
                  />
                ))
              : null}
            <Row label="Pay with" value={r.paymentMethod.label} last />
          </View>
          {(
            r.notes ?? [
              "Each item is booked separately. If one fails, you are charged only for what was confirmed. If a price changes before booking, we stop and ask you again.",
            ]
          ).map((n) => (
            <Text key={n} variant="caption" tone="text2">
              {n}
            </Text>
          ))}
          {handoff ? (
            <Button
              testID="ask.review.handoff"
              label="Open the request screen"
              kind="inverse"
              onPress={openConventional}
            />
          ) : (
            <Button
              testID={mp ? "ask.mpReview.approve" : TID.ask.review.confirmPin}
              label={
                expired
                  ? "Ask again for fresh prices"
                  : mp
                    ? "Approve with PIN"
                    : "Confirm with PIN"
              }
              loading={busy}
              kind={expired ? "inverse" : "primary"}
              onPress={expired ? onDismiss : confirm}
            />
          )}
          <Button
            testID={TID.ask.review.dismiss}
            label="Not now"
            kind="ghost"
            size="md"
            onPress={onDismiss}
          />
        </View>
      )}
    </Sheet>
  );
}
