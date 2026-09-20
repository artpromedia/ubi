package marketplace

// commissionBps is the user-mandated marketplace commission: 10%, 1,000 basis
// points, on the accepted negotiated service fare. It is a contract literal
// (MarketplacePolicySchema.commissionBps), mirrored here for the arithmetic;
// the city policy is still validated to carry exactly this number.
const commissionBps = 1000

// CommissionMinor is the Go port of commissionMinorFor in
// packages/contracts/src/marketplace.ts: bps/10,000 with half-up rounding at
// the minor unit, in integer arithmetic. Services compute this; clients never
// do. A negative fare is a programming error upstream and answers 0 rather
// than a negative fee.
func CommissionMinor(fareMinor int64) int64 {
	if fareMinor <= 0 {
		return 0
	}
	return (fareMinor*commissionBps + 5_000) / 10_000
}
