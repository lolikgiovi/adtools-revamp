import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTool } from "@/hooks/useTool.jsx";
import { BaseUrlService, ImageCheckerService } from "./service.js";
import { UsageTracker } from "../../core/UsageTracker.js";
import "./styles.css";

export default function ImageChecker() {
  const { showSuccess, showError } = useTool("check-image");
  const [batchInput, setBatchInput] = useState("");
  const [batchResults, setBatchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [environments, setEnvironments] = useState([]);

  const baseUrlService = new BaseUrlService();
  const imageCheckerService = new ImageCheckerService(baseUrlService);

  // Track mount
  useEffect(() => {
    try {
      UsageTracker.trackFeature("check-image", "mount", "", 5000);
    } catch (_) {}

    // Load saved values
    try {
      const saved = localStorage.getItem("tool:check-image:batchInput");
      if (saved) setBatchInput(saved);
    } catch (_) {}
  }, []);

  // Save values on change
  useEffect(() => {
    try {
      localStorage.setItem("tool:check-image:batchInput", batchInput);
    } catch (_) {}
  }, [batchInput]);

  const handleCheckImages = async () => {
    const input = batchInput.trim();
    if (!input) {
      showError("Please enter at least one image path or UUID");
      return;
    }

    const imagePaths = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (imagePaths.length === 0) {
      showError("Please enter at least one valid image path or UUID");
      return;
    }

    try {
      UsageTracker.trackEvent("check-image", "check_start", { images: imagePaths.length });
    } catch (_) {}

    setLoading(true);
    try {
      const results = await imageCheckerService.checkMultipleImagesAgainstAllUrls(imagePaths);
      setBatchResults(results);

      // Get environment names from first result
      if (results.length > 0) {
        const envs = results[0]?.results.map((r) => r.name) || [];
        setEnvironments(envs);
      }

      showSuccess(`Checked ${imagePaths.length} image(s) across environments`);
    } catch (error) {
      showError(`Error checking images: ${error.message}`);
      try {
        UsageTracker.trackEvent("check-image", "check_error", { message: error.message });
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setBatchInput("");
    setBatchResults([]);
    setEnvironments([]);
    try {
      localStorage.removeItem("tool:check-image:batchInput");
    } catch (_) {}
  };

  const extractUuid = (path) => {
    const uuidMatch = path.match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\.png)?$/i);
    return uuidMatch ? uuidMatch[1] : path;
  };

  return (
    <div className="tool-container image-checker p-6">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Batch Image Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="batchImagePathsInput">
              Image Paths or UUIDs (one per line)
            </Label>
            <Textarea
              id="batchImagePathsInput"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder="e.g., 12345678-1234-5678-1234-567812345678&#10;/content/v1/image/abcd-1234.png"
              rows={8}
              className="mt-1 font-mono"
              onKeyPress={(e) => {
                if (e.key === "Enter" && e.ctrlKey) {
                  handleCheckImages();
                }
              }}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Press Ctrl+Enter to check
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCheckImages} disabled={loading}>
              {loading ? "Checking..." : "Check Images"}
            </Button>
            <Button onClick={handleClear} variant="outline">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {batchResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="batch-results-table-container">
              <table className="batch-results-table">
                <thead>
                  <tr>
                    <th style={{ width: "300px" }}>Image ID</th>
                    {environments.map((env, idx) => (
                      <th key={idx} style={{ width: "200px" }}>
                        {env || "Unknown"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((imageResult, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="image-path-cell" title={imageResult.path}>
                        {extractUuid(imageResult.path)}
                      </td>
                      {imageResult.results.map((result, colIdx) => (
                        <td
                          key={colIdx}
                          className={`status-cell ${result.exists ? "success" : "error"}`}
                          title={
                            result.exists
                              ? `Dimensions: ${result.width}×${result.height}\nAspect Ratio: ${result.aspectRatio}:1\nURL: ${result.url}`
                              : result.error || "Image not found"
                          }
                          style={result.exists ? { cursor: "pointer" } : {}}
                          onClick={() => {
                            if (result.exists && result.url) {
                              window.open(result.url, "_blank");
                            }
                          }}
                        >
                          {result.exists ? (
                            <div
                              style={{
                                textAlign: "center",
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "center",
                              }}
                            >
                              <div className="mini-image-preview">
                                <img src={result.url} alt="Image Preview" />
                              </div>
                              <div className="image-size-info">
                                {result.width}×{result.height}
                              </div>
                            </div>
                          ) : (
                            <span className="status-icon">❌</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              <p>Click on a success cell to open the image in a new tab</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
