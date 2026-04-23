import http from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const WORLDSTATE_URL = process.env.WORLDSTATE_URL ?? "https://api.warframe.com/cdn/worldState.php";
const URL_TOKEN = process.env.URL_TOKEN?.trim() ?? "";

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

async function fetchWorldStateFromOrigin() {
  const response = await fetch(WORLDSTATE_URL, {
    method: "GET",
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-encoding": "identity",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      referer: "https://www.warframe.com/",
      origin: "https://www.warframe.com",
      "upgrade-insecure-requests": "1",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });

  const body = await response.text();
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}

function isAuthorized(url) {
  if (!URL_TOKEN) {
    return true;
  }

  const provided = url.searchParams.get("url") ?? "";
  return provided === URL_TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "warframe-worldstate-proxy", worldstateUrl: WORLDSTATE_URL });
  }

  if (req.method === "GET" && (url.pathname === "/worldstate" || url.pathname === "/")) {
    if (!isAuthorized(url)) {
      return json(res, 401, { ok: false, error: "unauthorized" });
    }

    try {
      const upstream = await fetchWorldStateFromOrigin();
      const passthroughHeaders = { ...upstream.headers };
      delete passthroughHeaders["content-encoding"];
      delete passthroughHeaders["content-length"];
      delete passthroughHeaders["transfer-encoding"];

      res.writeHead(upstream.status, passthroughHeaders);
      res.end(upstream.body);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return json(res, 502, { ok: false, error: message });
    }
  }

  return json(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, () => {
  console.log(`warframe-worldstate-proxy listening on :${PORT}`);
});
