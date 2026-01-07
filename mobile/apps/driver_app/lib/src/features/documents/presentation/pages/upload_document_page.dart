import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../profile/bloc/driver_profile_bloc.dart';

/// Upload document page for submitting driver documents
class UploadDocumentPage extends StatefulWidget {
  final String documentType;

  const UploadDocumentPage({
    super.key,
    required this.documentType,
  });

  @override
  State<UploadDocumentPage> createState() => _UploadDocumentPageState();
}

class _UploadDocumentPageState extends State<UploadDocumentPage> {
  File? _frontImage;
  File? _backImage;
  final TextEditingController _documentNumberController = TextEditingController();
  final TextEditingController _expiryDateController = TextEditingController();
  bool _isUploading = false;
  double _uploadProgress = 0;

  late DocumentType _docType;
  bool _requiresBackImage = false;
  bool _requiresNumber = false;
  bool _requiresExpiry = false;

  @override
  void initState() {
    super.initState();
    _parseDocumentType();
    _setupRequirements();
  }

  void _parseDocumentType() {
    try {
      _docType = DocumentType.values.firstWhere(
        (t) => t.name == widget.documentType,
      );
    } catch (_) {
      _docType = DocumentType.nationalId;
    }
  }

  void _setupRequirements() {
    switch (_docType) {
      case DocumentType.driverLicense:
        _requiresBackImage = true;
        _requiresNumber = true;
        _requiresExpiry = true;
      case DocumentType.nationalId:
        _requiresBackImage = true;
        _requiresNumber = true;
        _requiresExpiry = false;
      case DocumentType.vehicleRegistration:
        _requiresBackImage = false;
        _requiresNumber = true;
        _requiresExpiry = false;
      case DocumentType.insurance:
        _requiresBackImage = false;
        _requiresNumber = true;
        _requiresExpiry = true;
      case DocumentType.goodConduct:
        _requiresBackImage = false;
        _requiresNumber = true;
        _requiresExpiry = false;
      case DocumentType.psvBadge:
        _requiresBackImage = false;
        _requiresNumber = true;
        _requiresExpiry = true;
      case DocumentType.vehicleInspection:
        _requiresBackImage = false;
        _requiresNumber = true;
        _requiresExpiry = true;
      case DocumentType.profilePhoto:
        _requiresBackImage = false;
        _requiresNumber = false;
        _requiresExpiry = false;
    }
  }

