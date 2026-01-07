-- Migration: Add idempotency index to events table
-- This prevents duplicate event inserts on retry

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempotency 
ON events(device_id, feature_id, action, created_time);
