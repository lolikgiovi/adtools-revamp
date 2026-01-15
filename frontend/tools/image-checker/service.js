export class BaseUrlService {
  static STORAGE_KEY = "config.baseUrls";

  /**
   * Return all configured base URLs from localStorage kvlist
   * Shape: [{ key: <env>, value: <baseUrl> }, ...]
   * Maps to: [{ name, url }]
   */
  getAllUrls() {
    let pairs = [];
    try {
      const raw = localStorage.getItem(BaseUrlService.STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      pairs = Array.isArray(parsed) ? parsed.filter((p) => p && p.key && p.value) : [];
    } catch (_) {
      pairs = [];
    }

    return pairs.map((p) => ({ name: p.key, url: p.value }));
  }
}

export class ImageCheckerService {
  constructor(baseUrlService) {
    this.baseUrlService = baseUrlService;
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
      let settled = false;

      // Add cache-buster to ensure fresh load
      const loadUrl = url + (url.includes("?") ? "&" : "?") + `cb=${Date.now()}`;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          img.src = ""; // Cancel the request
          resolve({ exists: false, url, timeout: true });
        }
      }, timeoutMs);

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
        clearTimeout(timeoutId);

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
        clearTimeout(timeoutId);
        resolve({ exists: false, url });
      };

      img.src = loadUrl;
    });
  }

  /**
   * Probe an image URL and return width/height. Retries up to maxRetries times on timeout.
   * @param {string} baseUrl
   * @param {string} imagePath
   * @param {number} timeoutMs - Timeout in milliseconds per attempt (default: 15000)
   * @param {number} maxRetries - Maximum number of retry attempts on timeout (default: 5)
   */
  async checkImage(baseUrl, imagePath = "", timeoutMs = 5000, maxRetries = 3) {
    const url = baseUrl.replace(/\/$/, "") + "/" + imagePath.replace(/^\//, "");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.checkImageOnce(url, timeoutMs);

      // If not a timeout, return immediately (success or error)
      if (!result.timeout) {
        return result;
      }

      // If this was the last attempt, return the timeout result
      if (attempt === maxRetries) {
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
      }))
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
          }))
        );

        return {
          path: path,
          normalized: normalized,
          results: results,
          existsCount: results.filter((r) => r.exists).length,
          totalCount: results.length,
        };
      })
    );
  }
}
