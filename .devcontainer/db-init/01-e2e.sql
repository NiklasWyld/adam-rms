-- A disposable database for Playwright, separate from normal development data.
CREATE DATABASE IF NOT EXISTS adamrms_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON adamrms_e2e.* TO 'user'@'%';
