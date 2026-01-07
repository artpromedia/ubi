import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../bloc/navigation_bloc.dart';

/// Turn-by-turn navigation page with voice guidance
class NavigationPage extends StatefulWidget {
  final String tripId;

  const NavigationPage({
    super.key,
    required this.tripId,
  });

  @override
  State<NavigationPage> createState() => _NavigationPageState();
}

class _NavigationPageState extends State<NavigationPage> {
  @override
  void initState() {
    super.initState();
    // Start navigation for the trip
    context.read<NavigationBloc>().add(
          NavigationStarted(
            destinationLatitude: -1.2921,
            destinationLongitude: 36.8219,
            destinationAddress: 'Destination', // Mock destination
            destinationType: DestinationType.dropoff,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<NavigationBloc, NavigationState>(
      builder: (context, state) {
        return Scaffold(
          body: Stack(
            children: [
              // Map placeholder
              Container(
                width: double.infinity,
                height: double.infinity,
                color: Colors.grey.shade800,
                child: const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.navigation,
                        size: 80,
                        color: Colors.grey,
                      ),
                      SizedBox(height: 16),
                      Text(
                        'Navigation View',
                        style: TextStyle(
                          color: Colors.grey,
                          fontSize: 20,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Instruction banner at top
              SafeArea(
                child: Column(
                  children: [
                    if (state is NavigationActive)
                      _buildInstructionBanner(context, state),
                    if (state is NavigationRecalculating)
                      _buildRecalculatingBanner(),
                  ],
                ),
              ),

              // Exit button
              Positioned(
                top: MediaQuery.of(context).padding.top + 16,
                left: 16,
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.2),
                        blurRadius: 8,
                      ),
                    ],
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      context.read<NavigationBloc>().add(const NavigationStopped());
                      context.pop();
                    },
                  ),
                ),
              ),

              // Voice toggle
              Positioned(
                top: MediaQuery.of(context).padding.top + 16,
                right: 16,
                child: BlocBuilder<NavigationBloc, NavigationState>(
                  builder: (context, state) {
                    final voiceEnabled = state is NavigationActive
                        ? state.voiceEnabled
                        : true;
                    return Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.2),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                      child: IconButton(
                        icon: Icon(
                          voiceEnabled
                              ? Icons.volume_up
                              : Icons.volume_off,
                        ),
                        onPressed: () {
                          context
                              .read<NavigationBloc>()
                              .add(const NavigationVoiceToggled());
                        },
                      ),
                    );
                  },
                ),
              ),

              // Bottom panel
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _buildBottomPanel(context, state),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildInstructionBanner(BuildContext context, NavigationActive state) {
    final instruction = state.currentInstruction;
    if (instruction == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).primaryColor,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          // Maneuver icon
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              _getManeuverIcon(instruction.maneuver),
              color: Colors.white,
              size: 32,
            ),
          ),
          const SizedBox(width: 16),
          // Instruction text
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${instruction.distance.round()}m',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  instruction.instruction,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.9),
                    fontSize: 14,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRecalculatingBanner() {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.orange,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.white,
            ),
          ),
          SizedBox(width: 12),
          Text(
            'Recalculating route...',
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomPanel(BuildContext context, NavigationState state) {
    String eta = '--';
    String distance = '--';

    if (state is NavigationActive) {
      final mins = state.durationRemaining ~/ 60;
      if (mins >= 60) {
        eta = '${mins ~/ 60}h ${mins % 60}m';
      } else {
        eta = '$mins min';
      }
      final km = state.distanceRemaining / 1000;
      distance = km >= 1
          ? '${km.toStringAsFixed(1)} km'
          : '${state.distanceRemaining.round()} m';
    }

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 16),

          // ETA and distance
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Column(
                children: [
                  const Text(
                    'ETA',
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    eta,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Container(
                width: 1,
                height: 40,
                color: Colors.grey.shade300,
              ),
              Column(
                children: [
                  const Text(
                    'Distance',
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    distance,
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).primaryColor,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Next instruction preview
          if (state is NavigationActive && state.nextInstruction != null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Icon(
                    _getManeuverIcon(state.nextInstruction!.maneuver),
                    color: Colors.grey.shade700,
                    size: 24,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Then',
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 11,
                          ),
                        ),
                        Text(
                          state.nextInstruction!.instruction,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${state.nextInstruction!.distance.round()}m',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 16),

          // Alternative routes are shown in NavigationReady state, not Active
        ],
      ),
    );
  }

  IconData _getManeuverIcon(ManeuverType maneuver) {
    switch (maneuver) {
      case ManeuverType.turnLeft:
      case ManeuverType.turnSlightLeft:
      case ManeuverType.turnSharpLeft:
        return Icons.turn_left;
      case ManeuverType.turnRight:
      case ManeuverType.turnSlightRight:
      case ManeuverType.turnSharpRight:
        return Icons.turn_right;
      case ManeuverType.continueOnRoute:
      case ManeuverType.depart:
        return Icons.straight;
      case ManeuverType.uturn:
        return Icons.u_turn_left;
      case ManeuverType.merge:
      case ManeuverType.keepLeft:
      case ManeuverType.keepRight:
        return Icons.merge;
      case ManeuverType.roundaboutLeft:
      case ManeuverType.roundaboutRight:
        return Icons.roundabout_left;
      case ManeuverType.ramp:
      case ManeuverType.exitLeft:
      case ManeuverType.exitRight:
        return Icons.ramp_right;
      case ManeuverType.arrive:
        return Icons.flag;
      case ManeuverType.ferry:
        return Icons.directions_boat;
    }
  }
}
