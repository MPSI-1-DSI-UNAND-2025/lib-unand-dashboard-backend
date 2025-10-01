-- Auth Schema untuk Database MYSQL2 (libdashboard)
-- Gunakan database libdashboard yang sudah dikonfigurasi di MYSQL2_*

USE libdashboard;

-- Tabel users untuk authentication
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role ENUM('admin', 'librarian', 'viewer') DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- Tabel refresh_tokens untuk JWT refresh token management
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_revoked BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_token_hash (token_hash),
    INDEX idx_expires_at (expires_at)
);

-- Tabel user_sessions untuk tracking login sessions (optional)
CREATE TABLE IF NOT EXISTS user_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_session_token (session_token),
    INDEX idx_expires_at (expires_at)
);

-- Insert default admin user (password: admin123)
-- Password hash untuk 'admin123' menggunakan bcrypt
INSERT INTO users (username, email, password_hash, full_name, role, is_active) 
VALUES (
    'admin', 
    'admin@library.com', 
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU/yVK8h.8IkGmTK', 
    'System Administrator', 
    'admin', 
    TRUE
) ON DUPLICATE KEY UPDATE username = username;

-- Insert default librarian user (password: librarian123)
INSERT INTO users (username, email, password_hash, full_name, role, is_active) 
VALUES (
    'librarian', 
    'librarian@library.com', 
    '$2a$12$XG4XMBzK8Q8K.t1qNxZgLO9i5D1bH.gHYhEy/8JAKs2L.nKJm8V5m', 
    'Librarian User', 
    'librarian', 
    TRUE
) ON DUPLICATE KEY UPDATE username = username;