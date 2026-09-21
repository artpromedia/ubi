// Wallet.Statement (C05 / G12): GET /v1/wallet/statements?from&to for the
// shown month. Lines, running balances and the opening/closing totals are the
// ledger's own; the client only formats. Month stepping changes the query —
// no client-side aggregation ever happens.
import React, { useState } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Text, Card, Row, Button, MoneyText } from "@ubi/mobile-ui";
import { walletApi, statementMoney } from "../../api/wallet";
import type { WalletStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState, EmptyState } from "../../components/states";

const pad = (n: number) => String(n).padStart(2, "0");
const monthRange = (anchor: Date) => {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
    label: anchor.toLocaleString(undefined, { month: "long", year: "numeric" }),
  };
};

export function WalletStatementScreen() {
  const nav = useNavigation<{ goBack: () => void }>();
  const { params } = useRoute<RouteProp<WalletStackParamList, "Statement">>();
  const initial = params?.month ? new Date(params.month + "-01") : new Date();
  const [anchor, setAnchor] = useState(
    Number.isNaN(initial.getTime()) ? new Date() : initial,
  );
  const range = monthRange(anchor);
  const q = useQuery({
    queryKey: ["wallet", "statement", range.from, range.to],
    queryFn: () => walletApi.statement(range.from, range.to),
  });
  const s = q.data;
  const step = (delta: number) =>
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
  return (
    <Screen title="Statement" subtitle={range.label} onBack={nav.goBack}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          label="‹ Previous"
          kind="secondary"
          size="md"
          accessibilityLabel="Previous month"
          onPress={() => step(-1)}
          style={{ flex: 1 }}
        />
        <Button
          label="Next ›"
          kind="secondary"
          size="md"
          accessibilityLabel="Next month"
          onPress={() => step(1)}
          style={{ flex: 1 }}
        />
      </View>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <LoadingState />
      ) : (
        <>
          <Card>
            <Row
              label="Opening"
              value={<MoneyText money={s.opening} variant="bodySmStrong" />}
            />
            <Row
              label="In"
              value={<MoneyText money={s.in} signed variant="bodySmStrong" />}
            />
            <Row
              label="Out"
              value={<MoneyText money={s.out} variant="bodySmStrong" />}
            />
            <Row
              label="Closing"
              value={<MoneyText money={s.closing} variant="bodySmStrong" />}
              last
            />
          </Card>
          {s.lines.length === 0 ? (
            <EmptyState
              title="No activity"
              body={"Nothing moved in " + range.label + "."}
            />
          ) : (
            <Card>
              {s.lines.map((line, i) => (
                <Row
                  key={line.lineId}
                  label={
                    (line.description ?? line.kind) +
                    " · " +
                    new Date(line.occurredAt).toLocaleDateString()
                  }
                  value={
                    <MoneyText
                      money={statementMoney(s, line.amountMinor)}
                      signed={line.amountMinor > 0}
                      variant="bodySmStrong"
                    />
                  }
                  last={i === s.lines.length - 1}
                />
              ))}
            </Card>
          )}
          <Text variant="caption" tone="text3" align="center">
            Every line is the ledger’s own record; totals are computed by the
            server.
          </Text>
        </>
      )}
    </Screen>
  );
}
