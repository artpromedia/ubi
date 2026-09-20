import { allowedTransitions, canTransition, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  activeHoldsMinor,
  balanceOf,
  spendableOf,
} from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { reserveHold } from "../../src/ledger/mp-holds";
import {
  disputeTransfer,
  openReturnRequest,
  respondToReturnRequest,
} from "../../src/ledger/returns";
import { sendTransfer } from "../../src/ledger/transfers";
import { setInitialPin } from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const db = testDb();
const PIN = "9182";

/** Wallets whose marketplace holds this file creates, swept afterwards. */
const heldWalletIds: string[] = [];

afterAll(async () => {
  await db.mpCommissionHold.deleteMany({
    where: { walletId: { in: heldWalletIds } },
  });
  await closeTestDb();
});

async function postedTransfer(amountMinor = 300_000) {
  const city = await seedCity(db);
  const deps = makeDeps(db);
  const senderUser = await seedUser(db, "Tunde");
  const recipientUser = await seedUser(db, "Amara");
  const config = await createCityConfigProvider(db).load(city.cityId);

  const senderWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", senderUser.id, config.city),
  );
  const recipientWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", recipientUser.id, config.city),
  );
  await setInitialPin(
    deps,
    { id: senderUser.id, role: "rider" },
    city.cityId,
    PIN,
  );
  await fundWallet(db, senderWallet.id, city.currency, 5_000_000);

  const transfer = await sendTransfer(deps, {
    actor: { id: senderUser.id, role: "rider" },
    cityId: city.cityId,
    toUserId: recipientUser.id,
    amountMinor,
    pin: PIN,
    idempotencyKey: uid("idem"),
  });

  return {
    city,
    deps,
    transfer,
    sender: { id: senderUser.id, walletId: senderWallet.id },
    recipient: { id: recipientUser.id, walletId: recipientWallet.id },
  };
}

