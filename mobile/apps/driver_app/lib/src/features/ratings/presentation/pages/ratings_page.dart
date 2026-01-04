import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../bloc/driver_profile_bloc.dart';

/// Ratings page showing driver's rating breakdown and reviews
class RatingsPage extends StatefulWidget {
  const RatingsPage({super.key});

  @override
  State<RatingsPage> createState() => _RatingsPageState();
}

class _RatingsPageState extends State<RatingsPage> {
  @override
  void initState() {
    super.initState();
    context.read<DriverProfileBloc>().add(const RatingsLoaded());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Ratings'),
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

          if (state is DriverRatingsLoaded) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Overall rating card
                  _buildOverallRatingCard(context, state.summary),
                  const SizedBox(height: 24),

                  // Rating breakdown
                  _buildRatingBreakdown(context, state.summary),
                  const SizedBox(height: 24),

                  // Tips to improve
                  _buildTipsCard(context, state.summary.averageRating),
                  const SizedBox(height: 24),

                  // Recent reviews
                  Text(
                    'Recent Reviews',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 12),
                  if (state.ratings.isEmpty)
                    _buildEmptyReviews()
                  else
                    ...state.ratings.map((rating) => _buildReviewCard(rating)),
                ],
              ),
            );
          }

          return const Center(child: Text('No ratings found'));
        },
      ),
    );
  }

  Widget _buildOverallRatingCard(BuildContext context, RatingSummary summary) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).primaryColor,
            Theme.of(context).primaryColor.withOpacity(0.8),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.star,
                size: 48,
                color: Colors.amber,
              ),
              const SizedBox(width: 8),
              Text(
                summary.averageRating.toStringAsFixed(2),
                style: const TextStyle(
                  fontSize: 56,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Based on ${summary.totalRatings} ratings',
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildRatingStatus(
                _getRatingStatus(summary.averageRating),
                _getRatingStatusColor(summary.averageRating),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRatingStatus(String status, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            status,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRatingBreakdown(BuildContext context, RatingSummary summary) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Rating Breakdown',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 16),
          _buildRatingRow(5, summary.fiveStarCount, summary.totalRatings),
          _buildRatingRow(4, summary.fourStarCount, summary.totalRatings),
          _buildRatingRow(3, summary.threeStarCount, summary.totalRatings),
          _buildRatingRow(2, summary.twoStarCount, summary.totalRatings),
          _buildRatingRow(1, summary.oneStarCount, summary.totalRatings),
        ],
      ),
    );
  }

  Widget _buildRatingRow(int stars, int count, int total) {
    final percentage = total > 0 ? count / total : 0.0;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            child: Text(
              '$stars',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          const Icon(Icons.star, size: 16, color: Colors.amber),
          const SizedBox(width: 8),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: percentage,
                backgroundColor: Colors.grey.shade200,
                minHeight: 8,
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 40,
            child: Text(
              '$count',
              textAlign: TextAlign.right,
              style: TextStyle(
                color: Colors.grey.shade600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTipsCard(BuildContext context, double rating) {
    final tips = _getTipsForRating(rating);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.amber.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.lightbulb, color: Colors.amber.shade700),
              const SizedBox(width: 8),
              Text(
                'Tips to Improve',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.amber.shade900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...tips.map((tip) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.check_circle,
                      size: 16,
                      color: Colors.amber.shade700,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        tip,
                        style: TextStyle(
                          color: Colors.amber.shade900,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }

  Widget _buildEmptyReviews() {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Icon(
            Icons.rate_review,
            size: 64,
            color: Colors.grey.shade400,
          ),
          const SizedBox(height: 16),
          Text(
            'No reviews yet',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              color: Colors.grey.shade600,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Complete trips to receive reviews from customers',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.grey.shade500,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReviewCard(DriverRating rating) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Customer avatar
              CircleAvatar(
                backgroundColor: Colors.grey.shade200,
                radius: 20,
                child: Text(
                  rating.customerName.isNotEmpty
                      ? rating.customerName[0].toUpperCase()
                      : 'C',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      rating.customerName,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      rating.tripDate,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              // Rating stars
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _getRatingColor(rating.rating).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.star,
                      size: 16,
                      color: _getRatingColor(rating.rating),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      rating.rating.toString(),
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: _getRatingColor(rating.rating),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (rating.comment != null && rating.comment!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.grey.shade50,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.format_quote,
                    size: 16,
                    color: Colors.grey.shade400,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      rating.comment!,
                      style: TextStyle(
                        color: Colors.grey.shade700,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (rating.tags != null && rating.tags!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: rating.tags!
                  .map((tag) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Theme.of(context).primaryColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          tag,
                          style: TextStyle(
                            color: Theme.of(context).primaryColor,
                            fontSize: 12,
                          ),
                        ),
                      ))
                  .toList(),
            ),
          ],
          if (rating.tripType != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  _getTripTypeIcon(rating.tripType!),
                  size: 16,
                  color: Colors.grey.shade500,
                ),
                const SizedBox(width: 4),
                Text(
                  rating.tripType!,
                  style: TextStyle(
                    color: Colors.grey.shade500,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Color _getRatingColor(int rating) {
    if (rating >= 5) return Colors.green;
    if (rating >= 4) return Colors.lightGreen;
    if (rating >= 3) return Colors.amber;
    if (rating >= 2) return Colors.orange;
    return Colors.red;
  }

  String _getRatingStatus(double rating) {
    if (rating >= 4.8) return 'Excellent';
    if (rating >= 4.5) return 'Great';
    if (rating >= 4.0) return 'Good';
    if (rating >= 3.5) return 'Average';
    return 'Needs Improvement';
  }

  Color _getRatingStatusColor(double rating) {
    if (rating >= 4.8) return Colors.green;
    if (rating >= 4.5) return Colors.lightGreen;
    if (rating >= 4.0) return Colors.amber;
    if (rating >= 3.5) return Colors.orange;
    return Colors.red;
  }

  List<String> _getTipsForRating(double rating) {
    if (rating >= 4.8) {
      return [
        'Keep up the excellent work!',
        'Maintain your high standards',
        'Share your expertise with new drivers',
      ];
    } else if (rating >= 4.5) {
      return [
        'Greet customers warmly',
        'Keep your vehicle spotless',
        'Offer to help with luggage',
      ];
    } else if (rating >= 4.0) {
      return [
        'Ask customers for music preferences',
        'Maintain a comfortable temperature',
        'Follow the customer\'s preferred route',
      ];
    } else {
      return [
        'Improve punctuality',
        'Focus on safe driving',
        'Be more courteous to customers',
        'Keep your vehicle clean',
      ];
    }
  }

  IconData _getTripTypeIcon(String type) {
    switch (type.toLowerCase()) {
      case 'ride':
        return Icons.directions_car;
      case 'food':
        return Icons.restaurant;
      case 'delivery':
        return Icons.local_shipping;
      default:
        return Icons.trip_origin;
    }
  }
}
