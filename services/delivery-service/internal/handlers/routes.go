package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
	appMiddleware "github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/middleware"
)

// requireIdentityMiddleware is the shape of identity.RequireIdentity(verifier):
// the middleware guarding the gateway-identity (custody/return) group.
type requireIdentityMiddleware = func(http.Handler) http.Handler

// NewRouter is the router the process serves: Routes with the custody/return
// group behind a gateway-identity verifier in the posture the handler's
// configuration demands — identity.NewVerifierFor(..., cfg.IsProduction()),
// so in production a signature is mandatory and the plain identity headers
// alone authenticate nobody. cmd/server/main.go serves exactly this, and the
// test harness builds exactly this, so the identity posture under test is the
// posture production runs. The verifier is returned for start-up logging and
// so tests can sign a request the way the gateway does.
func NewRouter(h *Handler) (http.Handler, *identity.Verifier) {
	verifier := identity.NewVerifierFor(h.cfg.InternalContextSecret, 0, h.cfg.IsProduction())
	return Routes(h, identity.RequireIdentity(verifier)), verifier
}

// Routes builds the complete delivery-service router: every route
// cmd/server/main.go serves, plus the new custody/return routes (C07/G08).
// main.go and the test harness (internal/testutil) both reach it through
// NewRouter, so the router under test is byte-for-byte the router production
// serves.
//
// custodyIdentity is the RequireIdentity middleware for the gateway-identity
// group (internal/identity.RequireIdentity(verifier)). Production wiring goes
// through NewRouter, which picks the verifier's posture from configuration;
// Routes stays parameterised so a test can mount a verifier in a posture of
// its own choosing.
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
		//
		// Proofs (P17) are verified objects in the private proof bucket:
		// proof-uploads issues a short-lived presigned PUT for a server-made
		// key; the proof endpoints attach an upload only after verifying the
		// stored bytes; proofs/{proofId}/url mints a seconds-long presigned
		// GET for an entitled party. Charged returns (P17, deny-by-default)
		// add return/complete (the driver's verified hand-back, which
		// captures a reserved fee) and return/cancel-charge (ops).
		r.Route("/deliveries/{id}/custody", func(r chi.Router) {
			r.Use(custodyIdentity)
			r.Get("/", h.GetCustodyTimeline)
			r.Post("/proof-uploads", h.PostProofUpload)
			r.Get("/proofs/{proofId}/url", h.GetProofURL)
			r.Post("/pickup-proof", h.PostPickupProof)
			r.Post("/delivery-proof", h.PostDeliveryProof)
			r.Post("/recipient-unreachable", h.PostRecipientUnreachable)
			r.Post("/return/propose", h.PostProposeReturn)
			r.Post("/return/consent", h.PostReturnConsent)
			r.Post("/return/complete", h.PostReturnComplete)
			r.Post("/return/cancel-charge", h.PostReturnCancelCharge)
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
