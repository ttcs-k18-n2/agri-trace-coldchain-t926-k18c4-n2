-- Down migration 008: Remove seeded demo accounts and organizations
DELETE FROM users WHERE email IN (
    'admin@example.com',
    'orgadmin@example.com',
    'transporter@example.com',
    'distributor@example.com'
);

DELETE FROM organizations WHERE id IN (
    'org-system',
    'org-trans',
    'org-dist'
);
