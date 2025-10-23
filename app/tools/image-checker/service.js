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

    if (input.startsWith("/")) return input;

    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.png$/i.test(input)) return `/content/v1/image/${input}`;

    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input)) return `/content/v1/image/${input}.png`;

    return input;
  }

  /**
   * Probe an image URL and return width/height. No CORS, no extra fetch.
   * @param {string} baseUrl
   * @param {string} imagePath
   */
  async checkImage(baseUrl, imagePath = "") {
    const url = baseUrl.replace(/\/$/, "") + "/" + imagePath.replace(/^\//, "");

    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        resolve({
          exists: true,
          url,
          width,
          height,
          aspectRatio: (width / height).toFixed(2),
        });
      };

      img.onerror = () => resolve({ exists: false, url });

      img.src = url + (url.includes("?") ? "&" : "?") + `cb=${Date.now()}`;
    });
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
