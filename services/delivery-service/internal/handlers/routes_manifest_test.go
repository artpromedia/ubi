package handlers_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/config"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/handlers"
)

// The route manifest is the durable record of every METHOD + chi pattern this
// service serves. The API gateway's contract test
// (services/api-gateway/tests/route-contract.test.ts) reads it to prove that
// every gateway proxy rule for delivery-service lands on a route that exists
// here — this service mounts its API under /api/v1, and a gateway that
// forwarded /v1/delivery/... as /delivery/... reached nothing (P17's custody
// routes were unreachable through the gateway for exactly that reason).
//
// The manifest is walked from the REAL router, handlers.NewRouter, the
// constructor cmd/server/main.go serves as its http.Server handler; that
// wiring is itself checked against main.go's syntax tree below, so the walk
// cannot silently drift from what production serves.
const (
	routeManifestFile   = "routes.manifest"
	mainGoFile          = "../../cmd/server/main.go"
	updateManifestEnv   = "UPDATE_ROUTE_MANIFEST"
	regenerateCommand   = "UPDATE_ROUTE_MANIFEST=1 go test ./internal/handlers/ -run TestRouteManifest"
	routeManifestHeader = `# delivery-service route manifest: every METHOD + chi pattern the production
# router serves (handlers.NewRouter, which cmd/server/main.go serves as its
# http.Server handler). GENERATED — do not edit by hand.
# Regenerate: (cd services/delivery-service && ` + regenerateCommand + `)
# Read by services/api-gateway/tests/route-contract.test.ts.
`
)

// assertMainServesNewRouter proves cmd/server/main.go serves exactly the
// router this test walks: one handlers.NewRouter call, whose router result is
// the http.Server's Handler.
func assertMainServesNewRouter(t *testing.T) {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, mainGoFile, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", mainGoFile, err)
	}

	routerVar := ""
	calls := 0
	served := []string{}
	ast.Inspect(file, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			if len(n.Rhs) != 1 || len(n.Lhs) == 0 {
				return true
			}
			call, ok := n.Rhs[0].(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || selector.Sel.Name != "NewRouter" {
				return true
			}
			if pkg, ok := selector.X.(*ast.Ident); !ok || pkg.Name != "handlers" {
				return true
			}
			calls++
			if ident, ok := n.Lhs[0].(*ast.Ident); ok {
				routerVar = ident.Name
			}
		case *ast.KeyValueExpr:
			key, ok := n.Key.(*ast.Ident)
			if !ok || key.Name != "Handler" {
				return true
			}
			if value, ok := n.Value.(*ast.Ident); ok {
				served = append(served, value.Name)
			} else {
				served = append(served, "<expression>")
			}
		}
		return true
	})
	if calls != 1 || routerVar == "" {
		t.Fatalf("%s must build its router with exactly one `r, _ := handlers.NewRouter(h)`; found %d call(s). Extend routes_manifest_test.go if the wiring changed.", mainGoFile, calls)
	}
	if len(served) != 1 || served[0] != routerVar {
		t.Fatalf("%s must serve the handlers.NewRouter result (%q) as its http.Server Handler; found Handler values %v. Extend routes_manifest_test.go if the wiring changed.", mainGoFile, routerVar, served)
	}
}

// buildManifest walks the production router and renders the manifest.
func buildManifest(t *testing.T) string {
	t.Helper()
	assertMainServesNewRouter(t)

	// No handler runs during a walk, so the nil database and Redis clients are
	// never touched; a zero Config is the development posture, which mounts
	// exactly the routes production mounts.
	router, _ := handlers.NewRouter(handlers.New(nil, nil, &config.Config{}))
	routes, ok := router.(chi.Routes)
	if !ok {
		t.Fatalf("handlers.NewRouter returned %T, which chi.Walk cannot walk", router)
	}

	seen := map[string]bool{}
	err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
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
	t.Fatalf("internal/handlers/%s is stale: the router serves routes it does not list, or lists routes the router no longer serves.\n"+
		"  served but not in the manifest: %v\n"+
		"  in the manifest but not served: %v\n"+
		"Regenerate with %s, then run the api-gateway route contract test (pnpm --filter @ubi/api-gateway test) — a gateway proxy rule that no longer reaches a route fails there.",
		routeManifestFile, added, removed, regenerateCommand)
}

// TestRouteManifestServesTheGatewayFamilies pins the routes the gateway's
// /v1/delivery proxy rule forwards to (the rider app's custody timeline and
// return consent among them), so a truncated walk cannot regenerate into a
// manifest that quietly drops them.
func TestRouteManifestServesTheGatewayFamilies(t *testing.T) {
	routes := manifestRoutes(buildManifest(t))
	for _, route := range []string{
		"GET /api/v1/deliveries/{id}/custody/",
		"POST /api/v1/deliveries/{id}/custody/return/consent",
		"POST /api/v1/deliveries/{id}/custody/pickup-proof",
		"GET /api/v1/deliveries/{id}/track",
		"POST /api/v1/quotes/",
		"GET /health/ready",
	} {
		if !routes[route] {
			t.Errorf("the production router does not serve %q", route)
		}
	}
}
