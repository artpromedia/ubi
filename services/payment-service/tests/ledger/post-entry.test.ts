import { ContractError, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceFromView, balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { postEntry } from "../../src/ledger/post-entry";
import { ensureWallet } from "../../src/ledger/wallets";

import { closeTestDb, seedCity, testDb, uid } from "./helpers";

const db = testDb();

afterAll(async () => {
  await closeTestDb();
});

async function walletFor(
  cityId: string,
): Promise<{ id: string; currency: string }> {
  const config = await createCityConfigProvider(db).load(cityId);
  const wallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", uid("owner"), config.city),
  );
  return { id: wallet.id, currency: wallet.currency };
}

describe("double-entry invariant", () => {
  it("commits a balanced entry and derives the balance from its lines", async () => {
    const city = await seedCity(db);
    const wallet = await walletFor(city.cityId);

    const entry = await db.$transaction((tx) =>
      postEntry(tx, {
        kind: "topup",
        reference: `topup:${uid("t")}`,
        occurredAt: new Date(),
        lines: [
          {
            account: "psp_settlement",
            amount: money(-250_000, wallet.currency),
            counterpartRef: `wallet:${wallet.id}`,
          },
          {
            account: "wallet",
            walletId: wallet.id,
            amount: money(250_000, wallet.currency),
            counterpartRef: "topup:seed",
          },
        ],
      }),
    );

    expect(entry.lines).toHaveLength(2);
    const balance = await balanceOf(db, wallet.id, wallet.currency);
    expect(balance).toEqual(money(250_000, wallet.currency));

    // The application's derivation and the database's `wallet_balances` view
    // must agree — neither is allowed to become the "real" one.
    const fromView = await balanceFromView(db, wallet.id, wallet.currency);
    expect(fromView).toEqual(balance);
  });

  it("refuses an unbalanced entry before writing anything", async () => {
    const city = await seedCity(db);
    const wallet = await walletFor(city.cityId);

    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          kind: "p2p_transfer",
          reference: `transfer:${uid("t")}`,
          occurredAt: new Date(),
          lines: [
            {
              account: "wallet",
              walletId: wallet.id,
              amount: money(-100, wallet.currency),
              counterpartRef: "x",
            },
            {
              account: "ubi_float",
              amount: money(90, wallet.currency),
              counterpartRef: "x",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "unbalanced_journal" });

    const lines = await db.journalLine.count({
      where: { walletId: wallet.id },
    });
    expect(lines).toBe(0);
  });

  it("is refused by the database at COMMIT even when the application check is bypassed", async () => {
    const city = await seedCity(db);
    const wallet = await walletFor(city.cityId);
    const entryId = uid("je");

    // Written straight through Prisma, so only the deferred CONSTRAINT TRIGGER
    // can catch it. This is the guarantee the ledger actually rests on.
    await expect(
      db.$transaction(async (tx) => {
        await tx.journalEntry.create({
          data: {
            id: entryId,
            kind: "p2p_transfer",
            reference: `transfer:${entryId}`,
            occurredAt: new Date(),
          },
        });
        await tx.journalLine.createMany({
          data: [
            {
              id: uid("jl"),
              entryId,
              account: "wallet",
              walletId: wallet.id,
              amountMinor: BigInt(-100_000),
              currency: wallet.currency,
              counterpartRef: "bypass",
            },
            {
              id: uid("jl"),
              entryId,
              account: "ubi_float",
              amountMinor: BigInt(90_000),
              currency: wallet.currency,
              counterpartRef: "bypass",
            },
          ],
        });
      }),
    ).rejects.toThrow(/unbalanced/i);

    expect(
      await db.journalEntry.findUnique({ where: { id: entryId } }),
    ).toBeNull();
    expect(await db.journalLine.count({ where: { entryId } })).toBe(0);
    expect(await balanceOf(db, wallet.id, wallet.currency)).toEqual(
      money(0, wallet.currency),
    );
  });

  it("keeps a multi-currency entry balanced per currency", async () => {
    const entryRef = uid("mix");
    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          kind: "recon_adjustment",
          reference: entryRef,
          caseRef: "case_1",
          occurredAt: new Date(),
          lines: [
            {
              account: "ubi_float",
              amount: money(-100, "NGN"),
              counterpartRef: "a",
            },
            {
              account: "ubi_commission",
              amount: money(100, "NGN"),
              counterpartRef: "a",
            },
            {
              account: "ubi_float",
              amount: money(-100, "KES"),
              counterpartRef: "a",
            },
            {
              account: "ubi_commission",
              amount: money(90, "KES"),
              counterpartRef: "a",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "unbalanced_journal" });
  });

  it("requires a wallet on wallet-bearing accounts and none on rail accounts", async () => {
    const city = await seedCity(db);
    const wallet = await walletFor(city.cityId);

    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          kind: "topup",
          reference: uid("bad"),
          occurredAt: new Date(),
          lines: [
            {
              account: "wallet",
              amount: money(-10, wallet.currency),
              counterpartRef: "a",
            },
            {
              account: "ubi_float",
              amount: money(10, wallet.currency),
              counterpartRef: "a",
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ContractError);

    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          kind: "topup",
          reference: uid("bad"),
          occurredAt: new Date(),
          lines: [
            {
              account: "ubi_float",
              walletId: wallet.id,
              amount: money(-10, wallet.currency),
              counterpartRef: "a",
            },
            {
              account: "wallet",
              walletId: wallet.id,
              amount: money(10, wallet.currency),
              counterpartRef: "a",
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ContractError);
  });

  it("refuses an adjustment that names no case", async () => {
    await expect(
      db.$transaction((tx) =>
        postEntry(tx, {
          kind: "recon_adjustment",
          reference: uid("adj"),
          occurredAt: new Date(),
          lines: [
            {
              account: "ubi_float",
              amount: money(-10, "NGN"),
              counterpartRef: "a",
            },
            {
              account: "ubi_commission",
              amount: money(10, "NGN"),
              counterpartRef: "a",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
