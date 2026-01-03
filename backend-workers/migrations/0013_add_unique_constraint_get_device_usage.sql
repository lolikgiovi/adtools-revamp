-- Migration: Add UNIQUE constraint to get_device_usage table
-- SQLite doesn't support ADD CONSTRAINT, so we need to recreate the table

-- Step 1: Rename existing table
ALTER TABLE get_device_usage RENAME TO get_device_usage_old;

-- Step 2: Create new table with UNIQUE constraint
CREATE TABLE get_device_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  device_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT NOT NULL,
  UNIQUE(device_id, tool_id, action)
);

-- Step 3: Copy data from old table to new table
INSERT INTO get_device_usage (id, user_email, device_id, tool_id, action, count, updated_time)
SELECT id, user_email, device_id, tool_id, action, count, updated_time
FROM get_device_usage_old;

-- Step 4: Drop old table
DROP TABLE get_device_usage_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_get_device_usage_device ON get_device_usage(device_id);
CREATE INDEX IF NOT EXISTS idx_get_device_usage_email ON get_device_usage(user_email);
CREATE INDEX IF NOT EXISTS idx_get_device_usage_tool ON get_device_usage(tool_id);
CREATE INDEX IF NOT EXISTS idx_get_device_usage_device_tool_action ON get_device_usage(device_id, tool_id, action);
