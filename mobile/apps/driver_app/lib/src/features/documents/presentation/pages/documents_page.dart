import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../bloc/driver_profile_bloc.dart';

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
    context.read<DriverProfileBloc>().add(const DocumentsLoaded());
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

                  // Required documents
                  Text(
                    'Required Documents',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 12),
                  ...state.documents
                      .where((doc) => doc.isRequired)
                      .map((doc) => _buildDocumentCard(context, doc)),
                  const SizedBox(height: 24),

                  // Optional documents
                  if (state.documents.any((doc) => !doc.isRequired)) ...[
                    Text(
                      'Optional Documents',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 12),
                    ...state.documents
                        .where((doc) => !doc.isRequired)
                        .map((doc) => _buildDocumentCard(context, doc)),
                  ],
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
    final verified = documents.where((d) => d.status == DocumentStatus.verified).length;
    final pending = documents.where((d) => d.status == DocumentStatus.pending).length;
    final rejected = documents.where((d) => d.status == DocumentStatus.rejected).length;
    final missing = documents.where((d) => d.status == DocumentStatus.missing).length;

    Color statusColor;
    String statusText;
    IconData statusIcon;

    if (rejected > 0) {
      statusColor = Colors.red;
      statusText = '$rejected document(s) rejected';
      statusIcon = Icons.error;
    } else if (pending > 0) {
      statusColor = Colors.orange;
      statusText = '$pending document(s) pending review';
      statusIcon = Icons.hourglass_empty;
    } else if (missing > 0) {
      statusColor = Colors.grey;
      statusText = '$missing document(s) missing';
      statusIcon = Icons.upload_file;
    } else {
      statusColor = Colors.green;
      statusText = 'All documents verified';
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
                  '$verified of ${documents.length} verified',
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
                  value: verified / documents.length,
                  strokeWidth: 4,
                  backgroundColor: Colors.grey.shade200,
                  valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                ),
                Text(
                  '${((verified / documents.length) * 100).round()}%',
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
        onTap: () {
          if (document.status == DocumentStatus.missing ||
              document.status == DocumentStatus.rejected ||
              document.status == DocumentStatus.expired) {
            context.push(
              AppRoutes.uploadDocument,
              extra: document.type.name,
            );
          }
        },
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
                        'Expires: ${document.expiryDate}',
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
      case DocumentStatus.missing:
        return ElevatedButton(
          onPressed: () => context.push(
            AppRoutes.uploadDocument,
            extra: document.type.name,
          ),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            minimumSize: const Size(0, 36),
          ),
          child: const Text('Upload'),
        );
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
      case DocumentStatus.pending:
        return const Icon(Icons.hourglass_empty, color: Colors.orange);
      case DocumentStatus.verified:
        return const Icon(Icons.check_circle, color: Colors.green);
    }
  }

  Color _getStatusColor(DocumentStatus status) {
    switch (status) {
      case DocumentStatus.verified:
        return Colors.green;
      case DocumentStatus.pending:
        return Colors.orange;
      case DocumentStatus.rejected:
        return Colors.red;
      case DocumentStatus.expired:
        return Colors.red;
      case DocumentStatus.missing:
        return Colors.grey;
    }
  }

  String _getStatusText(DocumentStatus status) {
    switch (status) {
      case DocumentStatus.verified:
        return 'VERIFIED';
      case DocumentStatus.pending:
        return 'PENDING';
      case DocumentStatus.rejected:
        return 'REJECTED';
      case DocumentStatus.expired:
        return 'EXPIRED';
      case DocumentStatus.missing:
        return 'MISSING';
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
      case DocumentType.psv:
        return Icons.local_taxi;
      case DocumentType.profilePhoto:
        return Icons.person;
      case DocumentType.vehiclePhoto:
        return Icons.photo_camera;
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
      case DocumentType.psv:
        return 'PSV License';
      case DocumentType.profilePhoto:
        return 'Profile Photo';
      case DocumentType.vehiclePhoto:
        return 'Vehicle Photo';
    }
  }

  bool _isExpiringSoon(String expiryDate) {
    // Simple check - in real app would parse date
    return expiryDate.contains('2024');
  }
}
