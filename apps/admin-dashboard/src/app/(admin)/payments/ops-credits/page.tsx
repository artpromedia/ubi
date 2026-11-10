"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import {
  OpsCreditsView,
  type OpsCreditsDialogState,
  type OpsCreditsFormState,
} from "@/components/payments/OpsCreditsView";
import { useAdminSession } from "@/components/providers/admin-session-provider";
import { formatServerMoney } from "@/lib/money";
import {
  majorUnitsToMinor,
  opsCreditsApi,
  type OpsCreditStatus,
} from "@/lib/ops-credits-api";

export default function OpsWalletCreditsPage(): ReactElement {
  const { session } = useAdminSession();
  const queryClient = useQueryClient();

  const [cityId, setCityId] = useState<string>(
    session?.user.homeCityId ?? "LOS",
  );
  const [statusFilter, setStatusFilter] =
    useState<OpsCreditStatus>("pending_approval");
  const [banner, setBanner] = useState<{
    tone: "ok" | "err" | "info";
    text: string;
  } | null>(null);
  const [form, setForm] = useState<OpsCreditsFormState>({
    driverUserId: "",
    amountMajor: "",
    reasonCode: "",
    reference: "",
    note: "",
  });
  const [dialog, setDialog] = useState<OpsCreditsDialogState | null>(null);

  const cityConfigQuery = useQuery({
    queryKey: ["opsCreditsCityConfig", cityId],
    queryFn: () => opsCreditsApi.cityConfig(cityId),
    enabled: cityId.trim().length > 0,
  });

  const cityFlagsQuery = useQuery({
    queryKey: ["opsCreditsCityFlags", cityId],
    queryFn: () => opsCreditsApi.cityFlags(cityId),
    enabled: cityId.trim().length > 0,
  });

  const creditsQuery = useQuery({
    queryKey: ["opsCreditsList", cityId, statusFilter],
    queryFn: () =>
      opsCreditsApi.list({
        cityId,
        status: statusFilter,
        limit: 100,
      }),
    enabled: cityId.trim().length > 0 && session?.mode !== "limited",
  });

  useEffect(() => {
    const firstReason =
      cityConfigQuery.data?.opsCreditPolicy?.reasonCodes[0] ?? "";
    if (!form.reasonCode && firstReason) {
      setForm((prev) => ({ ...prev, reasonCode: firstReason }));
    }
  }, [cityConfigQuery.data?.opsCreditPolicy?.reasonCodes, form.reasonCode]);

  const invalidateCredits = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: ["opsCreditsList", cityId],
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const fractionDigits = cityConfigQuery.data?.currencyFractionDigits ?? 2;
      const amountMinor = majorUnitsToMinor(form.amountMajor, fractionDigits);
      if (amountMinor === null) {
        throw new Error("Enter a positive whole-unit credit amount.");
      }
      if (!form.driverUserId.trim()) {
        throw new Error("Enter the target driver user ID.");
      }
      if (!form.reasonCode.trim()) {
        throw new Error("Select a configured reason code.");
      }
      return opsCreditsApi.create({
        cityId,
        driverUserId: form.driverUserId.trim(),
        amountMinor,
        reasonCode: form.reasonCode.trim(),
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
    },
    onSuccess: async (res) => {
      setBanner({
        tone: "ok",
        text: `Credit ${res.credit.id} (${formatServerMoney(res.credit.amount)}) is pending approval. A second operator must approve before funds post.`,
      });
      setForm((prev) => ({
        ...prev,
        driverUserId: "",
        amountMajor: "",
        reference: "",
        note: "",
      }));
      setStatusFilter("pending_approval");
      await invalidateCredits();
    },
    onError: (err) => {
      setBanner({
        tone: "err",
        text: `Request failed: ${(err as Error).message}`,
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (creditId: string) => opsCreditsApi.approve(creditId),
    onSuccess: async (res) => {
      setBanner({
        tone: "ok",
        text: `Credit ${res.credit.id} approved and posted (entry ${res.credit.entryId ?? "—"}). Driver wallet balance is now ${formatServerMoney(res.balanceAfter)}.`,
      });
      await invalidateCredits();
    },
    onError: (err) => {
      setBanner({
        tone: "err",
        text: `Approval failed: ${(err as Error).message}`,
      });
    },
  });

  const dialogMutation = useMutation({
    mutationFn: async (current: OpsCreditsDialogState) => {
      const trimmed = current.reason.trim();
      if (current.mode === "reject") {
        const res = await opsCreditsApi.reject(current.creditId, trimmed);
        return { mode: "reject" as const, credit: res.credit };
      }
      const res = await opsCreditsApi.reverse(current.creditId, trimmed);
      return {
        mode: "reverse" as const,
        credit: res.credit,
        balanceAfter: res.balanceAfter,
      };
    },
    onSuccess: async (res) => {
      setDialog(null);
      setBanner({
        tone: "ok",
        text:
          res.mode === "reject"
            ? `Credit ${res.credit.id} rejected.`
            : `Credit ${res.credit.id} reversed (entry ${res.credit.reversalEntryId ?? "—"}). Driver wallet balance is now ${formatServerMoney(res.balanceAfter)}.`,
      });
      await invalidateCredits();
    },
    onError: (err) => {
      setBanner({
        tone: "err",
        text: `Action failed: ${(err as Error).message}`,
      });
    },
  });

  const isSubmitting =
    createMutation.isPending ||
    approveMutation.isPending ||
    dialogMutation.isPending;

  const handleSubmitCreate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setBanner(null);
    createMutation.mutate();
  };

  const handleConfirmDialog = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!dialog) {
      return;
    }
    setBanner(null);
    dialogMutation.mutate(dialog);
  };

  return (
    <OpsCreditsView
      session={session}
      cityId={cityId}
      onCityIdChange={(next) => {
        setCityId(next);
        setBanner(null);
        setDialog(null);
      }}
      statusFilter={statusFilter}
      onStatusFilterChange={(next) => {
        setStatusFilter(next);
        setDialog(null);
      }}
      cityConfig={cityConfigQuery.data}
      flagEnabled={Boolean(cityFlagsQuery.data?.ops_driver_wallet_credit)}
      credits={creditsQuery.data ?? []}
      isLoading={creditsQuery.isLoading}
      errorMessage={
        creditsQuery.isError ? (creditsQuery.error as Error).message : null
      }
      banner={banner}
      form={form}
      onFormChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
      onSubmitCreate={handleSubmitCreate}
      isSubmitting={isSubmitting}
      onApprove={(creditId) => {
        setBanner(null);
        approveMutation.mutate(creditId);
      }}
      dialog={dialog}
      onOpenDialog={(next) => {
        setBanner(null);
        setDialog(next);
      }}
      onDialogReasonChange={(reason) =>
        setDialog((prev) => (prev ? { ...prev, reason } : null))
      }
      onCancelDialog={() => setDialog(null)}
      onConfirmDialog={handleConfirmDialog}
    />
  );
}
