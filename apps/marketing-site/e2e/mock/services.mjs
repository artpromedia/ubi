/**
 * Mocked config-service (port 3111) and user-service (port 3112) for the
 * Playwright suite. State is switched by POST /__scenario on the config mock:
 * `{ preset, overrides }`. Every response shape mirrors the real services.
 */
import { createServer } from "node:http";

import { preset, requirements } from "./fixtures.mjs";

const CONFIG_PORT = Number(process.env.MOCK_CONFIG_PORT ?? 3111);
const USER_PORT = Number(process.env.MOCK_USER_PORT ?? 3112);

let state = preset("launch_day");
const log = [];

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const config = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${CONFIG_PORT}`);
  log.push({ method: req.method, path: url.pathname + url.search });

  if (req.method === "POST" && url.pathname === "/__scenario") {
    const body = JSON.parse((await readBody(req)) || "{}");
    state = {
      ...preset(body.preset ?? "launch_day"),
      ...(body.overrides ?? {}),
    };
    return json(res, 200, { ok: true, preset: body.preset });
  }
  if (req.method === "GET" && url.pathname === "/__log") {
    return json(res, 200, log);
  }
  if (req.method === "DELETE" && url.pathname === "/__log") {
    log.length = 0;
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });

  if (url.pathname === "/v1/config/cities") {
    if (state.citiesMode !== "ok") {
      return json(res, 503, {
        code: "service_unavailable",
        message: "mock outage",
      });
    }
    return json(res, 200, state.cities);
  }

  const cityMatch = /^\/v1\/config\/cities\/([A-Za-z0-9]+)$/.exec(url.pathname);
  if (cityMatch) {
    if (state.configMode !== "ok") {
      return json(res, 503, {
        code: "service_unavailable",
        message: "mock outage",
      });
    }
    const cfg = state.configs[cityMatch[1].toUpperCase()];
    if (!cfg) {
      return json(res, 404, {
        code: "city_unsupported",
        message: "city is not configured",
      });
    }
    return json(res, 200, cfg, {
      etag: '"mock"',
      "cache-control": "private, max-age=60",
    });
  }

  if (url.pathname === "/v1/flags") {
    if (state.flagsMode === "error") {
      return json(res, 500, { code: "internal_error", message: "mock outage" });
    }
    if (state.flagsMode === "unreachable") {
      req.socket.destroy();
      return undefined;
    }
    if (state.flagsDelayMs > 0) await sleep(state.flagsDelayMs);
    const cityId = (url.searchParams.get("cityId") ?? "").toUpperCase();
    const map = state.flags[cityId] ?? {};
    return json(res, 200, map, { "cache-control": "private, no-store" });
  }

  return json(res, 404, { code: "not_found", message: "no such endpoint" });
});

const user = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${USER_PORT}`);
  log.push({
    method: req.method,
    path: url.pathname + url.search,
    service: "user",
  });
  if (url.pathname === "/health") return json(res, 200, { status: "ok" });
  if (
    url.pathname === "/v1/kyc/requirements" ||
    url.pathname === "/kyc/requirements"
  ) {
    if (state.requirementsMode === "error") {
      return json(res, 500, {
        success: false,
        error: { code: "internal_error", message: "mock outage" },
      });
    }
    const cityId = (url.searchParams.get("cityId") ?? "").toUpperCase();
    const set = requirements[cityId];
    if (!set) {
      return json(res, 404, {
        success: false,
        error: { code: "city_unsupported", message: "no set" },
      });
    }
    return json(
      res,
      200,
      { success: true, data: set },
      { "cache-control": "public, max-age=3600" },
    );
  }
  return json(res, 404, {
    success: false,
    error: { code: "NOT_FOUND", message: "no" },
  });
});

config.listen(CONFIG_PORT, "127.0.0.1", () => {
  console.log(`mock config-service on http://127.0.0.1:${CONFIG_PORT}`);
});
user.listen(USER_PORT, "127.0.0.1", () => {
  console.log(`mock user-service on http://127.0.0.1:${USER_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    config.close();
    user.close();
    process.exit(0);
  });
}
