import {
  formatMinor,
  accessibleMoney,
  moneyFormatFor,
  useCityConfig,
  type Money,
} from "@ubi/mobile-core";
import { Text, type UbiTextProps } from "./Text";

/** Renders server money. Never receives a computed value; only what the API returned. */
export function MoneyText({
  money,
  signed,
  struck,
  ...rest
}: {
  money: Money | undefined | null;
  signed?: boolean;
  struck?: boolean;
} & Omit<UbiTextProps, "children">) {
  const { config } = useCityConfig();
  const fmt = config ? moneyFormatFor(config) : {};
  return (
    <Text
      tabular
      accessibilityLabel={accessibleMoney(money ?? undefined)}
      {...rest}
      style={[
        struck ? { textDecorationLine: "line-through" } : null,
        rest.style,
      ]}
    >
      {formatMinor(money, fmt, { signed })}
    </Text>
  );
}
