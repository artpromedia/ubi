package handler_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/handler"
)

// The route manifest is the durable record of every METHOD + chi pattern this
// service serves. The API gateway's contract test
// (services/api-gateway/tests/route-contract.test.ts) reads it to prove that
// every gateway proxy rule lands on a route that exists here — the round-4
// outage was a gateway that stripped /v1 in front of a service that mounts
// everything under /v1, and nothing in CI could see it.
//
// The manifest is built from the REAL router: the same RideHandler.Routes
// constructor cmd/server/main.go mounts, at the prefix main.go mounts it at,
// plus the probes main.go registers directly. The prefix and the probes are
// read from main.go's syntax tree rather than restated here, so moving the
// mount (or adding a route main.go serves outside Routes) changes the manifest
// and turns this test red until the manifest — and with it the gateway
// contract — is regenerated.
const (
	routeManifestFile   = "routes.manifest"
	mainGoFile          = "../../cmd/server/main.go"
	updateManifestEnv   = "UPDATE_ROUTE_MANIFEST"
	regenerateCommand   = "UPDATE_ROUTE_MANIFEST=1 go test ./internal/handler/ -run TestRouteManifest"
	routeManifestHeader = `# ride-service route manifest: every METHOD + chi pattern the production
# router serves (cmd/server/main.go: the probes it registers directly plus
# RideHandler.Routes at its mount prefix). GENERATED — do not edit by hand.
# Regenerate: (cd services/ride-service && ` + regenerateCommand + `)
# Read by services/api-gateway/tests/route-contract.test.ts.
`
)

// mainGoRoutes is what cmd/server/main.go serves, read from its syntax tree.
type mainGoRoutes struct {
	// apiPrefix is the pattern main.go mounts RideHandler.Routes at.
	apiPrefix string
	// direct holds "METHOD pattern" for every route main.go registers itself.
	direct []string
}

// routerMethods are the chi.Router methods that register one route.
var routerMethods = map[string]string{
	"Get":     http.MethodGet,
	"Post":    http.MethodPost,
	"Put":     http.MethodPut,
	"Patch":   http.MethodPatch,
	"Delete":  http.MethodDelete,
	"Head":    http.MethodHead,
	"Options": http.MethodOptions,
}

func stringLiteral(t *testing.T, fset *token.FileSet, expr ast.Expr) string {
	t.Helper()
	lit, ok := expr.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		t.Fatalf("%s: main.go registers a route with a non-literal pattern; teach routes_manifest_test.go to resolve it", fset.Position(expr.Pos()))
	}
	value, err := strconv.Unquote(lit.Value)
	if err != nil {
		t.Fatalf("%s: unquote %s: %v", fset.Position(lit.Pos()), lit.Value, err)
	}
	return value
}

// readMainGoRoutes parses cmd/server/main.go and returns what its `router`
// serves. Anything it cannot account for is a failure, never a silent skip: a
// route main.go serves that the manifest does not list is exactly the drift
// this test exists to catch.
func readMainGoRoutes(t *testing.T) mainGoRoutes {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, mainGoFile, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", mainGoFile, err)
	}

	var routes mainGoRoutes
	mounts := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		receiver, ok := selector.X.(*ast.Ident)
		if !ok || receiver.Name != "router" {
			return true
		}
		name := selector.Sel.Name
		switch {
		case name == "Use":
			// Middleware registers no route.
		case name == "Mount":
			if len(call.Args) != 2 {
				t.Fatalf("%s: router.Mount with %d arguments", fset.Position(call.Pos()), len(call.Args))
			}
			target, ok := call.Args[1].(*ast.CallExpr)
			if !ok {
				t.Fatalf("%s: main.go mounts something other than RideHandler.Routes; extend routes_manifest_test.go to walk it", fset.Position(call.Pos()))
			}
			targetSelector, ok := target.Fun.(*ast.SelectorExpr)
			if !ok || targetSelector.Sel.Name != "Routes" {
				t.Fatalf("%s: main.go mounts something other than RideHandler.Routes; extend routes_manifest_test.go to walk it", fset.Position(call.Pos()))
			}
			routes.apiPrefix = stringLiteral(t, fset, call.Args[0])
			mounts++
		case routerMethods[name] != "":
			if len(call.Args) < 1 {
				t.Fatalf("%s: router.%s without a pattern", fset.Position(call.Pos()), name)
			}
			routes.direct = append(routes.direct, routerMethods[name]+" "+stringLiteral(t, fset, call.Args[0]))
		default:
			t.Fatalf("%s: main.go calls router.%s, which routes_manifest_test.go does not understand; extend it so the manifest stays complete", fset.Position(call.Pos()), name)
		}
		return true
	})
	if mounts != 1 {
		t.Fatalf("main.go mounts RideHandler.Routes %d times; the manifest test expects exactly one mount", mounts)
	}
	return routes
}

