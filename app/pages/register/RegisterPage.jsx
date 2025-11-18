import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventBusContext } from "@/contexts/EventBusContext.jsx";
import { UsageTracker } from "../../core/UsageTracker.js";
import { SessionTokenStore } from "../../core/SessionTokenStore.js";
import { isTauri } from "../../core/Runtime.js";
import "./styles.css";

export default function RegisterPage() {
  const navigate = useNavigate();
  const eventBus = useContext(EventBusContext);
  const [step, setStep] = useState("email"); // "email" or "otp"
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [buttonText, setButtonText] = useState("Continue");

  const fallbackInstallId = () => {
    let id = localStorage.getItem("usage.installId");
    if (!id) {
      id = "inst_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("usage.installId", id);
    }
    return id;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedUsername = (username || "").trim().slice(0, 15);
    const trimmedEmail = (email || "").trim();

    const emailOk = /.+@.+\..+/.test(trimmedEmail);
    if (trimmedUsername.length < 2) {
      setError("Please enter a valid Display Name.");
      return;
    }
    if (!emailOk) {
      setError("Please enter a valid company email.");
      return;
    }

    try {
      const baseEnv = (import.meta?.env?.VITE_WORKER_BASE || "").replace(/\/$/, "");

      // Step 1: Enforce whitelist and request OTP
      if (step === "email") {
        // Fetch whitelist
        const fallback = baseEnv ? `${baseEnv}/whitelist.json` : "https://adtools.lolik.workers.dev/whitelist.json";
        const WHITELIST_CANDIDATES = ["/whitelist.json", fallback];
        let whitelist = [];
        for (const url of WHITELIST_CANDIDATES) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data)) whitelist = data;
              else if (data && Array.isArray(data.whitelistEmails)) whitelist = data.whitelistEmails;
              else if (data && Array.isArray(data.allowedEmails)) whitelist = data.allowedEmails;
              else if (data && Array.isArray(data.emails)) whitelist = data.emails;
              if (whitelist && whitelist.length) break;
            }
          } catch (_) {}
        }

        // Normalize and cache whitelist
        try {
          const lower = (whitelist || [])
            .map((e) => String(e || "").trim().toLowerCase())
            .filter(Boolean);
          localStorage.setItem("config.whitelistEmails", JSON.stringify(lower));
          localStorage.setItem("config.whitelistFetchedAt", new Date().toISOString());
          whitelist = lower;
        } catch (_) {}

        // Fallback to cached whitelist
        if (!Array.isArray(whitelist) || !whitelist.length) {
          try {
            const cached = JSON.parse(localStorage.getItem("config.whitelistEmails") || "[]");
            if (Array.isArray(cached) && cached.length) whitelist = cached;
          } catch (_) {}
        }

        // Enforce whitelist
        const allowed = whitelist.length ? whitelist.includes(trimmedEmail.toLowerCase()) : true;
        if (!allowed) {
          setError("Email is not whitelisted. Please contact admin.");
          return;
        }

        // Request OTP
        setLoading(true);
        setButtonText("Sending code...");
        const endpointCandidates = ["/register/request-otp", baseEnv ? `${baseEnv}/register/request-otp` : ""];
        let devCode = null;
        let requested = false;
        let blocked = false;
        for (const endpoint of endpointCandidates.filter(Boolean)) {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: trimmedEmail }),
              credentials: "omit",
            });
            if (res.ok) {
              const resp = await res.json();
              devCode = resp?.devCode || null;
              requested = true;
              break;
            } else if (res.status === 403) {
              blocked = true;
              let msg = "Email domain not allowed";
              try {
                const resp = await res.json();
                if (resp && typeof resp.error === "string" && resp.error) msg = resp.error;
              } catch (_) {}
              setError(msg || "Email domain not allowed. Use your @bankmandiri.co.id email.");
              break;
            }
          } catch (_) {}
        }
        setLoading(false);
        setButtonText("Continue");
        if (blocked) return;
        if (!requested) {
          setError("Failed to send code. Please try again.");
          return;
        }

        // Progress to OTP step
        setStep("otp");
        setButtonText("Verify & Continue");
        if (devCode) setOtp(devCode);
        setError("We sent a verification code to your email.");
        return;
      }

      // Step 2: Verify OTP and finalize registration
      if (step === "otp") {
        const code = (otp || "").trim();
        if (!/^[0-9]{6}$/.test(code)) {
          setError("Enter the 6-digit verification code.");
          return;
        }

        const endpointCandidates = ["/register/verify", baseEnv ? `${baseEnv}/register/verify` : ""];
        const deviceId =
          typeof UsageTracker?.getDeviceId === "function"
            ? UsageTracker.getDeviceId()
            : localStorage.getItem("adtools.deviceId") || localStorage.getItem("usage.installId") || fallbackInstallId();

        const platform = isTauri() ? "Desktop (Tauri)" : "Browser";
        const payload = {
          deviceId,
          displayName: trimmedUsername,
          email: trimmedEmail,
          code,
          platform,
        };

        setLoading(true);
        setButtonText("Verifying...");
        let verified = false;
        let userId = null;
        let blockedVerify = false;
        let sessionToken = null;
        for (const endpoint of endpointCandidates.filter(Boolean)) {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              credentials: "omit",
            });
            if (res.ok) {
              const resp = await res.json();
              if (resp?.ok) {
                verified = true;
                userId = resp?.userId || null;
                sessionToken = resp?.token || null;
                break;
              }
            } else if (res.status === 403) {
              blockedVerify = true;
              let msg = "Email domain not allowed";
              try {
                const resp = await res.json();
                if (resp && typeof resp.error === "string" && resp.error) msg = resp.error;
              } catch (_) {}
              setError(msg || "Email domain not allowed. Use your @bankmandiri.co.id email.");
              break;
            }
          } catch (_) {}
        }
        setLoading(false);
        setButtonText("Verify & Continue");

        if (blockedVerify) return;
        if (!verified) {
          setError("Verification failed. Check the code and try again.");
          return;
        }

        // Persist session token
        try {
          if (sessionToken) SessionTokenStore.saveToken(sessionToken);
        } catch (_) {}

        // Persist locally
        try {
          localStorage.setItem("user.username", trimmedUsername);
          localStorage.setItem("user.email", trimmedEmail);
          if (userId) localStorage.setItem("user.id", userId);
          localStorage.setItem("user.registered", "true");
        } catch (_) {}

        // Notify and redirect
        eventBus?.emit?.("user:registered", { username: trimmedUsername, email: trimmedEmail, userId });
        navigate("/home");
        return;
      }
    } catch (err) {
      console.error(err);
      setError("Unexpected error. Please try again.");
      setLoading(false);
      setButtonText(step === "email" ? "Continue" : "Verify & Continue");
    }
  };

  return (
    <div className="register-page">
      <Card className="register-card">
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <p className="register-desc">Enter your details, then verify via email OTP.</p>
        </CardHeader>
        <CardContent>
          <form className="register-form" onSubmit={handleSubmit} noValidate>
            <div className="register-field">
              <Label htmlFor="reg-username">Display Name</Label>
              <Input
                type="text"
                id="reg-username"
                placeholder="Input Username"
                maxLength={15}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="register-field">
              <Label htmlFor="reg-email">Office Email</Label>
              <Input
                type="email"
                id="reg-email"
                placeholder="name@bankmandiri.co.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {step === "otp" && (
              <div className="register-field otp-field">
                <Label htmlFor="reg-otp">Verification Code</Label>
                <Input
                  type="text"
                  id="reg-otp"
                  placeholder="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
                <div className="register-hint">We sent a code to your email. Enter it to continue.</div>
              </div>
            )}
            <div className="register-actions">
              <Button type="submit" disabled={loading}>
                {buttonText}
              </Button>
            </div>
            {error && <div className="register-error" role="alert">{error}</div>}
          </form>
          <p className="register-note">We verify your office email via OTP. Whitelist applies.</p>
        </CardContent>
      </Card>
    </div>
  );
}
