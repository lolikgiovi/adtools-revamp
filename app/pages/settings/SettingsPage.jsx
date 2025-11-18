import React, { useState, useEffect, useContext } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EventBusContext } from "@/contexts/EventBusContext.jsx";
import { getRuntime } from "../../core/Runtime.js";
import "./styles.css";

export default function SettingsPage() {
  const eventBus = useContext(EventBusContext);
  const [runtime, setRuntime] = useState("web");
  const [runtimeBadge, setRuntimeBadge] = useState("Web App");

  useEffect(() => {
    const initRuntime = async () => {
      const rt = getRuntime();
      setRuntime(rt);

      let badge = rt === "tauri" ? "Desktop" : "Web App";

      // For desktop, try to get architecture and version info
      if (rt === "tauri") {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { getVersion } = await import("@tauri-apps/api/app");

          const [arch, version] = await Promise.all([
            invoke("get_arch").catch(() => undefined),
            getVersion().catch(() => undefined)
          ]);

          if (arch) {
            const a = arch.toLowerCase();
            if (a.includes("aarch64") || a.includes("arm64")) {
              badge = "Desktop - Apple Silicon";
            } else if (a.includes("x86_64") || a.includes("amd64") || a.includes("x64")) {
              badge = "Desktop - Intel";
            }
          }

          if (version) {
            badge = `v.${version} - ${badge}`;
          }
        } catch (_) {}
      }

      setRuntimeBadge(badge);
    };

    initRuntime();
  }, []);

  const handleLoadDefaults = () => {
    eventBus?.emit?.("notification:info", {
      message: "Settings page migration in progress. Full functionality coming soon."
    });
  };

  const handleCheckUpdate = () => {
    if (runtime !== "tauri") {
      eventBus?.emit?.("notification:info", {
        message: "Updates are available on Desktop only."
      });
      return;
    }
    eventBus?.emit?.("notification:info", {
      message: "Update check functionality coming soon."
    });
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <div className="settings-toolbar">
          <span
            id="runtime-status"
            className="runtime-badge"
            data-state={runtime}
            title={runtime === "tauri" ? `Running in Tauri (${runtimeBadge})` : "Running in Browser"}
          >
            {runtimeBadge}
          </span>
          <Button size="sm" variant="outline" onClick={handleLoadDefaults}>
            Load Defaults
          </Button>
          <Button size="sm" variant="outline" onClick={handleCheckUpdate}>
            Check for Update
          </Button>
        </div>
      </div>

      <div className="settings-content">
        <Card>
          <CardHeader>
            <CardTitle>Settings Migration in Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              The Settings page is being migrated to React. The full configuration management system with
              nested categories, inline editing, validation, OTP-based defaults loading, and update checking
              will be available soon.
            </p>
            <br />
            <p>
              <strong>Current Runtime:</strong> {runtimeBadge}
            </p>
            <br />
            <p className="text-sm text-muted-foreground">
              Note: You can still access configuration via localStorage for now. The settings UI will be
              fully functional in the next update.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
