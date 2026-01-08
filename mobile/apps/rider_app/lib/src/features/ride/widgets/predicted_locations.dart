import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/services/haptic_service.dart';

/// A predicted location suggestion from ML model
class PredictedLocation {
  const PredictedLocation({
    required this.placeId,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.confidence,
    this.label,
    required this.category,
  });

  final String placeId;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final double confidence;
  final String? label;
  final String category; // home, work, frequent, popular

  factory PredictedLocation.fromJson(Map<String, dynamic> json) {
    return PredictedLocation(
      placeId: json['place_id'] as String,
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      confidence: (json['confidence'] as num).toDouble(),
      label: json['label'] as String?,
      category: json['category'] as String,
    );
  }

  IconData get icon {
    switch (category) {
      case 'home':
        return Icons.home;
      case 'work':
        return Icons.work;
      case 'frequent':
        return Icons.star;
      case 'popular':
        return Icons.trending_up;
      default:
        return Icons.place;
    }
  }
}

/// Widget displaying ML-powered location predictions
class PredictedLocationsSection extends StatefulWidget {
  const PredictedLocationsSection({
    super.key,
    required this.onLocationSelected,
    this.currentLatitude,
    this.currentLongitude,
    this.showTitle = true,
    this.maxItems = 3,
  });

  /// Called when user selects a predicted location
  final void Function(PredictedLocation location) onLocationSelected;

  /// Current user latitude for distance-based predictions
  final double? currentLatitude;

  /// Current user longitude for distance-based predictions
  final double? currentLongitude;

  /// Whether to show section title
  final bool showTitle;

  /// Maximum number of predictions to show
  final int maxItems;

  @override
  State<PredictedLocationsSection> createState() =>
      _PredictedLocationsSectionState();
}

class _PredictedLocationsSectionState extends State<PredictedLocationsSection> {
  List<PredictedLocation>? _predictions;
  bool _isLoading = true;
  String? _error;
  String _source = 'personalized';

  @override
  void initState() {
    super.initState();
    _loadPredictions();
  }

  @override
  void didUpdateWidget(PredictedLocationsSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentLatitude != widget.currentLatitude ||
        oldWidget.currentLongitude != widget.currentLongitude) {
      _loadPredictions();
    }
  }

  Future<void> _loadPredictions() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // TODO: Replace with actual API call
      // final response = await apiClient.get(
      //   '/users/me/predicted-locations',
      //   queryParameters: {
      //     'lat': widget.currentLatitude,
      //     'lng': widget.currentLongitude,
      //   },
      // );

      // Mock data for now
      await Future.delayed(const Duration(milliseconds: 100));
      final mockPredictions = _getMockPredictions();

      if (mounted) {
        setState(() {
          _predictions = mockPredictions;
          _source = mockPredictions.isNotEmpty &&
                  mockPredictions.first.category == 'popular'
              ? 'popular'
              : 'personalized';
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to load suggestions';
          _isLoading = false;
        });
      }
    }
  }

  List<PredictedLocation> _getMockPredictions() {
    // Mock predictions based on time of day
    final hour = DateTime.now().hour;
    final isWeekend =
        DateTime.now().weekday == DateTime.saturday ||
        DateTime.now().weekday == DateTime.sunday;

    if (hour >= 7 && hour <= 10 && !isWeekend) {
      return [
        const PredictedLocation(
          placeId: 'work_001',
          name: 'Office',
          address: 'Westlands Business Park, Nairobi',
          latitude: -1.2641,
          longitude: 36.8031,
          confidence: 0.92,
          label: 'Usual morning trip',
          category: 'work',
        ),
        const PredictedLocation(
          placeId: 'cafe_001',
          name: 'Java House Westlands',
          address: 'Sarit Centre, Nairobi',
          latitude: -1.2589,
          longitude: 36.8028,
          confidence: 0.68,
          label: 'Frequent destination',
          category: 'frequent',
        ),
      ];
    } else if (hour >= 17 && hour <= 22) {
      return [
        const PredictedLocation(
          placeId: 'home_001',
          name: 'Home',
          address: 'Kilimani, Nairobi',
          latitude: -1.2921,
          longitude: 36.7891,
          confidence: 0.89,
          label: 'Heading home?',
          category: 'home',
        ),
        const PredictedLocation(
          placeId: 'gym_001',
          name: 'Fitness First',
          address: 'Village Market, Nairobi',
          latitude: -1.2301,
          longitude: 36.8051,
          confidence: 0.54,
          label: 'Tuesday evening',
          category: 'frequent',
        ),
      ];
    }

    // Default popular locations
    return [
      const PredictedLocation(
        placeId: 'popular_001',
        name: 'Junction Mall',
        address: 'Ngong Road, Nairobi',
        latitude: -1.3001,
        longitude: 36.7801,
        confidence: 0.45,
        label: 'Popular shopping',
        category: 'popular',
      ),
      const PredictedLocation(
        placeId: 'popular_002',
        name: 'JKIA Airport',
        address: 'Jomo Kenyatta International Airport',
        latitude: -1.3192,
        longitude: 36.9278,
        confidence: 0.42,
        label: 'Popular transit',
        category: 'popular',
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const _PredictionsLoadingState();
    }

    if (_error != null) {
      return const SizedBox.shrink(); // Hide on error
    }

    if (_predictions == null || _predictions!.isEmpty) {
      return const SizedBox.shrink();
    }

    final predictions = _predictions!.take(widget.maxItems).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.showTitle)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Icon(
                  _source == 'personalized'
                      ? Icons.auto_awesome
                      : Icons.trending_up,
                  size: 18,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  _source == 'personalized'
                      ? 'Suggested for you'
                      : 'Popular destinations',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            ),
          ),
        ...predictions.map((prediction) => _PredictionTile(
              prediction: prediction,
              onTap: () {
                HapticService.instance.trigger(HapticType.light);
                widget.onLocationSelected(prediction);
              },
            )),
      ],
    );
  }
}

