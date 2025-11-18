import React, { useState, useEffect, useCallback } from "react";
import { useEventBus } from "../contexts/EventBusContext.jsx";
import { cn } from "@/lib/utils";

const NotificationItem = ({ message, type, duration, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation after mount
    setTimeout(() => setIsVisible(true), 10);

    // Auto-close after duration
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for fade-out animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        );
      case "error":
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case "info":
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        );
    }
  };

  return (
    <div
      className={cn(
        "notification",
        `notification-${type}`,
        isVisible && "show"
      )}
    >
      <div className="notification-content">
        <div className="notification-icon">{getIcon()}</div>
        <span className="notification-message">{message}</span>
        <button
          className="notification-close"
          onClick={() => {
            setIsVisible(false);
            setTimeout(onClose, 300);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default function NotificationContainer() {
  const eventBus = useEventBus();
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback((message, type, duration = 1000) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => {
      // Limit to 3 notifications
      const newNotifications = [...prev, { id, message, type, duration }];
      if (newNotifications.length > 3) {
        return newNotifications.slice(-3);
      }
      return newNotifications;
    });
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    if (!eventBus) return;

    const handleSuccess = (data) => {
      addNotification(data.message, "success", data.duration || 1000);
    };

    const handleError = (data) => {
      addNotification(data.message, "error", data.duration || 2000);
    };

    const handleInfo = (data) => {
      addNotification(data.message, "info", data.duration || 1500);
    };

    eventBus.on("notification:success", handleSuccess);
    eventBus.on("notification:error", handleError);
    eventBus.on("notification:info", handleInfo);

    return () => {
      eventBus.off("notification:success", handleSuccess);
      eventBus.off("notification:error", handleError);
      eventBus.off("notification:info", handleInfo);
    };
  }, [eventBus, addNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          message={notification.message}
          type={notification.type}
          duration={notification.duration}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
}