describe("returning a posted transfer", () => {
  it("has no state in the contract that pulls money back without the recipient", () => {
    // The machine itself is the guard: from `posted` the only ways on are a
    // return request or closing the transfer — never straight to `reversed`.
    expect(allowedTransitions("walletTransfer", "posted")).toEqual([
      "return_requested",
      "closed",
    ]);
    expect(canTransition("walletTransfer", "posted", "reversed")).toBe(false);
    expect(
      canTransition("walletTransfer", "return_requested", "reversed"),
    ).toBe(true);
  });

  it("lets the sender ask, and moves nothing until the recipient agrees", async () => {
    const s = await postedTransfer();

    const request = await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
      reason: "sent to the wrong person",
    });

    expect(request.status).toBe("requested");
    expect(request.transferStatus).toBe("return_requested");
    expect(request.entryId).toBeNull();
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(300_000, s.city.currency),
    );

    const consented = await respondToReturnRequest(s.deps, {
      actor: { id: s.recipient.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
      returnRequestId: request.returnRequestId,
      consent: true,
    });

    expect(consented.status).toBe("returned");
    expect(consented.transferStatus).toBe("reversed");
    expect(consented.entryId).not.toBeNull();

    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(0, s.city.currency),
    );
    expect(await balanceOf(db, s.sender.walletId, s.city.currency)).toEqual(
      money(5_000_000, s.city.currency),
    );

    // The original entry is untouched; the reversal is a new one.
    const original = await db.journalEntry.findUniqueOrThrow({
      where: { id: s.transfer.entryId! },
      include: { lines: true },
    });
    expect(original.kind).toBe("p2p_transfer");
    expect(original.lines).toHaveLength(2);
    const reversal = await db.journalEntry.findUniqueOrThrow({
      where: { id: consented.entryId! },
    });
    expect(reversal.kind).toBe("p2p_reversal");
    expect(reversal.id).not.toBe(original.id);
  });

  it("refuses to reverse when anyone but the recipient answers", async () => {
    const s = await postedTransfer();
    const request = await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
    });

    await expect(
      respondToReturnRequest(s.deps, {
        // The sender trying to consent on the recipient's behalf.
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.city.cityId,
        transferId: s.transfer.transferId,
        returnRequestId: request.returnRequestId,
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "return_not_consented", status: 409 });

    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(300_000, s.city.currency),
    );
  });

  it("leaves the money put when the recipient declines, and opens the dispute route", async () => {
    const s = await postedTransfer();
    const request = await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
    });

    const declined = await respondToReturnRequest(s.deps, {
      actor: { id: s.recipient.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
      returnRequestId: request.returnRequestId,
      consent: false,
      reason: "it was owed to me",
    });

    expect(declined.status).toBe("declined");
    expect(declined.transferStatus).toBe("declined_by_recipient");
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(300_000, s.city.currency),
    );

    const dispute = await disputeTransfer(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
      reason: "I never owed this",
    });
    expect(dispute.transferStatus).toBe("disputed");
    const supportCase = await db.supportCase.findUniqueOrThrow({
      where: { id: dispute.caseId },
    });
    expect(supportCase.category).toBe("wallet_transfer_dispute");

    // Still nothing has moved: a dispute is a case for a human, not a reversal.
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(300_000, s.city.currency),
    );
  });

  it("refuses a second return request on an already-requested transfer", async () => {
    const s = await postedTransfer();
    await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
    });
    await expect(
      openReturnRequest(s.deps, {
        actor: { id: s.sender.id, role: "rider" },
        cityId: s.city.cityId,
        transferId: s.transfer.transferId,
      }),
    ).rejects.toMatchObject({ code: "illegal_transition" });
  });

  it("only the sender may ask for a return", async () => {
    const s = await postedTransfer();
    await expect(
      openReturnRequest(s.deps, {
        actor: { id: s.recipient.id, role: "rider" },
        cityId: s.city.cityId,
        transferId: s.transfer.transferId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("consented returns versus marketplace holds (M04)", () => {
  it("refuses a consent that would leave the recipient's active bid holds unbacked", async () => {
    const s = await postedTransfer(300_000);
    heldWalletIds.push(s.recipient.walletId);

    // The recipient (a driver) has a live bid: 30,000 of their 300,000 is
    // encumbered by an active commission hold.
    await reserveHold(
      s.deps,
      {
        driverId: s.recipient.id,
        bidRef: uid("bid"),
        requestRef: uid("req"),
        amountMinor: 30_000,
        baseMinor: 300_000,
        currency: s.city.currency,
        policyVersion: 1,
        cityId: s.city.cityId,
      },
      uid("idem"),
    );

    const request = await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
    });

    // Balance covers the 300,000 return but spendable (270,000) does not:
    // the ONE spendable calculation refuses with the exact shortfall, so a
    // consented return can never strip the backing out of a live hold.
    await expect(
      respondToReturnRequest(s.deps, {
        actor: { id: s.recipient.id, role: "rider" },
        cityId: s.city.cityId,
        transferId: s.transfer.transferId,
        returnRequestId: request.returnRequestId,
        consent: true,
      }),
    ).rejects.toMatchObject({
      code: "insufficient_spendable",
      details: expect.objectContaining({ shortfallMinor: 30_000 }),
    });

    // Nothing moved and nothing was consumed: the request is still open, the
    // transfer still awaits an answer, and the hold is still fully backed.
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(300_000, s.city.currency),
    );
    expect(await balanceOf(db, s.sender.walletId, s.city.currency)).toEqual(
      money(4_700_000, s.city.currency),
    );
    expect(
      await activeHoldsMinor(db, s.recipient.walletId, s.city.currency),
    ).toEqual(money(30_000, s.city.currency));
    expect(
      await spendableOf(db, s.recipient.walletId, s.city.currency),
    ).toEqual(money(270_000, s.city.currency));
    const transferRow = await db.transfer.findUniqueOrThrow({
      where: { id: s.transfer.transferId },
    });
    expect(transferRow.status).toBe("return_requested");
    const requestRow = await db.returnRequest.findUniqueOrThrow({
      where: { id: request.returnRequestId },
    });
    expect(requestRow.status).toBe("requested");
  });

  it("still refuses a genuinely short balance with insufficient_funds", async () => {
    const s = await postedTransfer(300_000);

    // The recipient spends most of the money before answering.
    await setInitialPin(
      s.deps,
      { id: s.recipient.id, role: "rider" },
      s.city.cityId,
      PIN,
    );
    await sendTransfer(s.deps, {
      actor: { id: s.recipient.id, role: "rider" },
      cityId: s.city.cityId,
      toUserId: s.sender.id,
      amountMinor: 200_000,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });

    const request = await openReturnRequest(s.deps, {
      actor: { id: s.sender.id, role: "rider" },
      cityId: s.city.cityId,
      transferId: s.transfer.transferId,
    });

    await expect(
      respondToReturnRequest(s.deps, {
        actor: { id: s.recipient.id, role: "rider" },
        cityId: s.city.cityId,
        transferId: s.transfer.transferId,
        returnRequestId: request.returnRequestId,
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(await balanceOf(db, s.recipient.walletId, s.city.currency)).toEqual(
      money(100_000, s.city.currency),
    );
  });
});