class _PredictionTile extends StatelessWidget {
  const _PredictionTile({
    required this.prediction,
    required this.onTap,
  });

  final PredictedLocation prediction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            // Icon with confidence indicator
            Stack(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: _getCategoryColor(colorScheme).withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    prediction.icon,
                    color: _getCategoryColor(colorScheme),
                    size: 22,
                  ),
                ),
                // Confidence indicator
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: _ConfidenceIndicator(confidence: prediction.confidence),
                ),
              ],
            ),
            const SizedBox(width: 12),

            // Location details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          prediction.name,
                          style: theme.textTheme.bodyLarge?.copyWith(
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (prediction.label != null)
                        Container(
                          margin: const EdgeInsets.only(left: 8),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: colorScheme.primaryContainer.withOpacity(0.5),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            prediction.label!,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: colorScheme.onPrimaryContainer,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    prediction.address,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),

            // Arrow
            Icon(
              Icons.arrow_forward_ios,
              size: 14,
              color: colorScheme.outline,
            ),
          ],
        ),
      ),
    );
  }

  Color _getCategoryColor(ColorScheme colorScheme) {
    switch (prediction.category) {
      case 'home':
        return Colors.blue;
      case 'work':
        return Colors.orange;
      case 'frequent':
        return Colors.purple;
      case 'popular':
        return Colors.teal;
      default:
        return colorScheme.primary;
    }
  }
}

class _ConfidenceIndicator extends StatelessWidget {
  const _ConfidenceIndicator({required this.confidence});

  final double confidence;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    // Only show for high confidence predictions
    if (confidence < 0.6) return const SizedBox.shrink();

    return Container(
      width: 14,
      height: 14,
      decoration: BoxDecoration(
        color: colorScheme.surface,
        shape: BoxShape.circle,
        border: Border.all(color: colorScheme.surface, width: 2),
      ),
      child: CircularProgressIndicator(
        value: confidence,
        strokeWidth: 2,
        backgroundColor: colorScheme.outlineVariant,
        color: confidence >= 0.8
            ? Colors.green
            : confidence >= 0.6
                ? Colors.orange
                : colorScheme.outline,
      ),
    );
  }
}

class _PredictionsLoadingState extends StatelessWidget {
  const _PredictionsLoadingState();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Container(
            width: 140,
            height: 16,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
        ...List.generate(2, (index) => const _PredictionTileSkeleton()),
      ],
    );
  }
}

class _PredictionTileSkeleton extends StatelessWidget {
  const _PredictionTileSkeleton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 120,
                  height: 16,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade200,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const SizedBox(height: 6),
                Container(
                  width: double.infinity,
                  height: 12,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade200,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Privacy settings widget for predictions
class PredictionPrivacySettings extends StatefulWidget {
  const PredictionPrivacySettings({super.key});

  @override
  State<PredictionPrivacySettings> createState() =>
      _PredictionPrivacySettingsState();
}

class _PredictionPrivacySettingsState extends State<PredictionPrivacySettings> {
  bool _predictionsEnabled = true;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwitchListTile(
          title: const Text('Smart location predictions'),
          subtitle: const Text(
            'Show personalized destination suggestions based on your trip history',
          ),
          value: _predictionsEnabled,
          onChanged: (value) async {
            setState(() => _predictionsEnabled = value);
            // TODO: Call API to update preference
            // await apiClient.put('/users/me/predictions/opt-out', {
            //   'opt_out': !value,
            // });
          },
        ),
        if (_predictionsEnabled)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              'We analyze your trip patterns to suggest relevant destinations. '
              'Your data is processed securely and never shared.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ListTile(
          leading: Icon(
            Icons.delete_outline,
            color: colorScheme.error,
          ),
          title: Text(
            'Delete prediction data',
            style: TextStyle(color: colorScheme.error),
          ),
          subtitle: const Text('Remove all saved trip patterns'),
          onTap: () => _confirmDeleteData(context),
        ),
      ],
    );
  }

  Future<void> _confirmDeleteData(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final errorColor = Theme.of(context).colorScheme.error;
    
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete prediction data?'),
        content: const Text(
          'This will permanently delete all your trip patterns and location predictions. '
          'You will receive generic suggestions until new patterns are learned.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(
              backgroundColor: errorColor,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      // TODO: Call API to delete data
      // await apiClient.delete('/users/me/predictions/data');
      if (mounted) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Prediction data deleted')),
        );
      }
    }
  }
}
