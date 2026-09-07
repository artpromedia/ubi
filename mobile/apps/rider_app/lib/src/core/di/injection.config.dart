// GENERATED CODE - DO NOT MODIFY BY HAND

// **************************************************************************
// InjectableConfigGenerator
// **************************************************************************

// ignore_for_file: type=lint
// coverage:ignore-file

// ignore_for_file: no_leading_underscores_for_library_prefixes
import 'package:connectivity_plus/connectivity_plus.dart' as _i895;
import 'package:get_it/get_it.dart' as _i174;
import 'package:google_sign_in/google_sign_in.dart' as _i116;
import 'package:injectable/injectable.dart' as _i526;
import 'package:ubi_core/ubi_core.dart' as _i426;
import 'package:ubi_storage/ubi_storage.dart' as _i184;

import '../../features/auth/bloc/auth_bloc.dart' as _i55;
import '../../features/connectivity/bloc/connectivity_bloc.dart' as _i978;

extension GetItInjectableX on _i174.GetIt {
// initializes the registration of main-scope dependencies inside of GetIt
  _i174.GetIt init({
    String? environment,
    _i526.EnvironmentFilter? environmentFilter,
  }) {
    final gh = _i526.GetItHelper(
      this,
      environment,
      environmentFilter,
    );
    gh.lazySingleton<_i978.ConnectivityBloc>(
        () => _i978.ConnectivityBloc(connectivity: gh<_i895.Connectivity>()));
    gh.lazySingleton<_i55.AuthBloc>(() => _i55.AuthBloc(
          authRepository: gh<_i426.AuthRepository>(),
          tokenStorage: gh<_i184.TokenStorage>(),
          googleSignIn: gh<_i116.GoogleSignIn>(),
        ));
    return this;
  }
}
