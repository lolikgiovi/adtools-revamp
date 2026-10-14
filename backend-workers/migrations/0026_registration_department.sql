-- Optional department keeps existing registrations and older clients compatible.
ALTER TABLE users ADD COLUMN department TEXT CHECK (department IS NULL OR department = 'RETAIL');
ALTER TABLE manual_approval_requests ADD COLUMN department TEXT CHECK (department IS NULL OR department = 'RETAIL');
