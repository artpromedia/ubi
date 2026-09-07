/// Destination search (board: rider search).
///
/// There is no seeded destination list here. The previous version returned five
/// fixed Nairobi landmarks for any query, which is exactly the hard-coded
/// market CLAUDE.md rule 12 forbids; suggestions now come from the injected
/// [DestinationSearch] or the screen says it cannot search.
library;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:ubi_core/ubi_test_ids.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

/// A place the rider can pick.
@immutable
class DestinationSuggestion {
  const DestinationSuggestion({
    required this.id,
    required this.title,
    required this.subtitle,
  });

  final String id;
  final String title;
  final String subtitle;
}

/// Supplies suggestions for a query. Wired to the places service by the route;
/// null means the app has no search source yet, which the sheet says out loud
/// rather than filling in with examples.
typedef DestinationSearch = Future<List<DestinationSuggestion>> Function(
  String query,
);

class RideSearchPage extends StatefulWidget {
  const RideSearchPage({
    super.key,
    this.searchDestinations,
    this.initialCamera,
    this.onDestinationSelected,
    this.onChooseOnMap,
  });

  final DestinationSearch? searchDestinations;

  /// Where to open the map. There is no fallback city centre: without a
  /// position the map is not drawn and the screen explains why.
  final LatLng? initialCamera;

  final void Function(DestinationSuggestion destination)? onDestinationSelected;

  /// Opens the pick-a-point-on-the-map flow. Disabled while there is no map.
  final VoidCallback? onChooseOnMap;

  @override
  State<RideSearchPage> createState() => _RideSearchPageState();
}

class _RideSearchPageState extends State<RideSearchPage> {
  GoogleMapController? _mapController;
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _dropoffController = TextEditingController();

  @override
  void dispose() {
    _mapController?.dispose();
    _pickupController.dispose();
    _dropoffController.dispose();
    super.dispose();
  }

  void _onMapCreated(GoogleMapController controller) {
    _mapController = controller;
  }

