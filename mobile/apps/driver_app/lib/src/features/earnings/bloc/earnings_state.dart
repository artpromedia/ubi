part of 'earnings_bloc.dart';

/// Base class for all earnings states
sealed class EarningsState extends Equatable {
  const EarningsState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class EarningsInitial extends EarningsState {
  const EarningsInitial();
}

/// Loading state
class EarningsLoading extends EarningsState {
  const EarningsLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Today's earnings loaded
class EarningsTodayLoaded extends EarningsState {
  const EarningsTodayLoaded({
    required this.summary,
    required this.hourlyBreakdown,
    required this.recentTrips,
    required this.availableBalance,
  });

  final EarningsSummary summary;
  final List<HourlyEarnings> hourlyBreakdown;
  final List<TripEarningsEntry> recentTrips;
  final double availableBalance;

  @override
  List<Object?> get props => [summary, hourlyBreakdown, recentTrips, availableBalance];
}

/// Weekly earnings loaded
class EarningsWeekLoaded extends EarningsState {
  const EarningsWeekLoaded({
    required this.summary,
    required this.dailyBreakdown,
    required this.weekStart,
    required this.weekEnd,
    required this.availableBalance,
    this.previousWeekComparison,
  });

  final EarningsSummary summary;
  final List<DailyEarnings> dailyBreakdown;
  final DateTime weekStart;
  final DateTime weekEnd;
  final double availableBalance;
  final double? previousWeekComparison; // percentage change

  @override
  List<Object?> get props => [
        summary,
        dailyBreakdown,
        weekStart,
        weekEnd,
        availableBalance,
        previousWeekComparison,
      ];
}

/// Monthly earnings loaded
class EarningsMonthLoaded extends EarningsState {
  const EarningsMonthLoaded({
    required this.summary,
    required this.weeklyBreakdown,
    required this.month,
    required this.year,
    required this.availableBalance,
    this.previousMonthComparison,
  });

  final EarningsSummary summary;
  final List<WeeklyEarnings> weeklyBreakdown;
  final int month;
  final int year;
  final double availableBalance;
  final double? previousMonthComparison;

  @override
  List<Object?> get props => [
        summary,
        weeklyBreakdown,
        month,
        year,
        availableBalance,
        previousMonthComparison,
      ];
}

/// Custom date range earnings loaded
class EarningsDateRangeLoaded extends EarningsState {
  const EarningsDateRangeLoaded({
    required this.summary,
    required this.dailyBreakdown,
    required this.startDate,
    required this.endDate,
  });

  final EarningsSummary summary;
  final List<DailyEarnings> dailyBreakdown;
  final DateTime startDate;
  final DateTime endDate;

  @override
  List<Object?> get props => [summary, dailyBreakdown, startDate, endDate];
}

/// Trip history loaded
class EarningsTripHistoryLoaded extends EarningsState {
  const EarningsTripHistoryLoaded({
    required this.trips,
    required this.currentPage,
    required this.hasMore,
    this.filter,
  });

  final List<TripEarningsEntry> trips;
  final int currentPage;
  final bool hasMore;
  final TripHistoryFilter? filter;

  @override
  List<Object?> get props => [trips, currentPage, hasMore, filter];
}

/// Single trip details loaded
class EarningsTripDetailsLoaded extends EarningsState {
  const EarningsTripDetailsLoaded({required this.trip});

  final TripEarningsDetails trip;

  @override
  List<Object?> get props => [trip];
}

/// Payout history loaded
class EarningsPayoutsLoaded extends EarningsState {
  const EarningsPayoutsLoaded({
    required this.payouts,
    required this.availableBalance,
    required this.bankAccounts,
    required this.currentPage,
    required this.hasMore,
  });

  final List<PayoutEntry> payouts;
  final double availableBalance;
  final List<BankAccount> bankAccounts;
  final int currentPage;
  final bool hasMore;

  @override
  List<Object?> get props => [payouts, availableBalance, bankAccounts, currentPage, hasMore];
}

/// Payout requested
class EarningsPayoutRequested extends EarningsState {
  const EarningsPayoutRequested({
    required this.payoutId,
    required this.amount,
    required this.estimatedArrival,
  });

  final String payoutId;
  final double amount;
  final DateTime estimatedArrival;

  @override
  List<Object?> get props => [payoutId, amount, estimatedArrival];
}

/// Incentives loaded
class EarningsIncentivesLoaded extends EarningsState {
  const EarningsIncentivesLoaded({
    required this.activeIncentives,
    required this.completedIncentives,
    required this.totalEarned,
  });

  final List<Incentive> activeIncentives;
  final List<Incentive> completedIncentives;
  final double totalEarned;

  @override
  List<Object?> get props => [activeIncentives, completedIncentives, totalEarned];
}

/// Error state
class EarningsError extends EarningsState {
  const EarningsError({
    required this.message,
    this.previousState,
  });

  final String message;
  final EarningsState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}

// Additional models
class HourlyEarnings extends Equatable {
  const HourlyEarnings({
    required this.hour,
    required this.earnings,
    required this.trips,
  });

  final int hour; // 0-23
  final double earnings;
  final int trips;

  @override
  List<Object?> get props => [hour, earnings, trips];
}

class WeeklyEarnings extends Equatable {
  const WeeklyEarnings({
    required this.weekNumber,
    required this.weekStart,
    required this.earnings,
    required this.trips,
    required this.hours,
  });

  final int weekNumber;
  final DateTime weekStart;
  final double earnings;
  final int trips;
  final double hours;

  @override
  List<Object?> get props => [weekNumber, weekStart, earnings, trips, hours];
}

class TripEarningsDetails extends Equatable {
  const TripEarningsDetails({
    required this.id,
    required this.type,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.pickupTime,
    required this.dropoffTime,
    required this.distance,
    required this.duration,
    required this.baseFare,
    required this.distanceFare,
    required this.timeFare,
    required this.surgeMultiplier,
    required this.tips,
    required this.bonuses,
    required this.deductions,
    required this.totalFare,
    required this.driverEarnings,
    required this.paymentMethod,
    this.customer,
    this.routePolyline,
    this.rating,
    this.feedback,
  });

  final String id;
  final String type;
  final String status;
  final String pickupAddress;
  final String dropoffAddress;
  final DateTime pickupTime;
  final DateTime dropoffTime;
  final double distance;
  final int duration;
  final double baseFare;
  final double distanceFare;
  final double timeFare;
  final double surgeMultiplier;
  final double tips;
  final double bonuses;
  final double deductions;
  final double totalFare;
  final double driverEarnings;
  final String paymentMethod;
  final CustomerInfo? customer;
  final String? routePolyline;
  final int? rating;
  final String? feedback;

  @override
  List<Object?> get props => [
        id,
        type,
        status,
        pickupAddress,
        dropoffAddress,
        pickupTime,
        dropoffTime,
        distance,
        duration,
        baseFare,
        distanceFare,
        timeFare,
        surgeMultiplier,
        tips,
        bonuses,
        deductions,
        totalFare,
        driverEarnings,
        paymentMethod,
        customer,
        routePolyline,
        rating,
        feedback,
      ];
}

class CustomerInfo extends Equatable {
  const CustomerInfo({
    required this.name,
    this.photoUrl,
    this.rating,
  });

  final String name;
  final String? photoUrl;
  final double? rating;

  @override
  List<Object?> get props => [name, photoUrl, rating];
}
