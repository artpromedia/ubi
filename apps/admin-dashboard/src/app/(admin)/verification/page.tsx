"use client";

import { cn, formatDate, formatRelativeTime } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Image,
  RefreshCw,
  Search,
  User,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";

// Types
interface VerificationDocument {
  id: string;
  type: "front" | "back" | "selfie";
  url: string;
  uploadedAt: string;
  qualityScore: number;
}

interface PendingVerification {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  userType: "rider" | "driver" | "courier";
  verificationType: string;
  documentType: string;
  documentCountry: string;
  status: "pending" | "in_review" | "needs_info" | "approved" | "rejected";
  documents: VerificationDocument[];
  extractedData: {
    fullName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    address?: string;
  };
  confidenceScore: number;
  livenessScore?: number;
  faceMatchScore?: number;
  submittedAt: string;
  assignedTo?: string;
  notes: string[];
  priority: "low" | "medium" | "high" | "urgent";
}

// Mock data
const mockVerifications: PendingVerification[] = [
  {
    id: "VER-001",
    userId: "USR-123",
    userName: "Chidi Okonkwo",
    userEmail: "chidi@email.com",
    userPhone: "+234 801 234 5678",
    userType: "driver",
    verificationType: "GOVERNMENT_ID",
    documentType: "NIN",
    documentCountry: "NG",
    status: "pending",
    documents: [
      {
        id: "doc-1",
        type: "front",
        url: "/placeholder-id-front.jpg",
        uploadedAt: "2024-12-10T10:30:00Z",
        qualityScore: 0.92,
      },
      {
        id: "doc-2",
        type: "back",
        url: "/placeholder-id-back.jpg",
        uploadedAt: "2024-12-10T10:30:00Z",
        qualityScore: 0.89,
      },
      {
        id: "doc-3",
        type: "selfie",
        url: "/placeholder-selfie.jpg",
        uploadedAt: "2024-12-10T10:31:00Z",
        qualityScore: 0.95,
      },
    ],
    extractedData: {
      fullName: "CHIDI EMMANUEL OKONKWO",
      dateOfBirth: "1990-05-15",
      documentNumber: "12345678901",
      address: "15 Admiralty Way, Lekki, Lagos",
    },
    confidenceScore: 0.94,
    livenessScore: 0.98,
    faceMatchScore: 0.96,
    submittedAt: "2024-12-10T10:30:00Z",
    notes: [],
    priority: "high",
  },
  {
    id: "VER-002",
    userId: "USR-456",
    userName: "Amina Yusuf",
    userEmail: "amina@email.com",
    userPhone: "+254 712 345 678",
    userType: "driver",
    verificationType: "DRIVERS_LICENSE",
    documentType: "DRIVERS_LICENSE_KE",
    documentCountry: "KE",
    status: "in_review",
    documents: [
      {
        id: "doc-4",
        type: "front",
        url: "/placeholder-license-front.jpg",
        uploadedAt: "2024-12-09T14:20:00Z",
        qualityScore: 0.85,
      },
      {
        id: "doc-5",
        type: "selfie",
        url: "/placeholder-selfie-2.jpg",
        uploadedAt: "2024-12-09T14:21:00Z",
        qualityScore: 0.91,
      },
    ],
    extractedData: {
      fullName: "AMINA HASSAN YUSUF",
      dateOfBirth: "1988-09-22",
      documentNumber: "KE-DL-789456",
      expiryDate: "2026-09-22",
    },
    confidenceScore: 0.87,
    livenessScore: 0.95,
    faceMatchScore: 0.72,
    submittedAt: "2024-12-09T14:20:00Z",
    assignedTo: "Admin User",
    notes: ["Face match score below threshold - manual review required"],
    priority: "urgent",
  },
  {
    id: "VER-003",
    userId: "USR-789",
    userName: "Kofi Mensah",
    userEmail: "kofi@email.com",
    userPhone: "+233 20 987 6543",
    userType: "courier",
    verificationType: "GOVERNMENT_ID",
    documentType: "GHANA_CARD",
    documentCountry: "GH",
    status: "needs_info",
    documents: [
      {
        id: "doc-6",
        type: "front",
        url: "/placeholder-ghana-card.jpg",
        uploadedAt: "2024-12-08T09:15:00Z",
        qualityScore: 0.65,
      },
    ],
    extractedData: {
      fullName: "KOFI MENSAH",
      documentNumber: "GHA-XXX-XXXXX",
    },
    confidenceScore: 0.58,
    submittedAt: "2024-12-08T09:15:00Z",
    notes: ["Image quality too low", "Back of document required"],
    priority: "medium",
  },
];

const statusConfig = {
  pending: {
    label: "Pending Review",
    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    icon: Clock,
  },
  in_review: {
    label: "In Review",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Eye,
  },
  needs_info: {
    label: "Needs Info",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    icon: AlertCircle,
  },
  approved: {
    label: "Approved",
    color: "bg-green-500/10 text-green-400 border-green-500/20",
    icon: Check,
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-500/10 text-red-400 border-red-500/20",
    icon: X,
  },
};

