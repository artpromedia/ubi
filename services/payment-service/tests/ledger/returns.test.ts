import { allowedTransitions, canTransition, money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
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

afterAll(async () => {
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
