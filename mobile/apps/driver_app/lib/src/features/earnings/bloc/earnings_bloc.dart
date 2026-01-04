import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'earnings_event.dart';
part 'earnings_state.dart';

/// BLoC for managing driver earnings and payouts
class EarningsBloc extends Bloc<EarningsEvent, EarningsState> {
  EarningsBloc() : super(const EarningsInitial()) {
    on<EarningsLoadToday>(_onLoadToday);
    on<EarningsLoadWeek>(_onLoadWeek);
    on<EarningsLoadMonth>(_onLoadMonth);
    on<EarningsLoadDateRange>(_onLoadDateRange);
    on<EarningsLoadTripHistory>(_onLoadTripHistory);
    on<EarningsLoadMoreTrips>(_onLoadMoreTrips);
    on<EarningsLoadTripDetails>(_onLoadTripDetails);
    on<EarningsLoadPayouts>(_onLoadPayouts);
    on<EarningsRequestPayout>(_onRequestPayout);
    on<EarningsUpdateBankAccount>(_onUpdateBankAccount);
    on<EarningsLoadIncentives>(_onLoadIncentives);
    on<EarningsReset>(_onReset);
  }

  // Cached trip history for pagination
  List<TripEarningsEntry> _tripHistoryCache = [];
  int _currentPage = 1;
  TripHistoryFilter? _currentFilter;

