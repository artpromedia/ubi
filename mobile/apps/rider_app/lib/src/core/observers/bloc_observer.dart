import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter/foundation.dart';

/// Custom BLoC observer for logging and debugging
class AppBlocObserver extends BlocObserver {
  @override
  void onCreate(BlocBase bloc) {
    super.onCreate(bloc);
    if (kDebugMode) {
      print('🟢 onCreate -- ${bloc.runtimeType}');
    }
  }

  @override
  void onChange(BlocBase bloc, Change change) {
    super.onChange(bloc, change);
    if (kDebugMode) {
      print('🔄 onChange -- ${bloc.runtimeType}');
      print('   Current: ${change.currentState.runtimeType}');
      print('   Next: ${change.nextState.runtimeType}');
    }
  }

  @override
  void onEvent(Bloc bloc, Object? event) {
    super.onEvent(bloc, event);
    if (kDebugMode) {
      print('📤 onEvent -- ${bloc.runtimeType}');
      print('   Event: ${event.runtimeType}');
    }
  }

  @override
  void onTransition(Bloc bloc, Transition transition) {
    super.onTransition(bloc, transition);
    if (kDebugMode) {
      print('🔀 onTransition -- ${bloc.runtimeType}');
      print('   ${transition.currentState.runtimeType} → ${transition.nextState.runtimeType}');
    }
  }

  @override
  void onError(BlocBase bloc, Object error, StackTrace stackTrace) {
    super.onError(bloc, error, stackTrace);
    if (kDebugMode) {
      print('❌ onError -- ${bloc.runtimeType}');
      print('   Error: $error');
      print('   StackTrace: $stackTrace');
    }
  }

  @override
  void onClose(BlocBase bloc) {
    super.onClose(bloc);
    if (kDebugMode) {
      print('🔴 onClose -- ${bloc.runtimeType}');
    }
  }
}
