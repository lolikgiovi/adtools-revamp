import { isTauri } from "../../core/Runtime.js";
import { OracleConnectionService } from "../../core/OracleConnectionService.js";
import { listBaseUrls } from "../../core/Environments.js";

export class BaseUrlService {
  /**
   * Return the CDN entry point for every configured environment.
   * Shape: [{ name, url, directUrl }]
   */
  getAllUrls() {
    return listBaseUrls();
  }
}

export class ImageCheckerService {
  constructor(baseUrlService) {
    this.baseUrlService = baseUrlService;
  }

  async getImageSize(url, timeoutMs = 5000) {
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke("measure_image_size", { url, timeoutMs });
      } catch {
        return null;
      }
    }
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          // The probe already downloaded this URL; the default cache mode lets the browser
          // reuse that response instead of transferring the image twice.
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return null;
          return (await response.blob()).size;
        })(),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ──────────────── path helpers ──────────────── */

  normalizeInput(input) {
    input = input.trim();

    // UUID regex pattern
    const uuidPattern = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i;

    // If input is just a UUID (with or without .png), normalize it
    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(\.png)?$/i.test(input)) {
      const uuid = input.replace(/\.png$/i, "");
      return `/content/v1/image/${uuid}.png`;
    }

    // Extract UUID from partial paths like:
    // /content/v1/image/uuid.png, content/v1/image/uuid.png, /v1/image/uuid.png, etc.
    const uuidMatch = input.match(uuidPattern);
    if (uuidMatch) {
      return `/content/v1/image/${uuidMatch[0]}.png`;
    }

    // If input starts with "/", use as-is
    if (input.startsWith("/")) return input;

    return input;
  }

  /**
   * Probe an image URL once and return width/height. No CORS, no extra fetch.
   * Uses img.decode() to ensure image is fully loaded and ready to render.
   * @param {string} url - Full URL to check
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  checkImageOnce(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      img.loading = "eager";
      img.decoding = "async";
      let settled = false;

      // Add cache-buster to ensure fresh load
      const loadUrl = url + (url.includes("?") ? "&" : "?") + `cb=${Date.now()}`;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          img.onload = null;
          img.onerror = null;
          img.src = ""; // Cancel the request
          resolve({ exists: false, url, timeout: true });
        }
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        img.onload = null;
        img.onerror = null;
      };

      const handleSuccess = async () => {
        if (settled) return;

        try {
          // Wait for image to be fully decoded and ready to render
          await img.decode();
        } catch (_) {
          // decode() might fail for some images, continue anyway
        }

        if (settled) return;
        settled = true;
        cleanup();

        const width = img.naturalWidth;
        const height = img.naturalHeight;

        // Check if dimensions are valid (image actually loaded)
        if (width === 0 || height === 0) {
          resolve({ exists: false, url });
          return;
        }

        resolve({
          exists: true,
          url: loadUrl, // Return the actual loaded URL for consistent display
          width,
          height,
          aspectRatio: (width / height).toFixed(2),
        });
      };

      img.onload = handleSuccess;

      img.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ exists: false, url });
      };

      img.src = loadUrl;
    });
  }

  /**
   * Probe an image URL and return width/height. Retries transient load failures and timeouts.
   * @param {string} baseUrl
   * @param {string} imagePath
   * @param {number} timeoutMs - Timeout in milliseconds per attempt (default: 5000)
   * @param {number} maxRetries - Maximum number of attempts (default: 3)
   */
  async checkImage(baseUrl, imagePath = "", timeoutMs = 5000, maxRetries = 3) {
    const url = baseUrl.replace(/\/$/, "") + "/" + imagePath.replace(/^\//, "");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.checkImageOnce(url, timeoutMs);

      // A failed image load can be transient too. Keep trying until the image
      // loads or all attempts have been used.
      if (result.exists || attempt === maxRetries) {
        if (result.exists) result.sizeBytes = await this.getImageSize(result.url);
        return result;
      }

      // Otherwise, retry after a short delay
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Fallback (should not reach here)
    return { exists: false, url, timeout: true };
  }

  async checkImageAgainstAllUrls(imagePath) {
    const normalized = this.normalizeInput(imagePath);
    const baseUrls = this.baseUrlService.getAllUrls();

    if (baseUrls.length === 0) {
      return [
        {
          exists: false,
          error: "No base URLs configured. Please add base URLs in the HTML Template tool.",
        },
      ];
    }

    return Promise.all(
      baseUrls.map(async (u) => ({
        ...(await this.checkImage(u.url, normalized)),
        name: u.name,
      })),
    );
  }

  async checkMultipleImagesAgainstAllUrls(imagePaths) {
    if (!imagePaths || imagePaths.length === 0) {
      return [];
    }

    const baseUrls = this.baseUrlService.getAllUrls();
    if (baseUrls.length === 0) {
      return [
        {
          path: "No URLs configured",
          results: [
            {
              exists: false,
              error: "No base URLs configured. Please add base URLs in the HTML Template tool.",
            },
          ],
        },
      ];
    }

    // Process each image path
    return Promise.all(
      imagePaths.map(async (path) => {
        const normalized = this.normalizeInput(path);
        const results = await Promise.all(
          baseUrls.map(async (u) => ({
            ...(await this.checkImage(u.url, normalized)),
            name: u.name,
          })),
        );

        return {
          path: path,
          normalized: normalized,
          results: results,
          existsCount: results.filter((r) => r.exists).length,
          totalCount: results.length,
        };
      }),
    );
  }
}

