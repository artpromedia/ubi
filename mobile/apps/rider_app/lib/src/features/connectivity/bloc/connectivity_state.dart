part of 'connectivity_bloc.dart';

abstract class ConnectivityState extends Equatable {
  const ConnectivityState();

  @override
  List<Object?> get props => [];

  bool get isOnline => this is ConnectivityOnline;
}

class ConnectivityInitial extends ConnectivityState {
  const ConnectivityInitial();
}

class ConnectivityOnline extends ConnectivityState {
  const ConnectivityOnline(this.type);

  final ConnectivityResult type;

  bool get isWifi => type == ConnectivityResult.wifi;
  bool get isMobile => type == ConnectivityResult.mobile;

  @override
  List<Object?> get props => [type];
}

class ConnectivityOffline extends ConnectivityState {
  const ConnectivityOffline();
}