  Future<void> _onLoadToday(
    EarningsLoadToday event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading today\'s earnings...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Mock today's earnings
      const summary = EarningsSummary(
        totalEarnings: 2450.0,
        tripEarnings: 2100.0,
        tips: 200.0,
        bonuses: 150.0,
        surgeEarnings: 350.0,
        deductions: 0,
        netEarnings: 2450.0,
        cashCollected: 800.0,
        tripCount: 8,
        onlineHours: 5.5,
        averagePerTrip: 306.25,
        averagePerHour: 445.45,
      );

      // Hourly breakdown
      final hourlyBreakdown = List.generate(24, (hour) {
        if (hour >= 6 && hour <= 22) {
          return HourlyEarnings(
            hour: hour,
            earnings: (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)
                ? 350.0 + (hour % 3) * 50
                : 150.0 + (hour % 5) * 20,
            trips: (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 2 : 1,
          );
        }
        return HourlyEarnings(hour: hour, earnings: 0, trips: 0);
      });

      // Recent trips
      final recentTrips = [
        TripEarningsEntry(
          id: 'trip-1',
          type: 'ride',
          earnings: 320.0,
          tips: 30.0,
          completedAt: DateTime.now().subtract(const Duration(minutes: 30)),
          pickupAddress: 'Westlands Mall',
          dropoffAddress: 'KICC',
          customerName: 'John D.',
          distance: 5.2,
          duration: 18,
        ),
        TripEarningsEntry(
          id: 'trip-2',
          type: 'food',
          earnings: 180.0,
          tips: 20.0,
          completedAt: DateTime.now().subtract(const Duration(hours: 1)),
          pickupAddress: 'Java House Lavington',
          dropoffAddress: 'Valley Arcade',
          customerName: 'Sarah M.',
          distance: 3.1,
          duration: 12,
        ),
        TripEarningsEntry(
          id: 'trip-3',
          type: 'ride',
          earnings: 450.0,
          tips: 50.0,
          completedAt: DateTime.now().subtract(const Duration(hours: 2)),
          pickupAddress: 'Jomo Kenyatta Airport',
          dropoffAddress: 'Westlands',
          customerName: 'Mike K.',
          distance: 12.5,
          duration: 35,
        ),
      ];

      emit(EarningsTodayLoaded(
        summary: summary,
        hourlyBreakdown: hourlyBreakdown,
        recentTrips: recentTrips,
        availableBalance: 15680.0,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load earnings: $e'));
    }
  }

  Future<void> _onLoadWeek(
    EarningsLoadWeek event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading weekly earnings...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final now = DateTime.now();
      final weekStart = now.subtract(Duration(days: now.weekday - 1 + (event.weekOffset * 7)));
      final weekEnd = weekStart.add(const Duration(days: 6));

      const summary = EarningsSummary(
        totalEarnings: 18500.0,
        tripEarnings: 16200.0,
        tips: 1500.0,
        bonuses: 800.0,
        surgeEarnings: 2100.0,
        deductions: 450.0,
        netEarnings: 18050.0,
        cashCollected: 5200.0,
        tripCount: 52,
        onlineHours: 38.5,
        averagePerTrip: 355.77,
        averagePerHour: 480.52,
      );

      final dailyBreakdown = [
        DailyEarnings(
          date: weekStart,
          earnings: 2800.0,
          trips: 8,
          hours: 6.5,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 1)),
          earnings: 3200.0,
          trips: 9,
          hours: 7.0,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 2)),
          earnings: 2500.0,
          trips: 7,
          hours: 5.5,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 3)),
          earnings: 2900.0,
          trips: 8,
          hours: 6.0,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 4)),
          earnings: 3500.0,
          trips: 10,
          hours: 7.5,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 5)),
          earnings: 2600.0,
          trips: 7,
          hours: 5.0,
        ),
        DailyEarnings(
          date: weekStart.add(const Duration(days: 6)),
          earnings: 0,
          trips: 0,
          hours: 0,
        ),
      ];

      emit(EarningsWeekLoaded(
        summary: summary,
        dailyBreakdown: dailyBreakdown,
        weekStart: weekStart,
        weekEnd: weekEnd,
        availableBalance: 15680.0,
        previousWeekComparison: 12.5, // 12.5% increase
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load weekly earnings: $e'));
    }
  }

  Future<void> _onLoadMonth(
    EarningsLoadMonth event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading monthly earnings...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final now = DateTime.now();
      final targetMonth = now.month + event.monthOffset;
      final targetYear = now.year + (targetMonth <= 0 ? -1 : 0);
      final adjustedMonth = targetMonth <= 0 ? 12 + targetMonth : targetMonth;

      const summary = EarningsSummary(
        totalEarnings: 72500.0,
        tripEarnings: 64000.0,
        tips: 5500.0,
        bonuses: 3000.0,
        surgeEarnings: 8500.0,
        deductions: 1800.0,
        netEarnings: 70700.0,
        cashCollected: 22000.0,
        tripCount: 195,
        onlineHours: 152.0,
        averagePerTrip: 371.79,
        averagePerHour: 476.97,
      );

      final weeklyBreakdown = [
        WeeklyEarnings(
          weekNumber: 1,
          weekStart: DateTime(targetYear, adjustedMonth, 1),
          earnings: 18500.0,
          trips: 52,
          hours: 38.5,
        ),
        WeeklyEarnings(
          weekNumber: 2,
          weekStart: DateTime(targetYear, adjustedMonth, 8),
          earnings: 17200.0,
          trips: 48,
          hours: 36.0,
        ),
        WeeklyEarnings(
          weekNumber: 3,
          weekStart: DateTime(targetYear, adjustedMonth, 15),
          earnings: 19500.0,
          trips: 55,
          hours: 40.5,
        ),
        WeeklyEarnings(
          weekNumber: 4,
          weekStart: DateTime(targetYear, adjustedMonth, 22),
          earnings: 17300.0,
          trips: 40,
          hours: 37.0,
        ),
      ];

      emit(EarningsMonthLoaded(
        summary: summary,
        weeklyBreakdown: weeklyBreakdown,
        month: adjustedMonth,
        year: targetYear,
        availableBalance: 15680.0,
        previousMonthComparison: 8.2,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load monthly earnings: $e'));
    }
  }

  Future<void> _onLoadDateRange(
    EarningsLoadDateRange event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading earnings...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final dayCount = event.endDate.difference(event.startDate).inDays + 1;

      final summary = EarningsSummary(
        totalEarnings: dayCount * 2500.0,
        tripEarnings: dayCount * 2200.0,
        tips: dayCount * 200.0,
        bonuses: dayCount * 100.0,
        deductions: dayCount * 50.0,
        netEarnings: dayCount * 2450.0,
        tripCount: dayCount * 7,
        onlineHours: dayCount * 5.5,
        averagePerTrip: 357.14,
        averagePerHour: 454.55,
      );

      final dailyBreakdown = List.generate(dayCount, (index) {
        final date = event.startDate.add(Duration(days: index));
        return DailyEarnings(
          date: date,
          earnings: 2200.0 + (index % 3) * 300,
          trips: 6 + (index % 4),
          hours: 5.0 + (index % 3),
        );
      });

      emit(EarningsDateRangeLoaded(
        summary: summary,
        dailyBreakdown: dailyBreakdown,
        startDate: event.startDate,
        endDate: event.endDate,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load earnings: $e'));
    }
  }

  Future<void> _onLoadTripHistory(
    EarningsLoadTripHistory event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading trip history...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Generate mock trips
      final trips = _generateMockTrips(event.page);

      _tripHistoryCache = trips;
      _currentPage = event.page;
      _currentFilter = event.filter;

      emit(EarningsTripHistoryLoaded(
        trips: trips,
        currentPage: event.page,
        hasMore: event.page < 5, // Assume 5 pages of history
        filter: event.filter,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load trip history: $e'));
    }
  }

  Future<void> _onLoadMoreTrips(
    EarningsLoadMoreTrips event,
    Emitter<EarningsState> emit,
  ) async {
    final currentState = state;

    if (currentState is! EarningsTripHistoryLoaded || !currentState.hasMore) {
      return;
    }

    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final moreTrips = _generateMockTrips(_currentPage + 1);
      _tripHistoryCache = [..._tripHistoryCache, ...moreTrips];
      _currentPage++;

      emit(EarningsTripHistoryLoaded(
        trips: _tripHistoryCache,
        currentPage: _currentPage,
        hasMore: _currentPage < 5,
        filter: _currentFilter,
      ));
    } catch (e) {
      emit(EarningsError(
        message: 'Failed to load more trips: $e',
        previousState: currentState,
      ));
    }
  }

  Future<void> _onLoadTripDetails(
    EarningsLoadTripDetails event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading trip details...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final trip = TripEarningsDetails(
        id: event.tripId,
        type: 'ride',
        status: 'completed',
        pickupAddress: 'Westlands Mall, Westlands',
        dropoffAddress: 'KICC, City Centre',
        pickupTime: DateTime.now().subtract(const Duration(hours: 2)),
        dropoffTime: DateTime.now().subtract(const Duration(hours: 1, minutes: 42)),
        distance: 5.2,
        duration: 18,
        baseFare: 100.0,
        distanceFare: 150.0,
        timeFare: 50.0,
        surgeMultiplier: 1.2,
        tips: 30.0,
        bonuses: 0,
        deductions: 0,
        totalFare: 390.0,
        driverEarnings: 312.0,
        paymentMethod: 'card',
        customer: const CustomerInfo(
          name: 'John Doe',
          rating: 4.8,
        ),
        rating: 5,
        feedback: 'Great ride!',
      );

      emit(EarningsTripDetailsLoaded(trip: trip));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load trip details: $e'));
    }
  }

  Future<void> _onLoadPayouts(
    EarningsLoadPayouts event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading payouts...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final payouts = [
        PayoutEntry(
          id: 'payout-1',
          amount: 15000.0,
          status: PayoutStatus.completed,
          requestedAt: DateTime.now().subtract(const Duration(days: 2)),
          processedAt: DateTime.now().subtract(const Duration(days: 1)),
          bankAccount: const BankAccount(
            id: 'bank-1',
            bankName: 'KCB Bank',
            accountNumber: '1234567890',
            accountHolderName: 'John Driver',
            isDefault: true,
          ),
          reference: 'TXN123456',
        ),
        PayoutEntry(
          id: 'payout-2',
          amount: 12000.0,
          status: PayoutStatus.completed,
          requestedAt: DateTime.now().subtract(const Duration(days: 9)),
          processedAt: DateTime.now().subtract(const Duration(days: 8)),
          bankAccount: const BankAccount(
            id: 'bank-1',
            bankName: 'KCB Bank',
            accountNumber: '1234567890',
            accountHolderName: 'John Driver',
            isDefault: true,
          ),
          reference: 'TXN123457',
        ),
      ];

      const bankAccounts = [
        BankAccount(
          id: 'bank-1',
          bankName: 'KCB Bank',
          accountNumber: '1234567890',
          accountHolderName: 'John Driver',
          isDefault: true,
        ),
        BankAccount(
          id: 'bank-2',
          bankName: 'Equity Bank',
          accountNumber: '0987654321',
          accountHolderName: 'John Driver',
          isDefault: false,
        ),
      ];

      emit(EarningsPayoutsLoaded(
        payouts: payouts,
        availableBalance: 15680.0,
        bankAccounts: bankAccounts,
        currentPage: event.page,
        hasMore: false,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load payouts: $e'));
    }
  }

  Future<void> _onRequestPayout(
    EarningsRequestPayout event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Processing payout...'));

    try {
      await Future.delayed(const Duration(seconds: 1));

      final amount = event.amount ?? 15680.0;

      emit(EarningsPayoutRequested(
        payoutId: 'payout-new-${DateTime.now().millisecondsSinceEpoch}',
        amount: amount,
        estimatedArrival: DateTime.now().add(const Duration(hours: 24)),
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to request payout: $e'));
    }
  }

  Future<void> _onUpdateBankAccount(
    EarningsUpdateBankAccount event,
    Emitter<EarningsState> emit,
  ) async {
    // Update bank account via API
    // This is typically a side effect
  }

  Future<void> _onLoadIncentives(
    EarningsLoadIncentives event,
    Emitter<EarningsState> emit,
  ) async {
    emit(const EarningsLoading(message: 'Loading incentives...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final activeIncentives = [
        Incentive(
          id: 'inc-1',
          title: 'Weekend Warrior',
          description: 'Complete 15 trips this weekend',
          type: IncentiveType.tripCount,
          targetValue: 15,
          currentValue: 8,
          rewardAmount: 500.0,
          expiresAt: DateTime.now().add(const Duration(days: 2)),
        ),
        Incentive(
          id: 'inc-2',
          title: 'Peak Hour Hero',
          description: 'Be online for 4 hours during rush hour',
          type: IncentiveType.onlineHours,
          targetValue: 4,
          currentValue: 2,
          rewardAmount: 200.0,
          expiresAt: DateTime.now().add(const Duration(days: 1)),
        ),
        Incentive(
          id: 'inc-3',
          title: 'Consistency Bonus',
          description: 'Maintain 90% acceptance rate',
          type: IncentiveType.acceptanceRate,
          targetValue: 90,
          currentValue: 92,
          rewardAmount: 300.0,
          expiresAt: DateTime.now().add(const Duration(days: 5)),
        ),
      ];

      final completedIncentives = [
        Incentive(
          id: 'inc-4',
          title: 'First Week Complete',
          description: 'Complete 50 trips in your first week',
          type: IncentiveType.tripCount,
          targetValue: 50,
          currentValue: 50,
          rewardAmount: 1000.0,
          expiresAt: DateTime.now().subtract(const Duration(days: 7)),
          isCompleted: true,
        ),
      ];

      emit(EarningsIncentivesLoaded(
        activeIncentives: activeIncentives,
        completedIncentives: completedIncentives,
        totalEarned: 1000.0,
      ));
    } catch (e) {
      emit(EarningsError(message: 'Failed to load incentives: $e'));
    }
  }

  void _onReset(
    EarningsReset event,
    Emitter<EarningsState> emit,
  ) {
    _tripHistoryCache = [];
    _currentPage = 1;
    _currentFilter = null;
    emit(const EarningsInitial());
  }

  List<TripEarningsEntry> _generateMockTrips(int page) {
    final baseDate = DateTime.now().subtract(Duration(days: (page - 1) * 7));

    return List.generate(10, (index) {
      final tripDate = baseDate.subtract(Duration(hours: index * 3));
      final types = ['ride', 'food', 'delivery'];
      final type = types[index % 3];

      return TripEarningsEntry(
        id: 'trip-$page-$index',
        type: type,
        earnings: 200.0 + (index % 5) * 50,
        tips: (index % 3) * 20.0,
        completedAt: tripDate,
        pickupAddress: 'Location ${index + 1}A',
        dropoffAddress: 'Location ${index + 1}B',
        customerName: 'Customer $index',
        distance: 3.0 + (index % 10),
        duration: 10 + (index % 20),
      );
    });
  }
}
