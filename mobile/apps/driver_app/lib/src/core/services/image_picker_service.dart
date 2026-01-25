import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

/// Image source options
enum ImageSourceType {
  camera,
  gallery,
}

/// Result of an image pick operation
class PickedImageResult {
  final File? file;
  final String? error;
  final bool permissionDenied;

  const PickedImageResult({
    this.file,
    this.error,
    this.permissionDenied = false,
  });

  bool get isSuccess => file != null;
  bool get isFailure => file == null;

  factory PickedImageResult.success(File file) => PickedImageResult(file: file);

  factory PickedImageResult.error(String error) =>
      PickedImageResult(error: error);

  factory PickedImageResult.permissionDenied() =>
      const PickedImageResult(permissionDenied: true);
}

/// Image compression options
class ImageCompressionOptions {
  final int maxWidth;
  final int maxHeight;
  final int quality;

  const ImageCompressionOptions({
    this.maxWidth = 1920,
    this.maxHeight = 1080,
    this.quality = 85,
  });

  /// Vehicle photo options - optimized for vehicle images
  static const vehicle = ImageCompressionOptions(
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 85,
  );

  /// Profile photo options - smaller for profile images
  static const profile = ImageCompressionOptions(
    maxWidth: 800,
    maxHeight: 800,
    quality: 90,
  );

  /// Document photo options - higher quality for documents
  static const document = ImageCompressionOptions(
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 95,
  );
}

/// Service for picking images from camera and gallery with proper permission handling
class ImagePickerService {
  final ImagePicker _picker = ImagePicker();

  /// Pick an image from the specified source with permission handling
  ///
  /// [source] - Camera or gallery
  /// [compressionOptions] - Image size and quality settings
  /// [preferFrontCamera] - For camera source, prefer front camera
  Future<PickedImageResult> pickImage({
    required ImageSourceType source,
    ImageCompressionOptions compressionOptions = const ImageCompressionOptions(),
    bool preferFrontCamera = false,
  }) async {
    try {
      // Check and request permission
      final hasPermission = await _requestPermission(source);
      if (!hasPermission) {
        return PickedImageResult.permissionDenied();
      }

      // Pick image based on source
      final imageSource =
          source == ImageSourceType.camera ? ImageSource.camera : ImageSource.gallery;

      final XFile? pickedFile = await _picker.pickImage(
        source: imageSource,
        maxWidth: compressionOptions.maxWidth.toDouble(),
        maxHeight: compressionOptions.maxHeight.toDouble(),
        imageQuality: compressionOptions.quality,
        preferredCameraDevice:
            preferFrontCamera ? CameraDevice.front : CameraDevice.rear,
      );

      if (pickedFile == null) {
        return PickedImageResult.error('No image selected');
      }

      final file = File(pickedFile.path);

      // Validate file exists
      if (!await file.exists()) {
        return PickedImageResult.error('Failed to access image file');
      }

      // Validate file size (max 10MB)
      final fileSize = await file.length();
      if (fileSize > 10 * 1024 * 1024) {
        return PickedImageResult.error('Image file is too large (max 10MB)');
      }

      return PickedImageResult.success(file);
    } catch (e) {
      debugPrint('ImagePickerService: Error picking image: $e');
      return PickedImageResult.error('Failed to pick image: ${e.toString()}');
    }
  }

  /// Pick image from camera with vehicle-optimized settings
  Future<PickedImageResult> pickVehiclePhoto({
    bool fromCamera = true,
  }) async {
    return pickImage(
      source: fromCamera ? ImageSourceType.camera : ImageSourceType.gallery,
      compressionOptions: ImageCompressionOptions.vehicle,
      preferFrontCamera: false,
    );
  }

  /// Pick image for profile photo
  Future<PickedImageResult> pickProfilePhoto({
    bool fromCamera = true,
  }) async {
    return pickImage(
      source: fromCamera ? ImageSourceType.camera : ImageSourceType.gallery,
      compressionOptions: ImageCompressionOptions.profile,
      preferFrontCamera: true,
    );
  }

  /// Pick document image (license, ID, etc.)
  Future<PickedImageResult> pickDocumentPhoto({
    bool fromCamera = true,
  }) async {
    return pickImage(
      source: fromCamera ? ImageSourceType.camera : ImageSourceType.gallery,
      compressionOptions: ImageCompressionOptions.document,
      preferFrontCamera: false,
    );
  }

  /// Pick multiple images from gallery
  Future<List<PickedImageResult>> pickMultipleImages({
    ImageCompressionOptions compressionOptions = const ImageCompressionOptions(),
    int maxImages = 5,
  }) async {
    try {
      // Check gallery permission
      final hasPermission = await _requestPermission(ImageSourceType.gallery);
      if (!hasPermission) {
        return [PickedImageResult.permissionDenied()];
      }

      final List<XFile> pickedFiles = await _picker.pickMultiImage(
        maxWidth: compressionOptions.maxWidth.toDouble(),
        maxHeight: compressionOptions.maxHeight.toDouble(),
        imageQuality: compressionOptions.quality,
        limit: maxImages,
      );

      if (pickedFiles.isEmpty) {
        return [PickedImageResult.error('No images selected')];
      }

      return pickedFiles.map((xFile) => PickedImageResult.success(File(xFile.path))).toList();
    } catch (e) {
      debugPrint('ImagePickerService: Error picking multiple images: $e');
      return [PickedImageResult.error('Failed to pick images: ${e.toString()}')];
    }
  }

  /// Request permission for camera or gallery access
  Future<bool> _requestPermission(ImageSourceType source) async {
    Permission permission;

    if (source == ImageSourceType.camera) {
      permission = Permission.camera;
    } else {
      // For gallery, use photos permission on iOS, storage on Android
      if (Platform.isIOS) {
        permission = Permission.photos;
      } else {
        // Android 13+ uses specific media permissions
        permission = Permission.photos;
      }
    }

    // Check current status
    PermissionStatus status = await permission.status;

    if (status.isGranted) {
      return true;
    }

    if (status.isDenied) {
      // Request permission
      status = await permission.request();
      return status.isGranted;
    }

    if (status.isPermanentlyDenied) {
      // User has permanently denied - they need to enable in settings
      debugPrint(
          'ImagePickerService: Permission permanently denied for ${source.name}');
      return false;
    }

    if (status.isRestricted) {
      // On iOS, this means parental controls or device policy
      debugPrint(
          'ImagePickerService: Permission restricted for ${source.name}');
      return false;
    }

    return false;
  }

  /// Check if camera permission is granted
  Future<bool> hasCameraPermission() async {
    final status = await Permission.camera.status;
    return status.isGranted;
  }

  /// Check if gallery permission is granted
  Future<bool> hasGalleryPermission() async {
    final status = Platform.isIOS
        ? await Permission.photos.status
        : await Permission.photos.status;
    return status.isGranted;
  }

  /// Open app settings for permission management
  Future<bool> openAppSettings() async {
    return await openAppSettings();
  }
}
