-- Store user-submitted improvement notes without requiring a formal support ticket.

CREATE TABLE IF NOT EXISTS improvement_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  tool_id TEXT,
  message TEXT NOT NULL,
  created_time TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_improvement_feedback_time ON improvement_feedback(created_time DESC);
CREATE INDEX IF NOT EXISTS idx_improvement_feedback_tool_time ON improvement_feedback(tool_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_improvement_feedback_user_time ON improvement_feedback(user_email, created_time DESC);