  Future<void> _searchDestination() async {
    final DestinationSuggestion? picked =
        await showModalBottomSheet<DestinationSuggestion>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext sheetContext) => _DestinationSearchSheet(
        search: widget.searchDestinations,
      ),
    );
    if (picked == null || !mounted) {
      return;
    }
    setState(() => _dropoffController.text = picked.title);
    widget.onDestinationSelected?.call(picked);
  }

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);
    final LatLng? camera = widget.initialCamera;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          if (camera == null)
            Positioned.fill(child: _MapUnavailable(colors: colors))
          else
            GoogleMap(
              onMapCreated: _onMapCreated,
              initialCameraPosition: CameraPosition(target: camera, zoom: 14),
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
            ),

          // Pickup / destination card
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(UbiSpace.x4),
              child: Container(
                padding: const EdgeInsets.all(UbiSpace.x4),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: UbiRadii.cardLgBorder,
                  border: Border.all(color: colors.border),
                ),
                child: Column(
                  children: <Widget>[
                    _PointRow(
                      dotColor: colors.move,
                      child: TextField(
                        controller: _pickupController,
                        readOnly: true,
                        decoration: const InputDecoration(
                          hintText: 'Current location',
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ),
                    Divider(color: colors.divider),
                    _PointRow(
                      dotColor: colors.error,
                      child: TextField(
                        key: testKey(TestIds.riderSearchInput),
                        controller: _dropoffController,
                        readOnly: true,
                        onTap: _searchDestination,
                        decoration: const InputDecoration(
                          hintText: 'Where to?',
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          Positioned(
            bottom: UbiSpace.x6,
            left: UbiSpace.x4,
            right: UbiSpace.x4,
            child: OutlinedButton.icon(
              key: testKey(TestIds.riderSearchChooseOnMap),
              onPressed: camera == null ? null : widget.onChooseOnMap,
              icon: const Icon(Icons.map_outlined),
              label: const Text('Choose on map'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PointRow extends StatelessWidget {
  const _PointRow({required this.dotColor, required this.child});

  final Color dotColor;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Container(
          width: UbiSpace.x3,
          height: UbiSpace.x3,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: UbiSpace.x3),
        Expanded(child: child),
      ],
    );
  }
}

/// Shown instead of the map when no position is known. The app does not fall
/// back to a city centre — that would tell the rider they are somewhere they
/// are not.
class _MapUnavailable extends StatelessWidget {
  const _MapUnavailable({required this.colors});

  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: colors.bg2,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(UbiSpace.x6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.location_disabled, size: 40, color: colors.text3),
              const SizedBox(height: UbiSpace.x3),
              Text(
                'We do not have your location yet',
                textAlign: TextAlign.center,
                style:
                    UbiTokenTypography.titleMedium.copyWith(color: colors.ink),
              ),
              const SizedBox(height: UbiSpace.x2),
              Text(
                'Turn on location to see the map. You can still type a '
                'destination above.',
                textAlign: TextAlign.center,
                style:
                    UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DestinationSearchSheet extends StatefulWidget {
  const _DestinationSearchSheet({required this.search});

  final DestinationSearch? search;

  @override
  State<_DestinationSearchSheet> createState() =>
      _DestinationSearchSheetState();
}

enum _SearchPhase { idle, searching, results, empty, unavailable }

class _DestinationSearchSheetState extends State<_DestinationSearchSheet> {
  final TextEditingController _searchController = TextEditingController();

  _SearchPhase _phase = _SearchPhase.idle;
  List<DestinationSuggestion> _results = const <DestinationSuggestion>[];
  int _requestId = 0;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _onSearch(String query) async {
    final String trimmed = query.trim();
    if (trimmed.isEmpty) {
      setState(() {
        _phase = _SearchPhase.idle;
        _results = const <DestinationSuggestion>[];
      });
      return;
    }

    final DestinationSearch? search = widget.search;
    if (search == null) {
      // No search source is wired. Say so — never substitute examples.
      setState(() {
        _phase = _SearchPhase.unavailable;
        _results = const <DestinationSuggestion>[];
      });
      return;
    }

    final int requestId = ++_requestId;
    setState(() => _phase = _SearchPhase.searching);

    List<DestinationSuggestion> found;
    try {
      found = await search(trimmed);
    } on Exception {
      if (!mounted || requestId != _requestId) {
        return;
      }
      setState(() {
        _phase = _SearchPhase.unavailable;
        _results = const <DestinationSuggestion>[];
      });
      return;
    }

    if (!mounted || requestId != _requestId) {
      return;
    }
    setState(() {
      _results = found;
      _phase = found.isEmpty ? _SearchPhase.empty : _SearchPhase.results;
    });
  }

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);

    return DraggableScrollableSheet(
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (BuildContext context, ScrollController scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: UbiRadii.sheetBorder(Theme.of(context).platform),
          ),
          child: Column(
            children: <Widget>[
              Container(
                margin: const EdgeInsets.symmetric(vertical: UbiSpace.x2),
                width: UbiSpace.x10,
                height: UbiSpace.x1,
                decoration: BoxDecoration(
                  color: colors.border,
                  borderRadius: UbiRadii.chipBorder,
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(UbiSpace.x4),
                child: TextField(
                  controller: _searchController,
                  autofocus: true,
                  textInputAction: TextInputAction.search,
                  decoration: const InputDecoration(
                    hintText: 'Search destination',
                    prefixIcon: Icon(Icons.search),
                  ),
                  onChanged: _onSearch,
                ),
              ),
              Expanded(
                child: _SearchBody(
                  phase: _phase,
                  results: _results,
                  colors: colors,
                  scrollController: scrollController,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SearchBody extends StatelessWidget {
  const _SearchBody({
    required this.phase,
    required this.results,
    required this.colors,
    required this.scrollController,
  });

  final _SearchPhase phase;
  final List<DestinationSuggestion> results;
  final UbiSemanticColors colors;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    switch (phase) {
      case _SearchPhase.idle:
        return _Message(
          colors: colors,
          title: 'Where are you going?',
          body: 'Start typing a place name or an address.',
        );
      case _SearchPhase.searching:
        return const Center(child: CircularProgressIndicator());
      case _SearchPhase.empty:
        return _Message(
          colors: colors,
          title: 'No matches',
          body: 'Nothing matched that. Try a different spelling or a landmark '
              'nearby.',
        );
      case _SearchPhase.unavailable:
        return _Message(
          colors: colors,
          title: 'We could not search',
          body: 'Destination search is not reachable right now. Check your '
              'connection and try again.',
        );
      case _SearchPhase.results:
        return ListView.builder(
          key: testKey(TestIds.riderSearchResults),
          controller: scrollController,
          padding: const EdgeInsets.symmetric(horizontal: UbiSpace.x4),
          itemCount: results.length,
          itemBuilder: (BuildContext context, int index) {
            final DestinationSuggestion place = results[index];
            return ListTile(
              minVerticalPadding: UbiSpace.x3,
              leading: Icon(Icons.location_on_outlined, color: colors.text2),
              title: Text(place.title),
              subtitle: Text(place.subtitle),
              onTap: () => Navigator.of(context).pop(place),
            );
          },
        );
    }
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.colors,
    required this.title,
    required this.body,
  });

  final UbiSemanticColors colors;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UbiSpace.x6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              title,
              textAlign: TextAlign.center,
              style: UbiTokenTypography.titleMedium.copyWith(color: colors.ink),
            ),
            const SizedBox(height: UbiSpace.x2),
            Text(
              body,
              textAlign: TextAlign.center,
              style:
                  UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
            ),
          ],
        ),
      ),
    );
  }
}
