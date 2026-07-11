/**
 * OpenCode API client.
 * Sends messages to OpenCode's REST API and returns responses.
 */

const DEFAULT_OPENCODE_URL = "http://localhost:4097";
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Send a message to OpenCode's query endpoint.
 *
 * @param {string} message - The message text to send
 * @param {object} [opts]
 * @param {string} [opts.opencodeUrl] - OpenCode server URL (default: http://localhost:4097)
 * @param {string} [opts.channel] - Optional channel identifier for logging
 * @returns {Promise<{response: string}>}
 */
export async function queryOpenCode(message, opts = {}) {
  const opencodeUrl = opts.opencodeUrl || DEFAULT_OPENCODE_URL;
  const channel = opts.channel || "unknown";

  const url = `${opencodeUrl}/opencode/run`;

  console.error(`[webhook-adapter] channel=${channel} -> ${url} message="${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenCode API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`OpenCode request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
