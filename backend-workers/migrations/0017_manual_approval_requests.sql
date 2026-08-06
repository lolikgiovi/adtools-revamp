CREATE TABLE IF NOT EXISTS manual_approval_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT,
  user_agent TEXT,
  ip_address TEXT,
  country TEXT,
  locale TEXT,
  timezone TEXT,
  screen_size TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  requested_at TEXT NOT NULL,
  approved_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_manual_approval_status_time ON manual_approval_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_approval_email_device ON manual_approval_requests(email, device_id, requested_at DESC);
