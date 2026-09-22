-- Developer is the only protected, private platform role.
-- Other roles are business data that a developer may manage or delete.
UPDATE roles
SET system = (code = 'developer')
WHERE code IN ('developer', 'admin', 'operator', 'viewer');

