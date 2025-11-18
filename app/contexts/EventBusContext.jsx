import React, { createContext, useContext, useEffect, useRef } from "react";
import { EventBus } from "../core/EventBus.js";

export const EventBusContext = createContext(null);

export const EventBusProvider = ({ children }) => {
  const eventBusRef = useRef(new EventBus());

  useEffect(() => {
    return () => {
      eventBusRef.current.clear();
    };
  }, []);

  return (
    <EventBusContext.Provider value={eventBusRef.current}>
      {children}
    </EventBusContext.Provider>
  );
};

export const useEventBus = () => {
  const context = useContext(EventBusContext);
  if (!context) {
    throw new Error("useEventBus must be used within an EventBusProvider");
  }
  return context;
};