// buildManifest walks the production route tree and renders the manifest.
func buildManifest(t *testing.T) string {
	t.Helper()
	fromMain := readMainGoRoutes(t)

	// Exactly the constructor main.go mounts. No handler runs during a walk,
	// so the nil services are never dereferenced; the location and
	// marketplace handlers are non-nil because main.go always builds the
	// location handler and builds the marketplace one whenever the engine is
	// configured — the surface the gateway must be able to reach.
	logger := zerolog.Nop()
	api := handler.NewRideHandler(nil, logger).Routes(
		handler.RequireIdentity(handler.NewInternalContextVerifier("", 0)),
		handler.NewLocationHandler(nil),
		handler.NewMarketplaceHandler(nil, logger),
	)
	root := chi.NewRouter()
	root.Mount(fromMain.apiPrefix, api)

	seen := map[string]bool{}
	for _, line := range fromMain.direct {
		seen[line] = true
	}
	err := chi.Walk(root, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		seen[method+" "+route] = true
		return nil
	})
	if err != nil {
		t.Fatalf("walk the router: %v", err)
	}

	lines := make([]string, 0, len(seen))
	for line := range seen {
		lines = append(lines, line)
	}
	sort.Strings(lines)
	return routeManifestHeader + strings.Join(lines, "\n") + "\n"
}

func manifestRoutes(manifest string) map[string]bool {
	routes := map[string]bool{}
	for _, line := range strings.Split(manifest, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		routes[line] = true
	}
	return routes
}

func TestRouteManifest(t *testing.T) {
	generated := buildManifest(t)

	if os.Getenv(updateManifestEnv) == "1" {
		if err := os.WriteFile(routeManifestFile, []byte(generated), 0o600); err != nil {
			t.Fatalf("write %s: %v", routeManifestFile, err)
		}
		t.Logf("wrote %s", routeManifestFile)
		return
	}

	committed, err := os.ReadFile(routeManifestFile)
	if err != nil {
		t.Fatalf("read %s: %v — regenerate with %s", routeManifestFile, err, regenerateCommand)
	}
	if string(committed) == generated {
		return
	}

	want, have := manifestRoutes(generated), manifestRoutes(string(committed))
	var added, removed []string
	for route := range want {
		if !have[route] {
			added = append(added, route)
		}
	}
	for route := range have {
		if !want[route] {
			removed = append(removed, route)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	t.Fatalf("internal/handler/%s is stale: the router serves routes it does not list, or lists routes the router no longer serves.\n"+
		"  served but not in the manifest: %v\n"+
		"  in the manifest but not served: %v\n"+
		"Regenerate with %s, then run the api-gateway route contract test (pnpm --filter @ubi/api-gateway test) — a gateway proxy rule that no longer reaches a route fails there.",
		routeManifestFile, added, removed, regenerateCommand)
}

// TestRouteManifestServesTheGatewayFamilies pins the families the gateway's
// ride-service proxy rules forward to, so an empty or truncated walk (a
// constructor that stops mounting the marketplace, say) cannot regenerate
// into a manifest that quietly drops them.
func TestRouteManifestServesTheGatewayFamilies(t *testing.T) {
	routes := manifestRoutes(buildManifest(t))
	for _, route := range []string{
		"GET /v1/rides/active",
		"POST /v1/rides/{rideId}/cancel",
		"GET /v1/drivers/me/status",
		"POST /v1/drivers/me/locations",
		"GET /v1/locations/autocomplete",
		"GET /v1/mp/quote",
		"POST /v1/mp/requests/{requestId}/select",
		"GET /v1/admin/mp/requests",
		"GET /health/ready",
	} {
		if !routes[route] {
			t.Errorf("the production router does not serve %q", route)
		}
	}
}
