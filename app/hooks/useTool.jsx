import { useCallback, useEffect } from "react";
import { useEventBus } from "../contexts/EventBusContext.jsx";

/**
 * Custom hook for common tool functionality
 * Provides utilities like copy to clipboard, notifications, etc.
 */
export function useTool(toolId) {
  const eventBus = useEventBus();

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @param {string} successMessage - Optional success message
   */
  const copyToClipboard = useCallback(
    async (text, successMessage = "Copied to clipboard!") => {
      try {
        await navigator.clipboard.writeText(text);
        if (eventBus) {
          eventBus.emit("notification:success", {
            message: successMessage,
            duration: 1000,
          });
        }
        return true;
      } catch (err) {
        console.error("Failed to copy:", err);
        if (eventBus) {
          eventBus.emit("notification:error", {
            message: "Failed to copy to clipboard",
            duration: 2000,
          });
        }
        return false;
      }
    },
    [eventBus]
  );

  /**
   * Show success notification
   * @param {string} message - Success message
   * @param {number} duration - Duration in milliseconds
   */
  const showSuccess = useCallback(
    (message, duration = 1000) => {
      if (eventBus) {
        eventBus.emit("notification:success", { message, duration });
      }
    },
    [eventBus]
  );

  /**
   * Show error notification
   * @param {string} message - Error message
   * @param {number} duration - Duration in milliseconds
   */
  const showError = useCallback(
    (message, duration = 2000) => {
      if (eventBus) {
        eventBus.emit("notification:error", { message, duration });
      }
    },
    [eventBus]
  );

  /**
   * Show info notification
   * @param {string} message - Info message
   * @param {number} duration - Duration in milliseconds
   */
  const showInfo = useCallback(
    (message, duration = 1500) => {
      if (eventBus) {
        eventBus.emit("notification:info", { message, duration });
      }
    },
    [eventBus]
  );

  /**
   * Emit tool activation event
   */
  useEffect(() => {
    if (eventBus && toolId) {
      eventBus.emit("tool:activated", { toolId });
    }

    return () => {
      if (eventBus && toolId) {
        eventBus.emit("tool:deactivated", { toolId });
      }
    };
  }, [eventBus, toolId]);

  return {
    copyToClipboard,
    showSuccess,
    showError,
    showInfo,
  };
}
