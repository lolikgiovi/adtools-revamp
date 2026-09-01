ALTER TABLE manual_approval_requests ADD COLUMN claim_id TEXT;
ALTER TABLE manual_approval_requests ADD COLUMN claimed_at TEXT;
ALTER TABLE manual_approval_requests ADD COLUMN session_token TEXT;
