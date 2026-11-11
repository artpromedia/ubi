import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FleetOpsReviewBoardView } from "../FleetOpsReviewBoard";
import {
  ADMIN_FLEET_REVIEW_TEST_IDS,
  listAdminFleetDocuments,
  listAdminFleetKyb,
  reviewAdminFleetDocument,
  reviewAdminFleetKyb,
} from "@/lib/fleets-api";

describe("FleetOpsReviewBoardView (CC-C02 / P1-05)", () => {
  it("renders empty states for both KYB and vehicle document queues", () => {
    const markup = renderToStaticMarkup(
      <FleetOpsReviewBoardView applications={[]} documents={[]} />,
    );
    expect(markup).toContain(
      `data-testid="${ADMIN_FLEET_REVIEW_TEST_IDS.kyb.list}"`,
    );
    expect(markup).toContain(
      `data-testid="${ADMIN_FLEET_REVIEW_TEST_IDS.documents.list}"`,
    );
    expect(markup).toContain("No fleet KYB applications in queue.");
    expect(markup).toContain("No vehicle documents awaiting review.");
  });

  it("renders KYB applications and vehicle documents with all review controls and private links", () => {
    const markup = renderToStaticMarkup(
      <FleetOpsReviewBoardView
        applications={[
          {
            fleetId: "flt_1",
            name: "Eko Transit Fleet Ltd",
            cityId: "lagos",
            status: "pending_review",
            kybStatus: "pending_review",
            registrationNumber: "RC-998877",
            taxId: "TIN-1122",
            fields: { registered_address: "14 Broad St, Marina, Lagos" },
            declarationsAccepted: true,
            submittedAt: "2026-09-30T08:00:00.000Z",
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            requirementsConfigured: true,
            requirements: [],
            documents: [
              {
                kybDocumentId: "kdoc_1",
                requirementKey: "cac_certificate",
                uploadId: "fup_1",
                contentType: "application/pdf",
                sizeBytes: 2048,
                sha256Hex: "a".repeat(64),
                status: "pending",
                reviewNote: null,
                createdAt: "2026-09-30T08:00:00.000Z",
              },
            ],
          },
        ]}
        documents={[
          {
            documentId: "vdoc_1",
            vehicleId: "veh_1",
            fleetId: "flt_1",
            plate: "LAG-118-AB",
            docType: "insurance",
            uploadId: "fup_2",
            contentType: "application/pdf",
            sizeBytes: 4096,
            sha256Hex: "b".repeat(64),
            expiresAt: "2027-03-31T23:59:59.000Z",
            status: "pending",
            uploadedByUserId: "usr_owner",
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            createdAt: "2026-09-30T08:00:00.000Z",
          },
        ]}
      />,
    );

    for (const id of [
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.list,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.row,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.approve,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.requestChanges,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.reject,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.noteInput,
      ADMIN_FLEET_REVIEW_TEST_IDS.kyb.openDocument,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.list,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.row,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.approve,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.reject,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.noteInput,
      ADMIN_FLEET_REVIEW_TEST_IDS.documents.openDocument,
    ]) {
      expect(markup).toContain(`data-testid="${id}"`);
    }
    expect(markup).toContain("Eko Transit Fleet Ltd");
    expect(markup).toContain("RC-998877");
    expect(markup).toContain("14 Broad St, Marina, Lagos");
    expect(markup).toContain("LAG-118-AB");
  });

  it("calls gateway admin endpoints with Idempotency-Key on review actions", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (
          url.includes("/v1/admin/fleets/kyb") &&
          (!init?.method || init.method === "GET")
        ) {
          return new Response(JSON.stringify({ applications: [] }), {
            status: 200,
          });
        }
        if (
          url.includes("/v1/admin/fleet-documents") &&
          (!init?.method || init.method === "GET")
        ) {
          return new Response(JSON.stringify({ documents: [] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await listAdminFleetKyb({ status: "pending_review", cityId: "lagos" });
      await listAdminFleetDocuments({ status: "pending", cityId: "lagos" });
      await reviewAdminFleetKyb(
        "flt_1",
        { decision: "approved" },
        "idem-kyb-review-1",
      );
      await reviewAdminFleetDocument(
        "vdoc_1",
        { decision: "rejected", note: "Blurry scan" },
        "idem-doc-review-1",
      );

      expect(fetchMock).toHaveBeenCalledTimes(4);
      const kybReviewCall = fetchMock.mock.calls[2];
      expect(String(kybReviewCall?.[0])).toContain(
        "/v1/admin/fleets/flt_1/kyb/review",
      );
      const kybHeaders = kybReviewCall?.[1]?.headers as Record<string, string>;
      expect(kybHeaders["idempotency-key"]).toBe("idem-kyb-review-1");

      const docReviewCall = fetchMock.mock.calls[3];
      expect(String(docReviewCall?.[0])).toContain(
        "/v1/admin/fleet-documents/vdoc_1/review",
      );
      const docHeaders = docReviewCall?.[1]?.headers as Record<string, string>;
      expect(docHeaders["idempotency-key"]).toBe("idem-doc-review-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
