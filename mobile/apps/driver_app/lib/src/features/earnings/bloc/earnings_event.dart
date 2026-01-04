part of 'earnings_bloc.dart';

/// Base class for all earnings events
sealed class EarningsEvent extends Equatable {
  const EarningsEvent();

  @override
  List<Object?> get props => [];
}

/// Load today's earnings
class EarningsLoadToday extends EarningsEvent {
  const EarningsLoadToday();
}

/// Load weekly earnings
class EarningsLoadWeek extends EarningsEvent {
  const EarningsLoadWeek({this.weekOffset = 0});

  final int weekOffset; // 0 = current week, -1 = last week, etc.

  @override
  List<Object?> get props => [weekOffset];
}

/// Load monthly earnings
class EarningsLoadMonth extends EarningsEvent {
  const EarningsLoadMonth({this.monthOffset = 0});

  final int monthOffset;

  @override
  List<Object?> get props => [monthOffset];
}

/// Load custom date range earnings
class EarningsLoadDateRange extends EarningsEvent {
  const EarningsLoadDateRange({
    required this.startDate,
    required this.endDate,
  });

  final DateTime startDate;
  final DateTime endDate;

  @override
  List<Object?> get props => [startDate, endDate];
}

/// Load trip history
class EarningsLoadTripHistory extends EarningsEvent {
  const EarningsLoadTripHistory({
    this.page = 1,
    this.filter,
  });

  final int page;
  final TripHistoryFilter? filter;

  @override
  List<Object?> get props => [page, filter];
}

/// Load more trip history
class EarningsLoadMoreTrips extends EarningsEvent {
  const EarningsLoadMoreTrips();
}

/// Load trip details
class EarningsLoadTripDetails extends EarningsEvent {
  const EarningsLoadTripDetails({required this.tripId});

  final String tripId;

  @override
  List<Object?> get props => [tripId];
}

/// Load payout history
class EarningsLoadPayouts extends EarningsEvent {
  const EarningsLoadPayouts({this.page = 1});

  final int page;

  @override
  List<Object?> get props => [page];
}

/// Request instant payout
class EarningsRequestPayout extends EarningsEvent {
  const EarningsRequestPayout({this.amount});

  final double? amount; // null = withdraw all available

  @override
  List<Object?> get props => [amount];
}

/// Update bank account
class EarningsUpdateBankAccount extends EarningsEvent {
  const EarningsUpdateBankAccount({required this.bankAccount});

  final BankAccount bankAccount;

  @override
  List<Object?> get props => [bankAccount];
}

/// Load incentives and bonuses
class EarningsLoadIncentives extends EarningsEvent {
  const EarningsLoadIncentives();
}

/// Reset earnings state
class EarningsReset extends EarningsEvent {
  const EarningsReset();
}

// Filter model
class TripHistoryFilter extends Equatable {
  const TripHistoryFilter({
    this.tripType,
    this.minAmount,
    this.maxAmount,
    this.startDate,
    this.endDate,
  });

  final String? tripType;
  final double? minAmount;
  final double? maxAmount;
  final DateTime? startDate;
  final DateTime? endDate;

  @override
  List<Object?> get props => [tripType, minAmount, maxAmount, startDate, endDate];
}

// Models
class BankAccount extends Equatable {
  const BankAccount({
    required this.id,
    required this.bankName,
    required this.accountNumber,
    required this.accountHolderName,
    this.isDefault = false,
  });

  final String id;
  final String bankName;
  final String accountNumber;
  final String accountHolderName;
  final bool isDefault;

  String get maskedNumber => '****${accountNumber.substring(accountNumber.length - 4)}';

  @override
  List<Object?> get props => [id, bankName, accountNumber, accountHolderName, isDefault];
}

class EarningsSummary extends Equatable {
  const EarningsSummary({
    required this.totalEarnings,
    required this.tripEarnings,
    required this.tips,
    required this.bonuses,
    required this.deductions,
    required this.netEarnings,
    required this.tripCount,
    required this.onlineHours,
    required this.averagePerTrip,
    required this.averagePerHour,
    this.surgeEarnings = 0,
    this.cashCollected = 0,
  });

  factory EarningsSummary.empty() => const EarningsSummary(
        totalEarnings: 0,
        tripEarnings: 0,
        tips: 0,
        bonuses: 0,
        deductions: 0,
        netEarnings: 0,
        tripCount: 0,
        onlineHours: 0,
        averagePerTrip: 0,
        averagePerHour: 0,
      );

  final double totalEarnings;
  final double tripEarnings;
  final double tips;
  final double bonuses;
  final double surgeEarnings;
  final double deductions;
  final double netEarnings;
  final double cashCollected;
  final int tripCount;
  final double onlineHours;
  final double averagePerTrip;
  final double averagePerHour;

  @override
  List<Object?> get props => [
        totalEarnings,
        tripEarnings,
        tips,
        bonuses,
        surgeEarnings,
        deductions,
        netEarnings,
        cashCollected,
        tripCount,
        onlineHours,
        averagePerTrip,
        averagePerHour,
      ];
}

class DailyEarnings extends Equatable {
  const DailyEarnings({
    required this.date,
    required this.earnings,
    required this.trips,
    required this.hours,
  });

  final DateTime date;
  final double earnings;
  final int trips;
  final double hours;

  @override
  List<Object?> get props => [date, earnings, trips, hours];
}

class TripEarningsEntry extends Equatable {
  const TripEarningsEntry({
    required this.id,
    required this.type,
    required this.earnings,
    required this.tips,
    required this.completedAt,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.customerName,
    this.distance,
    this.duration,
  });

  final String id;
  final String type;
  final double earnings;
  final double tips;
  final DateTime completedAt;
  final String pickupAddress;
  final String dropoffAddress;
  final String? customerName;
  final double? distance;
  final int? duration;

  double get totalEarnings => earnings + tips;

  @override
  List<Object?> get props => [
        id,
        type,
        earnings,
        tips,
        completedAt,
        pickupAddress,
        dropoffAddress,
        customerName,
        distance,
        duration,
      ];
}

class PayoutEntry extends Equatable {
  const PayoutEntry({
    required this.id,
    required this.amount,
    required this.status,
    required this.requestedAt,
    required this.bankAccount,
    this.processedAt,
    this.reference,
  });

  final String id;
  final double amount;
  final PayoutStatus status;
  final DateTime requestedAt;
  final BankAccount bankAccount;
  final DateTime? processedAt;
  final String? reference;

  @override
  List<Object?> get props => [
        id,
        amount,
        status,
        requestedAt,
        bankAccount,
        processedAt,
        reference,
      ];
}

enum PayoutStatus { pending, processing, completed, failed }

class Incentive extends Equatable {
  const Incentive({
    required this.id,
    required this.title,
    required this.description,
    required this.type,
    required this.targetValue,
    required this.currentValue,
    required this.rewardAmount,
    required this.expiresAt,
    this.isCompleted = false,
  });

  final String id;
  final String title;
  final String description;
  final IncentiveType type;
  final int targetValue;
  final int currentValue;
  final double rewardAmount;
  final DateTime expiresAt;
  final bool isCompleted;

  double get progress => currentValue / targetValue;
  bool get isExpired => DateTime.now().isAfter(expiresAt);

  @override
  List<Object?> get props => [
        id,
        title,
        description,
        type,
        targetValue,
        currentValue,
        rewardAmount,
        expiresAt,
        isCompleted,
      ];
}

enum IncentiveType { tripCount, earnings, onlineHours, acceptanceRate, streak }
