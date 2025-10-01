-- SIMPLE AUTH SCHEMA (single table, stores tokens directly)
-- Safe idempotent setup

CREATE DATABASE IF NOT EXISTS libdashboard;
USE libdashboard;

-- Drop only the users table (we only manage this one here)
-- We intentionally do NOT drop users table if it exists to preserve data.
-- To reset, manually run: DROP TABLE users; then re-run this script.

CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    access_token TEXT NULL,
    refresh_token TEXT NULL,
    token_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username)
);

-- Insert default admin (password: admin)
-- If you re-run schema, this will re-create admin fresh
INSERT INTO users (username, password_hash)
VALUES (
    'admin',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU8VnK8j8lkGmPq2'
)
ON DUPLICATE KEY UPDATE username = VALUES(username);

-- NOTE: To add another user manually later:
-- INSERT INTO users (username, password_hash) VALUES ('user2', '<bcrypt-hash>');