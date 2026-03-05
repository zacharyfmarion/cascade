/**
 * CORS Proxy for Replicate API
 *
 * WHY THIS EXISTS:
 * Browser fetch() cannot call api.replicate.com directly because Replicate's API
 * does not return Access-Control-Allow-Origin headers. This Cloudflare Worker acts
 * as a transparent CORS proxy — it forwards requests verbatim (including the user's
 * Authorization Bearer token) and adds CORS headers to the response.
 *
 * SECURITY:
 * - No API keys are stored on this worker — users provide their own (BYOK)
 * - The worker is stateless and stores no data
 * - All request headers (including auth) are forwarded as-is to Replicate
 *
 * ARCHITECTURE:
 * - In development: Vite's dev server proxy handles this (see vite.config.ts)
 * - In production: This Cloudflare Worker handles CORS for the deployed web app
 * - In Tauri desktop: Rust calls Replicate directly (no CORS restriction)
 *
 * REPLICATE BROWSER SUPPORT STATUS (confirmed March 2025):
 * Replicate's official SDK does NOT support browser environments.
 * GitHub issue #164 was closed with no plans to add CORS support.
 * This proxy is the recommended architecture per Replicate's own docs.
 */

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