  @override
  void dispose() {
    _documentNumberController.dispose();
    _expiryDateController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Upload ${_getDocumentTitle(_docType)}'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: BlocListener<DriverProfileBloc, DriverProfileState>(
        listener: (context, state) {
          if (state is DriverDocumentUploaded) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Colors.green,
              ),
            );
            context.pop();
          } else if (state is DriverProfileError) {
            setState(() => _isUploading = false);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Colors.red,
              ),
            );
          }
        },
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Guidelines
              _buildGuidelinesCard(),
              const SizedBox(height: 24),

              // Front image
              Text(
                _requiresBackImage ? 'Front Side' : 'Document Photo',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              _buildImagePicker(
                image: _frontImage,
                onTap: () => _pickImage(true),
              ),
              const SizedBox(height: 24),

              // Back image (if required)
              if (_requiresBackImage) ...[
                Text(
                  'Back Side',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 12),
                _buildImagePicker(
                  image: _backImage,
                  onTap: () => _pickImage(false),
                ),
                const SizedBox(height: 24),
              ],

              // Document number
              if (_requiresNumber) ...[
                Text(
                  'Document Number',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _documentNumberController,
                  decoration: InputDecoration(
                    hintText: 'Enter document number',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    prefixIcon: const Icon(Icons.tag),
                  ),
                  textCapitalization: TextCapitalization.characters,
                ),
                const SizedBox(height: 24),
              ],

              // Expiry date
              if (_requiresExpiry) ...[
                Text(
                  'Expiry Date',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _expiryDateController,
                  readOnly: true,
                  decoration: InputDecoration(
                    hintText: 'Select expiry date',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    prefixIcon: const Icon(Icons.calendar_today),
                    suffixIcon: const Icon(Icons.arrow_drop_down),
                  ),
                  onTap: _selectExpiryDate,
                ),
                const SizedBox(height: 24),
              ],

              // Upload progress
              if (_isUploading) ...[
                LinearProgressIndicator(
                  value: _uploadProgress,
                  backgroundColor: Colors.grey.shade200,
                ),
                const SizedBox(height: 8),
                Text(
                  'Uploading... ${(_uploadProgress * 100).round()}%',
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 24),
              ],

              // Submit button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _canSubmit() && !_isUploading ? _submitDocument : null,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: _isUploading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Text(
                          'Submit Document',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGuidelinesCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.blue.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info, color: Colors.blue.shade700),
              const SizedBox(width: 8),
              Text(
                'Photo Guidelines',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.blue.shade700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildGuidelineItem('Ensure document is clearly visible'),
          _buildGuidelineItem('All four corners must be visible'),
          _buildGuidelineItem('Avoid glare and shadows'),
          _buildGuidelineItem('Photo should be in focus'),
          _buildGuidelineItem('Use good lighting'),
        ],
      ),
    );
  }

  Widget _buildGuidelineItem(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(
            Icons.check_circle,
            size: 16,
            color: Colors.blue.shade700,
          ),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(
              color: Colors.blue.shade900,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildImagePicker({
    required File? image,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 200,
        width: double.infinity,
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.grey.shade300,
            style: BorderStyle.solid,
          ),
        ),
        child: image != null
            ? Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(
                      image,
                      fit: BoxFit.cover,
                      width: double.infinity,
                      height: double.infinity,
                    ),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.1),
                            blurRadius: 4,
                          ),
                        ],
                      ),
                      child: IconButton(
                        icon: const Icon(Icons.edit),
                        onPressed: onTap,
                        iconSize: 20,
                      ),
                    ),
                  ),
                ],
              )
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.add_a_photo,
                    size: 48,
                    color: Colors.grey.shade400,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Tap to take or select photo',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Future<void> _pickImage(bool isFront) async {
    final picker = ImagePicker();

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Select Photo',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 20),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).primaryColor.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.camera_alt,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
                title: const Text('Take Photo'),
                subtitle: const Text('Use camera to capture document'),
                onTap: () async {
                  Navigator.pop(context);
                  final image = await picker.pickImage(
                    source: ImageSource.camera,
                    imageQuality: 85,
                  );
                  if (image != null) {
                    setState(() {
                      if (isFront) {
                        _frontImage = File(image.path);
                      } else {
                        _backImage = File(image.path);
                      }
                    });
                  }
                },
              ),
              const Divider(),
              ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).primaryColor.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.photo_library,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
                title: const Text('Choose from Gallery'),
                subtitle: const Text('Select existing photo'),
                onTap: () async {
                  Navigator.pop(context);
                  final image = await picker.pickImage(
                    source: ImageSource.gallery,
                    imageQuality: 85,
                  );
                  if (image != null) {
                    setState(() {
                      if (isFront) {
                        _frontImage = File(image.path);
                      } else {
                        _backImage = File(image.path);
                      }
                    });
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _selectExpiryDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 365)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365 * 10)),
    );

    if (picked != null) {
      setState(() {
        _expiryDateController.text =
            '${picked.day}/${picked.month}/${picked.year}';
      });
    }
  }

  bool _canSubmit() {
    // Check front image
    if (_frontImage == null) return false;

    // Check back image if required
    if (_requiresBackImage && _backImage == null) return false;

    // Check document number if required
    if (_requiresNumber && _documentNumberController.text.isEmpty) return false;

    // Check expiry date if required
    if (_requiresExpiry && _expiryDateController.text.isEmpty) return false;

    return true;
  }

  void _submitDocument() {
    setState(() {
      _isUploading = true;
      _uploadProgress = 0;
    });

    // Simulate upload progress
    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) setState(() => _uploadProgress = 0.3);
    });
    Future.delayed(const Duration(milliseconds: 1000), () {
      if (mounted) setState(() => _uploadProgress = 0.6);
    });
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _uploadProgress = 0.9);
    });

    // Dispatch upload event
    DateTime? expiryDate;
    if (_requiresExpiry && _expiryDateController.text.isNotEmpty) {
      final parts = _expiryDateController.text.split('/');
      if (parts.length == 3) {
        expiryDate = DateTime(
          int.parse(parts[2]),
          int.parse(parts[1]),
          int.parse(parts[0]),
        );
      }
    }
    context.read<DriverProfileBloc>().add(
          UploadDriverDocument(
            documentType: _docType,
            filePath: _frontImage!.path,
            expiryDate: expiryDate,
          ),
        );
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
}