/**
 * UUIDs per CONTENT.IMAGE lookup. Every uuid costs an IN entry plus a LIKE predicate, so a
 * 1000-id statement would exceed Oracle's SQL text limit; 200 keeps each statement near 20 KB.
 */
const ORACLE_LOOKUP_CHUNK = 200;

export class ImageOracleService {
  static cleanImageId(input) {
    return (
      String(input || "")
        .match(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i)?.[0]
        .toLowerCase() || null
    );
  }

  static loadConnections() {
    try {
      const connections = JSON.parse(localStorage.getItem("config.oracle.connections") || "[]");
      return Array.isArray(connections) ? connections.filter((c) => c?.name && c.connect_string) : [];
    } catch {
      return [];
    }
  }

  /**
   * Look up CONTENT.IMAGE rows for a chunk of UUIDs. A row is matched either by IMAGE_ID
   * holding the uuid, or by the uuid appearing inside IMAGE_LINK ahead of its ".png" suffix.
   * The LIKE predicate cannot use an index, so keep the chunk small.
   */
  static buildLookupSql(ids) {
    const idList = ids.map((id) => `'${id}'`).join(",");
    const linkMatches = ids.map((id) => `LOWER(IMAGE_LINK) LIKE '%${id}%'`).join(" OR ");
    return (
      "SELECT IMAGE_ID, IMAGE_LINK, CONTEXT, SUB_CONTEXT, CONTENT FROM CONTENT.IMAGE " +
      `WHERE LOWER(IMAGE_ID) IN (${idList}) OR ${linkMatches}`
    );
  }

  static async fetch(connection, inputs, isCurrent = () => true) {
    const ids = [...new Set(inputs.map((input) => this.cleanImageId(input)).filter(Boolean))];
    const records = new Map();

    for (let offset = 0; offset < ids.length; offset += ORACLE_LOOKUP_CHUNK) {
      if (!isCurrent()) break;
      const chunk = ids.slice(offset, offset + ORACLE_LOOKUP_CHUNK);
      const requested = new Set(chunk);
      const result = await OracleConnectionService.queryViaSidecar(connection.name, connection, this.buildLookupSql(chunk), 1000);
      const columns = Array.isArray(result?.columns) ? result.columns.map((column) => column.toUpperCase()) : [];
      const rows = Array.isArray(result?.rows) ? result.rows : [];

      for (const row of rows) {
        const value = (name) => row[columns.indexOf(name)];
        // The uuid can arrive through either column; keep the one this chunk asked for.
        const id = [this.cleanImageId(value("IMAGE_ID")), this.cleanImageId(value("IMAGE_LINK"))].find(
          (candidate) => candidate && requested.has(candidate),
        );
        if (!id) continue;
        const content = value("CONTENT");
        records.set(id, {
          context: value("CONTEXT"),
          subContext: value("SUB_CONTEXT"),
          content,
          base64Bytes: typeof content === "string" ? new Blob([content]).size : null,
        });
      }
    }
    return records;
  }
}
