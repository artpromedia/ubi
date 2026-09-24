// Payment method ids the rider app names on marketplace requests. They must be ids the CITY
// CONFIG offers (services/config-service/src/seed/*: `paymentMethods[].id`), because every
// service re-checks the id against it (ride-service PaymentMethodAvailable, travel-service
// createTransfer) and refuses an unknown one with payment_method_unavailable. The server
// decides availability; these are only the names.

/** The rider's UBI wallet (city config id "wallet"). */
export const WALLET_PAYMENT_METHOD_ID = "wallet";
export const WALLET_PAYMENT_LABEL = "UBI Wallet";

/** A06 part C: the organization's budget pays instead of the rider (ride-service PaymentMethodBusiness). */
export const BUSINESS_PAYMENT_METHOD_ID = "business";
