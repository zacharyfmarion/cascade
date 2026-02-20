const REPLICATE_API = "https://api.replicate.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Prefer",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const targetUrl = REPLICATE_API + url.pathname;

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? request.body : undefined,
    });

    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      newResponse.headers.set(key, value);
    }

    return newResponse;
  },
};
