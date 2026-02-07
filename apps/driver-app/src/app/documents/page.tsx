"use client";

import { useDriverDocuments } from "@/lib/hooks";
import {
  AlertCircle,
  Camera,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

type DocumentStatus = "verified" | "pending" | "rejected" | "missing";

interface Document {
  id: string;
  name: string;
  description: string;
  status: DocumentStatus;
  expiresAt?: string;
  rejectionReason?: string;
  isRequired: boolean;
}

const mockDocuments: Document[] = [
  {
    id: "license",
    name: "Driver's License",
    description: "Valid driving license for your vehicle class",
    status: "verified",
    expiresAt: "2027-06-15",
    isRequired: true,
  },
  {
    id: "id",
    name: "National ID / Passport",
    description: "Government-issued identification",
    status: "verified",
    isRequired: true,
  },
  {
    id: "insurance",
    name: "Vehicle Insurance",
    description: "Comprehensive vehicle insurance certificate",
    status: "pending",
    isRequired: true,
  },
  {
    id: "psv",
    name: "PSV License",
    description: "Public Service Vehicle license (if applicable)",
    status: "rejected",
    rejectionReason: "Document is expired. Please upload a valid copy.",
    isRequired: true,
  },
  {
    id: "goodconduct",
    name: "Certificate of Good Conduct",
    description: "Police clearance certificate",
    status: "missing",
    isRequired: true,
  },
  {
    id: "logbook",
    name: "Vehicle Logbook",
    description: "Vehicle registration document",
    status: "verified",
    isRequired: false,
  },
];

export default function DocumentsPage() {
  // Fetch documents from API
  const { data: apiDocuments } = useDriverDocuments();

  // Transform API documents or use mock data
  const documents: Document[] = useMemo(() => {
    if (apiDocuments && apiDocuments.length > 0) {
      return apiDocuments.map((doc) => ({
        id: doc.id,
        name:
          doc.type.charAt(0).toUpperCase() +
          doc.type.slice(1).replaceAll("_", " "),
        description: `Your ${doc.type.replaceAll("_", " ").toLowerCase()}`,
        status: doc.status as DocumentStatus,
        expiresAt: doc.expiresAt,
        rejectionReason: doc.rejectionReason,
        isRequired: true,
      }));
    }
    return mockDocuments;
  }, [apiDocuments]);

  const getStatusSummary = () => {
    const pending = documents.filter((d) => d.status === "pending").length;
    const rejected = documents.filter((d) => d.status === "rejected").length;
    const missing = documents.filter(
      (d) => d.status === "missing" && d.isRequired,
    ).length;

    if (rejected > 0)
      return {
        color: "red",
        text: `${rejected} document(s) need attention`,
        icon: <XCircle className="h-6 w-6" />,
      };
    if (pending > 0)
      return {
        color: "yellow",
        text: `${pending} document(s) under review`,
        icon: <Clock className="h-6 w-6" />,
      };
    if (missing > 0)
      return {
        color: "gray",
        text: `${missing} required document(s) missing`,
        icon: <AlertCircle className="h-6 w-6" />,
      };
    return {
      color: "green",
      text: "All documents verified",
      icon: <CheckCircle className="h-6 w-6" />,
    };
  };

  const summary = getStatusSummary();
  const colorClasses = {
    red: "bg-red-50 border-red-200 text-red-600",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-600",
    gray: "bg-gray-50 border-gray-200 text-gray-600",
    green: "bg-green-50 border-green-200 text-green-600",
  };

  const requiredDocs = documents.filter((d) => d.isRequired);
  const optionalDocs = documents.filter((d) => !d.isRequired);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Documents</h1>
          </div>
        </div>

        <div className="px-4 py-6">
          {/* Status Summary */}
          <div
            className={`rounded-xl border p-4 ${colorClasses[summary.color as keyof typeof colorClasses]}`}
          >
            <div className="flex items-center gap-3">
              {summary.icon}
              <p className="font-medium">{summary.text}</p>
            </div>
          </div>

          {/* Required Documents */}
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-500">
              REQUIRED DOCUMENTS
            </h2>
            <div className="space-y-3">
              {requiredDocs.map((doc) => (
                <DocumentCard key={doc.id} document={doc} />
              ))}
            </div>
          </div>

          {/* Optional Documents */}
          {optionalDocs.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-semibold text-gray-500">
                OPTIONAL DOCUMENTS
              </h2>
              <div className="space-y-3">
                {optionalDocs.map((doc) => (
                  <DocumentCard key={doc.id} document={doc} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentCard({ document }: Readonly<{ document: Document }>) {
  const statusConfig = {
    verified: {
      color: "text-green-600",
      bg: "bg-green-100",
      icon: <CheckCircle className="h-5 w-5" />,
      label: "Verified",
    },
    pending: {
      color: "text-yellow-600",
      bg: "bg-yellow-100",
      icon: <Clock className="h-5 w-5" />,
      label: "Under Review",
    },
    rejected: {
      color: "text-red-600",
      bg: "bg-red-100",
      icon: <XCircle className="h-5 w-5" />,
      label: "Rejected",
    },
    missing: {
      color: "text-gray-400",
      bg: "bg-gray-100",
      icon: <Upload className="h-5 w-5" />,
      label: "Not Uploaded",
    },
  };

  const config = statusConfig[document.status];

  return (
    <Link
      href={`/documents/${document.id}`}
      className="block rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl ${config.bg}`}
        >
          <FileText className={`h-6 w-6 ${config.color}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-gray-900">{document.name}</p>
              <p className="mt-1 text-sm text-gray-500">
                {document.description}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </div>

          {/* Status Badge */}
          <div className="mt-3 flex items-center gap-2">
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-1 ${config.bg}`}
            >
              <span className={`text-xs ${config.color}`}>{config.icon}</span>
              <span className={`text-xs font-medium ${config.color}`}>
                {config.label}
              </span>
            </div>

            {document.expiresAt && document.status === "verified" && (
              <span className="text-xs text-gray-400">
                Expires: {new Date(document.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Rejection Reason */}
          {document.status === "rejected" && document.rejectionReason && (
            <div className="mt-2 rounded-lg bg-red-50 p-2">
              <p className="text-xs text-red-600">{document.rejectionReason}</p>
            </div>
          )}
        </div>
      </div>

      {/* Upload Button for Missing/Rejected */}
      {(document.status === "missing" || document.status === "rejected") && (
        <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-gray-500 hover:border-primary hover:text-primary">
          <Camera className="h-5 w-5" />
          {document.status === "missing"
            ? "Upload Document"
            : "Re-upload Document"}
        </button>
      )}
    </Link>
  );
}
