import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';

part 'connectivity_event.dart';
part 'connectivity_state.dart';

/// Connectivity BLoC to track network status
@lazySingleton
class ConnectivityBloc extends Bloc<ConnectivityEvent, ConnectivityState> {
  ConnectivityBloc({Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity(),
        super(const ConnectivityInitial()) {
    on<ConnectivityStarted>(_onStarted);
    on<ConnectivityChanged>(_onChanged);
  }

  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _subscription;

  Future<void> _onStarted(
    ConnectivityStarted event,
    Emitter<ConnectivityState> emit,
  ) async {
    // Check current status
    final results = await _connectivity.checkConnectivity();
    _emitStatus(results, emit);

    // Listen to changes
    _subscription?.cancel();
    _subscription = _connectivity.onConnectivityChanged.listen(
      (results) => add(ConnectivityChanged(results)),
    );
  }

  void _onChanged(
    ConnectivityChanged event,
    Emitter<ConnectivityState> emit,
  ) {
    _emitStatus(event.results, emit);
  }

  void _emitStatus(List<ConnectivityResult> results, Emitter<ConnectivityState> emit) {
    final hasConnection = results.any((r) => r != ConnectivityResult.none);
    
    if (hasConnection) {
      final connectionType = results.firstWhere(
        (r) => r != ConnectivityResult.none,
        orElse: () => ConnectivityResult.other,
      );
      emit(ConnectivityOnline(connectionType));
    } else {
      emit(const ConnectivityOffline());
    }
  }

  @override
  Future<void> close() {
    _subscription?.cancel();
    return super.close();
  }
}
