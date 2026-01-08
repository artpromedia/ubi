import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/app_router.dart';
import '../../../profile/bloc/driver_profile_bloc.dart';

/// Documents management page showing document list with status
class DocumentsPage extends StatefulWidget {
  const DocumentsPage({super.key});

  @override
  State<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends State<DocumentsPage> {
  @override
  void initState() {
    super.initState();
    context.read<DriverProfileBloc>().add(const LoadDriverDocuments());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Documents'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: BlocBuilder<DriverProfileBloc, DriverProfileState>(
        builder: (context, state) {
          if (state is DriverProfileLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is DriverDocumentsLoaded) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Status summary
                  _buildStatusSummary(context, state.documents),
                  const SizedBox(height: 24),

                  // All documents
                  Text(
                    'Your Documents',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 12),
                  ...state.documents
                      .map((doc) => _buildDocumentCard(context, doc)),
                ],
              ),
            );
          }

          return const Center(child: Text('No documents found'));
        },
      ),
    );
  }

  Widget _buildStatusSummary(
      BuildContext context, List<DriverDocument> documents) {
    final approved = documents.where((d) => d.status == DocumentStatus.approved).length;
    final pending = documents.where((d) => d.status == DocumentStatus.pending).length;
    final rejected = documents.where((d) => d.status == DocumentStatus.rejected).length;
    final expiringSoon = documents.where((d) => d.status == DocumentStatus.expiringSoon).length;

    Color statusColor;
    String statusText;
    IconData statusIcon;

    if (rejected > 0) {
      statusColor = Colors.red;
      statusText = '$rejected document(s) rejected';
      statusIcon = Icons.error;
    } else if (expiringSoon > 0) {
      statusColor = Colors.orange;
      statusText = '$expiringSoon document(s) expiring soon';
      statusIcon = Icons.warning;
    } else if (pending > 0) {
      statusColor = Colors.orange;
      statusText = '$pending document(s) pending review';
      statusIcon = Icons.hourglass_empty;
    } else {
      statusColor = Colors.green;
      statusText = 'All documents approved';
      statusIcon = Icons.check_circle;
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: statusColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
            ),
            child: Icon(
              statusIcon,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  statusText,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: statusColor,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$approved of ${documents.length} approved',
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          // Progress indicator
          SizedBox(
            width: 50,
            height: 50,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: approved / documents.length,
                  strokeWidth: 4,
                  backgroundColor: Colors.grey.shade200,
                  valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                ),
                Text(
                  '${((approved / documents.length) * 100).round()}%',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDocumentCard(BuildContext context, DriverDocument document) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: InkWell(
        onTap: () => _showDocumentDetails(context, document),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: _getStatusColor(document.status).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  _getDocumentIcon(document.type),
                  color: _getStatusColor(document.status),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _getDocumentTitle(document.type),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildStatusBadge(document.status),
                    if (document.expiryDate != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Expires: ${_formatDate(document.expiryDate!)}',
                        style: TextStyle(
                          color: _isExpiringSoon(document.expiryDate!)
                              ? Colors.orange
                              : Colors.grey.shade600,
                          fontSize: 12,
                        ),
                      ),
                    ],
                    if (document.rejectionReason != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        document.rejectionReason!,
                        style: const TextStyle(
                          color: Colors.red,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              _buildActionButton(context, document),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(DocumentStatus status) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: _getStatusColor(status).withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        _getStatusText(status),
        style: TextStyle(
          color: _getStatusColor(status),
          fontWeight: FontWeight.bold,
          fontSize: 11,
        ),
      ),
    );
  }

  Widget _buildActionButton(BuildContext context, DriverDocument document) {
    switch (document.status) {
      case DocumentStatus.pending:
        return const Icon(Icons.hourglass_empty, color: Colors.orange);
      case DocumentStatus.rejected:
      case DocumentStatus.expired:
        return OutlinedButton(
          onPressed: () => context.push(
            AppRoutes.uploadDocument,
            extra: document.type.name,
          ),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            minimumSize: const Size(0, 36),
            foregroundColor: Colors.orange,
            side: const BorderSide(color: Colors.orange),
          ),
          child: const Text('Reupload'),
        );
      case DocumentStatus.expiringSoon:
        return const Icon(Icons.warning, color: Colors.orange);
      case DocumentStatus.approved:
        return const Icon(Icons.check_circle, color: Colors.green);
    }
  }

  Color _getStatusColor(DocumentStatus status) {
    switch (status) {
      case DocumentStatus.approved:
        return Colors.green;
      case DocumentStatus.pending:
        return Colors.orange;
      case DocumentStatus.expiringSoon:
        return Colors.orange;
      case DocumentStatus.rejected:
        return Colors.red;
      case DocumentStatus.expired:
        return Colors.red;
    }
  }

  String _getStatusText(DocumentStatus status) {
    switch (status) {
      case DocumentStatus.approved:
        return 'APPROVED';
      case DocumentStatus.pending:
        return 'PENDING';
      case DocumentStatus.expiringSoon:
        return 'EXPIRING SOON';
      case DocumentStatus.rejected:
        return 'REJECTED';
      case DocumentStatus.expired:
        return 'EXPIRED';
    }
  }

  IconData _getDocumentIcon(DocumentType type) {
    switch (type) {
      case DocumentType.driverLicense:
        return Icons.badge;
      case DocumentType.nationalId:
        return Icons.credit_card;
      case DocumentType.vehicleRegistration:
        return Icons.directions_car;
      case DocumentType.insurance:
        return Icons.security;
      case DocumentType.goodConduct:
        return Icons.verified_user;
      case DocumentType.psvBadge:
        return Icons.local_taxi;
      case DocumentType.vehicleInspection:
        return Icons.build;
      case DocumentType.profilePhoto:
        return Icons.person;
    }
  }

  String _getDocumentTitle(DocumentType type) {
    switch (type) {
      case DocumentType.driverLicense:
        return 'Driver\'s License';
      case DocumentType.nationalId:
        return 'National ID';
      case DocumentType.vehicleRegistration:
        return 'Vehicle Registration';
      case DocumentType.insurance:
        return 'Insurance Certificate';
      case DocumentType.goodConduct:
        return 'Good Conduct Certificate';
      case DocumentType.psvBadge:
        return 'PSV Badge';
      case DocumentType.vehicleInspection:
        return 'Vehicle Inspection';
      case DocumentType.profilePhoto:
        return 'Profile Photo';
    }
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }

  bool _isExpiringSoon(DateTime expiryDate) {
    final now = DateTime.now();
    final difference = expiryDate.difference(now).inDays;
    return difference <= 30 && difference > 0;
  }

  void _showDocumentDetails(BuildContext context, DriverDocument document) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                Row(
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: _getStatusColor(document.status).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        _getDocumentIcon(document.type),
                        color: _getStatusColor(document.status),
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _getDocumentTitle(document.type),
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 18,
                            ),
                          ),
                          const SizedBox(height: 4),
                          _buildStatusBadge(document.status),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Document details
                _buildDetailRow(
                  'Status',
                  _getStatusText(document.status),
                  _getStatusColor(document.status),
                ),
                if (document.expiryDate != null) ...[
                  const SizedBox(height: 12),
                  _buildDetailRow(
                    'Expiry Date',
                    _formatDate(document.expiryDate!),
                    _isExpiringSoon(document.expiryDate!)
                        ? Colors.orange
                        : Colors.grey.shade700,
                  ),
                ],
                const SizedBox(height: 12),
                _buildDetailRow(
                  'Uploaded',
                  _formatDate(document.uploadedAt),
                  Colors.grey.shade700,
                ),
                if (document.rejectionReason != null) ...[
                  const SizedBox(height: 12),
                  _buildDetailRow(
                    'Rejection Reason',
                    document.rejectionReason!,
                    Colors.red,
                  ),
                ],

                const SizedBox(height: 24),

                // Actions
                if (document.status == DocumentStatus.rejected ||
                    document.status == DocumentStatus.expired ||
                    document.status == DocumentStatus.expiringSoon) ...[
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        context.push(
                          AppRoutes.uploadDocument,
                          extra: document.type.name,
                        );
                      },
                      icon: const Icon(Icons.upload),
                      label: Text(
                        document.status == DocumentStatus.expiringSoon
                            ? 'Upload New Document'
                            : 'Reupload Document',
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.orange,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ] else if (document.status == DocumentStatus.pending) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.hourglass_empty, color: Colors.orange),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'This document is being reviewed. We\'ll notify you once it\'s approved.',
                            style: TextStyle(
                              color: Colors.orange.shade800,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ] else if (document.status == DocumentStatus.approved) ...[
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.green.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle, color: Colors.green),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'This document has been verified and approved.',
                            style: TextStyle(
                              color: Colors.green.shade800,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, Color valueColor) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 14,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.w500,
              color: valueColor,
              fontSize: 14,
            ),
          ),
        ),
      ],
    );
  }
}
