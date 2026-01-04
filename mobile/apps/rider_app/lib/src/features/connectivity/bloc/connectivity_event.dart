part of 'connectivity_bloc.dart';

abstract class ConnectivityEvent extends Equatable {
  const ConnectivityEvent();

  @override
  List<Object?> get props => [];
}

class ConnectivityStarted extends ConnectivityEvent {
  const ConnectivityStarted();
}

class ConnectivityChanged extends ConnectivityEvent {
  const ConnectivityChanged(this.results);

  final List<ConnectivityResult> results;

  @override
  List<Object?> get props => [results];
}
