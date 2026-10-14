import { OracleConnectionService } from "../../core/OracleConnectionService.js";
export class MonitoringService {
  connections() {
    try {
      return JSON.parse(localStorage.getItem("config.oracle.connections") || "[]").filter((item) => item.name && item.connect_string);
    } catch {
      return [];
    }
  }
  async request(connection, request) {
    const result = await OracleConnectionService.monitoring(connection, request);
    if (request.action !== "apply" && result.ok === false && !["Verification Mismatch", "Reconciliation Required"].includes(result.state)) {
      throw new Error(result.message || result.error?.message || "Oracle operation failed. Your draft was retained.");
    }
    return result;
  }
  load(connection) {
    return this.request(connection, { action: "load" });
  }
  apply(connection, request) {
    return this.request(connection, { ...request, action: "apply" });
  }
  verify(connection, request) {
    return this.request(connection, { ...request, action: "verify" });
  }
  history(connection, request) {
    return this.request(connection, { ...request, action: "history" });
  }
}
