-- Widen the existing optional RETAIL-only department while preserving stored data.
ALTER TABLE users RENAME COLUMN department TO registration_department_legacy;
ALTER TABLE users ADD COLUMN department TEXT
  CHECK (department IS NULL OR department IN ('RETAIL', 'SME', 'NBDS', 'ENTERPRISE', 'PARTNERSHIP', 'WHOLESALE'));
UPDATE users SET department = registration_department_legacy;
ALTER TABLE users DROP COLUMN registration_department_legacy;
ALTER TABLE users ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('ANALYST', 'ENGINEER'));

ALTER TABLE manual_approval_requests RENAME COLUMN department TO registration_department_legacy;
ALTER TABLE manual_approval_requests ADD COLUMN department TEXT
  CHECK (department IS NULL OR department IN ('RETAIL', 'SME', 'NBDS', 'ENTERPRISE', 'PARTNERSHIP', 'WHOLESALE'));
UPDATE manual_approval_requests SET department = registration_department_legacy;
ALTER TABLE manual_approval_requests DROP COLUMN registration_department_legacy;
ALTER TABLE manual_approval_requests ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('ANALYST', 'ENGINEER'));
