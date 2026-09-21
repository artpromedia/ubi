package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"

	appMiddleware "github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/middleware"
)

// identityVerifier is the subset of *identity.Verifier this package needs.
// Routes takes an interface (satisfied by *identity.RequireIdentity's
// argument type) so this package does not need to import internal/identity
// directly for its own sake — RequireIdentityMiddleware below is supplied by
// the caller (cmd/server/main.go and testutil) instead, which already knows
// the concrete type. This keeps handlers free to be imported by testutil
// without a second import of identity leaking through here.
type requireIdentityMiddleware = func(http.Handler) http.Handler

// Routes builds the complete delivery-service router: every route
// cmd/server/main.go serves, plus the new custody/return routes (C07/G08).
// main.go and the test harness (internal/testutil) both call this, so the
// router under test is byte-for-byte the router production serves.
//
// custodyIdentity is the RequireIdentity middleware for the gateway-identity
// group (internal/identity.RequireIdentity(verifier)) — passed in rather than
// built here so this package need not import internal/identity just to spell
// its own routing table.
func Routes(h *Handler, custodyIdentity requireIdentityMiddleware) http.Handler {
	r := chi.NewRouter()

	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Compress(5))
	r.Use(chimiddleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "X-Idempotency-Key"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Use(httprate.LimitByIP(100, time.Minute))

	r.Get("/health", h.Health)
	r.Get("/health/live", h.Liveness)
	r.Get("/health/ready", h.Readiness)

	r.Route("/api/v1", func(r chi.Router) {
		// Deliveries (legacy, unmanaged open-market CRUD — internal/middleware's
		// own per-service JWT, unchanged).
		r.Route("/deliveries", func(r chi.Router) {
			r.Use(appMiddleware.Auth(h.rdb, h.cfg.JWTSecret))
			r.Post("/", h.CreateDelivery)
			r.Get("/", h.ListDeliveries)
			r.Get("/active", h.GetActiveDeliveries)
			r.Get("/{id}", h.GetDelivery)
			r.Get("/{id}/track", h.TrackDelivery)
			r.Post("/{id}/cancel", h.CancelDelivery)
			r.Post("/{id}/tip", h.AddTip)
		})

		// Custody/returns (C07, G08) — marketplace-managed deliveries only.
		// Gateway identity (rider/driver/admin), not the legacy per-service
		// JWT: senders, assigned drivers and ops are the only parties, and
		// permission checks compare the gateway-verified actor against the
		// delivery's own sender_id/driver_id — see internal/custody and this
		// file's handlers for the exact matrix.
		r.Route("/deliveries/{id}/custody", func(r chi.Router) {
			r.Use(custodyIdentity)
			r.Get("/", h.GetCustodyTimeline)
			r.Post("/pickup-proof", h.PostPickupProof)
			r.Post("/delivery-proof", h.PostDeliveryProof)
			r.Post("/recipient-unreachable", h.PostRecipientUnreachable)
			r.Post("/return/propose", h.PostProposeReturn)
			r.Post("/return/consent", h.PostReturnConsent)
			r.Post("/collected", h.PostCollectedAtPoint)
		})

		// Driver routes
		r.Route("/driver", func(r chi.Router) {
			r.Use(appMiddleware.Auth(h.rdb, h.cfg.JWTSecret))
			r.Use(appMiddleware.DriverOnly)
			r.Get("/deliveries/available", h.GetAvailableDeliveries)
			r.Post("/deliveries/{id}/accept", h.AcceptDelivery)
			r.Post("/deliveries/{id}/pickup", h.ConfirmPickup)
			r.Post("/deliveries/{id}/deliver", h.ConfirmDelivery)
			r.Post("/location", h.UpdateDriverLocation)
		})

		// Quotes
		r.Route("/quotes", func(r chi.Router) {
			r.Post("/", h.GetQuote)
		})

		// Zones
		r.Route("/zones", func(r chi.Router) {
			r.Get("/", h.GetZones)
			r.Get("/check", h.CheckZone)
		})

		// Webhooks (internal)
		r.Route("/webhooks", func(r chi.Router) {
			r.Use(appMiddleware.ServiceAuth(h.cfg.InternalServiceKey))
			r.Post("/payment", h.PaymentWebhook)
			r.Post("/order", h.OrderWebhook)
			// Marketplace award saga hand-off (idempotent on awardId).
			r.Post("/marketplace-assign", h.MarketplaceAssign)
		})
	})

	return r
}
