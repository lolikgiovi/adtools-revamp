import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/Runtime.js";

export function readVelocityValidatorSettings() {
  return {
    url: (localStorage.getItem("config.velocityValidator.url") || "").trim(),
  };
}

export async function requestVelocityValidation({ url, template, context, signal }) {
  if (!url?.trim()) throw new Error("Set the endpoint in Settings → Velocity API Validator first.");
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Velocity API Validator URL is invalid.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("Velocity API Validator URL must use HTTP or HTTPS without embedded credentials.");
  }
  const contentType = "application/json";
  const body = JSON.stringify({ context, template });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30000);
  try {
    if (isTauri()) {
      return await invoke("validate_velocity_template", { url: endpoint.href, body, contentType });
    }
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    if (timedOut) throw new Error("Velocity API validation timed out after 30 seconds.");
    if (signal?.aborted) throw error;
    throw new Error(
      "Velocity API validator unavailable. Check the endpoint and your connection. " +
        "In a browser, the endpoint must also allow CORS and the page's HTTP/HTTPS policy.",
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