const priorityConfig = {
  low: { label: "Low", color: "text-gray-400" },
  medium: { label: "Medium", color: "text-yellow-400" },
  high: { label: "High", color: "text-orange-400" },
  urgent: { label: "Urgent", color: "text-red-400" },
};

export default function VerificationPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedVerification, setSelectedVerification] =
    useState<PendingVerification | null>(null);
  const [verifications, setVerifications] =
    useState<PendingVerification[]>(mockVerifications);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredVerifications = verifications.filter((v) => {
    const matchesSearch =
      v.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.userEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      selectedStatus === "all" || v.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const handleApprove = (id: string) => {
    setVerifications((prev) =>
      prev.map((v) =>
        v.id === id ? { ...v, status: "approved" as const } : v,
      ),
    );
    setSelectedVerification(null);
  };

  const handleReject = (id: string, reason: string) => {
    setVerifications((prev) =>
      prev.map((v) =>
        v.id === id
          ? { ...v, status: "rejected" as const, notes: [...v.notes, reason] }
          : v,
      ),
    );
    setSelectedVerification(null);
  };

  const handleRequestInfo = (id: string, info: string) => {
    setVerifications((prev) =>
      prev.map((v) =>
        v.id === id
          ? { ...v, status: "needs_info" as const, notes: [...v.notes, info] }
          : v,
      ),
    );
    setSelectedVerification(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Document Verification
          </h1>
          <p className="text-gray-400">
            Review and approve user identity documents
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
            <Download className="h-4 w-4" />
            Export
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          {
            label: "Pending",
            value: verifications.filter((v) => v.status === "pending").length,
            color: "text-yellow-400",
          },
          {
            label: "In Review",
            value: verifications.filter((v) => v.status === "in_review").length,
            color: "text-blue-400",
          },
          {
            label: "Needs Info",
            value: verifications.filter((v) => v.status === "needs_info")
              .length,
            color: "text-orange-400",
          },
          {
            label: "Approved Today",
            value: 24,
            color: "text-green-400",
          },
          {
            label: "Rejected Today",
            value: 3,
            color: "text-red-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-gray-900 rounded-xl border border-gray-800 p-4"
          >
            <p className="text-sm text-gray-400">{stat.label}</p>
            <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by name, email, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
          />
        </div>

        <div className="flex gap-2">
          {["all", "pending", "in_review", "needs_info"].map((status) => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                selectedStatus === status
                  ? "bg-green-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700",
              )}
            >
              {status === "all"
                ? "All"
                : status
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
            </button>
          ))}
        </div>
      </div>

      {/* Verification Queue */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Document
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Scores
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Priority
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Submitted
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredVerifications.map((verification) => {
                const StatusIcon = statusConfig[verification.status].icon;
                return (
                  <tr
                    key={verification.id}
                    className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedVerification(verification)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-medium">
                          {verification.userName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {verification.userName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {verification.userEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-white">
                            {verification.documentType.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-gray-400">
                            {verification.documentCountry}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">OCR:</span>
                          <span
                            className={cn(
                              "text-xs font-medium",
                              verification.confidenceScore >= 0.9
                                ? "text-green-400"
                                : verification.confidenceScore >= 0.7
                                  ? "text-yellow-400"
                                  : "text-red-400",
                            )}
                          >
                            {Math.round(verification.confidenceScore * 100)}%
                          </span>
                        </div>
                        {verification.faceMatchScore && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">Face:</span>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                verification.faceMatchScore >= 0.9
                                  ? "text-green-400"
                                  : verification.faceMatchScore >= 0.75
                                    ? "text-yellow-400"
                                    : "text-red-400",
                              )}
                            >
                              {Math.round(verification.faceMatchScore * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border",
                          statusConfig[verification.status].color,
                        )}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusConfig[verification.status].label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          priorityConfig[verification.priority].color,
                        )}
                      >
                        {priorityConfig[verification.priority].label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                      {formatRelativeTime(new Date(verification.submittedAt))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVerification(verification);
                        }}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
          <p className="text-sm text-gray-400">
            Showing {filteredVerifications.length} of {verifications.length}{" "}
            verifications
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-400">Page {currentPage}</span>
            <button
              onClick={() => setCurrentPage((p) => p + 1)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Verification Detail Modal */}
      <AnimatePresence>
        {selectedVerification && (
          <VerificationDetailModal
            verification={selectedVerification}
            onClose={() => setSelectedVerification(null)}
            onApprove={() => handleApprove(selectedVerification.id)}
            onReject={(reason) => handleReject(selectedVerification.id, reason)}
            onRequestInfo={(info) =>
              handleRequestInfo(selectedVerification.id, info)
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Verification Detail Modal Component
interface VerificationDetailModalProps {
  verification: PendingVerification;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onRequestInfo: (info: string) => void;
}

function VerificationDetailModal({
  verification,
  onClose,
  onApprove,
  onReject,
  onRequestInfo,
}: Readonly<VerificationDetailModalProps>) {
  const [activeTab, setActiveTab] = useState<"documents" | "data" | "history">(
    "documents",
  );
  const [rejectReason, setRejectReason] = useState("");
  const [infoRequest, setInfoRequest] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showInfoForm, setShowInfoForm] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-4xl max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-medium text-lg">
              {verification.userName
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {verification.userName}
              </h2>
              <p className="text-sm text-gray-400">{verification.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {[
            { id: "documents" as const, label: "Documents", icon: Image },
            { id: "data" as const, label: "Extracted Data", icon: FileText },
            { id: "history" as const, label: "History", icon: Clock },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "text-green-400 border-b-2 border-green-400"
                  : "text-gray-400 hover:text-white",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-240px)]">
          {activeTab === "documents" && (
            <div className="space-y-6">
              {/* Scores Summary */}
              <div className="grid grid-cols-3 gap-4">
                <ScoreCard
                  label="OCR Confidence"
                  value={verification.confidenceScore}
                  icon={FileText}
                />
                {verification.livenessScore && (
                  <ScoreCard
                    label="Liveness Score"
                    value={verification.livenessScore}
                    icon={Zap}
                  />
                )}
                {verification.faceMatchScore && (
                  <ScoreCard
                    label="Face Match"
                    value={verification.faceMatchScore}
                    icon={User}
                  />
                )}
              </div>

              {/* Document Images */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {verification.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-gray-800 rounded-xl overflow-hidden"
                  >
                    <div className="aspect-[4/3] bg-gray-700 flex items-center justify-center">
                      <Image className="h-12 w-12 text-gray-500" />
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium text-white capitalize">
                        {doc.type}
                      </p>
                      <p className="text-xs text-gray-400">
                        Quality: {Math.round(doc.qualityScore * 100)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {verification.notes.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-yellow-400 mb-2">
                    Notes
                  </h4>
                  <ul className="space-y-1">
                    {verification.notes.map((note, i) => (
                      <li key={i} className="text-sm text-yellow-300">
                        • {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {activeTab === "data" && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Extracted Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(verification.extractedData).map(
                  ([key, value]) => (
                    <div key={key} className="bg-gray-800 rounded-lg p-4">
                      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </p>
                      <p className="text-white font-medium">{value || "—"}</p>
                    </div>
                  ),
                )}
              </div>

              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-6">
                User Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                    Email
                  </p>
                  <p className="text-white">{verification.userEmail}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                    Phone
                  </p>
                  <p className="text-white">{verification.userPhone}</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                    User Type
                  </p>
                  <p className="text-white capitalize">
                    {verification.userType}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                    User ID
                  </p>
                  <p className="text-white">{verification.userId}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 pb-4 border-b border-gray-800">
                <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <FileText className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-white">Documents submitted</p>
                  <p className="text-xs text-gray-400">
                    {formatDate(new Date(verification.submittedAt))}
                  </p>
                </div>
              </div>
              {verification.assignedTo && (
                <div className="flex items-start gap-4 pb-4 border-b border-gray-800">
                  <div className="h-8 w-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <User className="h-4 w-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white">
                      Assigned to {verification.assignedTo}
                    </p>
                    <p className="text-xs text-gray-400">Just now</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-800 bg-gray-900/50">
          {!showRejectForm && !showInfoForm ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowInfoForm(true)}
                  className="px-4 py-2 text-sm font-medium text-orange-400 bg-orange-500/10 rounded-lg hover:bg-orange-500/20 transition-colors"
                >
                  Request Info
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  Reject
                </button>
              </div>
              <button
                onClick={onApprove}
                className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
              >
                <Check className="h-4 w-4 inline mr-2" />
                Approve Verification
              </button>
            </div>
          ) : showRejectForm ? (
            <div className="space-y-3">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter rejection reason..."
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                rows={3}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectReason("");
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onReject(rejectReason)}
                  disabled={!rejectReason.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={infoRequest}
                onChange={(e) => setInfoRequest(e.target.value)}
                placeholder="What information is needed from the user..."
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                rows={3}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowInfoForm(false);
                    setInfoRequest("");
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onRequestInfo(infoRequest)}
                  disabled={!infoRequest.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                >
                  Send Request
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Score Card Component
function ScoreCard({
  label,
  value,
  icon: Icon,
}: Readonly<{
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}>) {
  const percentage = Math.round(value * 100);
  const getScoreColor = (pct: number) => {
    if (pct >= 90) return "text-green-400";
    if (pct >= 75) return "text-yellow-400";
    return "text-red-400";
  };
  const color = getScoreColor(percentage);

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", color)} />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", color)}>{percentage}%</p>
    </div>
  );
}
