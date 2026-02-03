-- Migration: Add performance index to events table
-- This helps with querying events by device, feature, action, and time

CREATE INDEX IF NOT EXISTS idx_events_lookup 
ON events(device_id, feature_id, action, created_time);
