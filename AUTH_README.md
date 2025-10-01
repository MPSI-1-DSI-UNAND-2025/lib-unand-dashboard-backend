# Authentication System Documentation

Sistem authentication untuk Library Dashboard Backend menggunakan JWT (JSON Web Token) dan bcrypt untuk hashing password.

## Fitur

- ✅ User Registration & Login
- ✅ JWT Access Token & Refresh Token
- ✅ Role-based Access Control (Admin, Librarian, Viewer)
- ✅ Password Hashing dengan bcrypt
- ✅ Token Refresh mechanism
- ✅ Logout dan Logout All Devices
- ✅ Middleware authentication
- ✅ Automatic cleanup expired tokens (cron job)

## Database Schema

### Database Configuration
- **Database**: `libdashboard` (MYSQL2_DATABASE)
- **Host**: 127.0.0.1 (MYSQL2_HOST)
- **Port**: 3306 (MYSQL2_PORT)
- **User**: admin (MYSQL2_USER)
- **Password**: admin (MYSQL2_PASSWORD)

### Tables

#### 1. users
```sql
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role ENUM('admin', 'librarian', 'viewer') DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### 2. refresh_tokens
```sql
CREATE TABLE refresh_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_revoked BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 3. user_sessions (optional)
```sql
CREATE TABLE user_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## Setup

### 1. Install Dependencies
```bash
npm install jsonwebtoken bcryptjs @types/jsonwebtoken @types/bcryptjs
```

### 2. Environment Variables
Tambahkan konfigurasi berikut ke file `.env`:

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-jwt-key-change-this-in-production
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12

# MySQL2 Database (Auth Database)
MYSQL2_HOST=127.0.0.1
MYSQL2_PORT=3306
MYSQL2_USER=admin
MYSQL2_PASSWORD=admin
MYSQL2_DATABASE=libdashboard
MYSQL2_POOL_LIMIT=10
```

### 3. Setup Database
```bash
npm run setup-auth-db
```

### 4. Default Users
Setelah setup database, terdapat 2 user default:

**Admin User:**
- Username: `admin`
- Email: `admin@library.com`
- Password: `admin123`
- Role: `admin`

**Librarian User:**
- Username: `librarian`
- Email: `librarian@library.com`
- Password: `librarian123`
- Role: `librarian`

## API Endpoints

### Base URL: `/api/auth`

#### 1. Register User
- **POST** `/api/auth/register`
- **Body:**
```json
{
  "username": "string",
  "email": "string",
  "password": "string",
  "full_name": "string (optional)",
  "role": "admin|librarian|viewer (optional, default: viewer)"
}
```

#### 2. Login
- **POST** `/api/auth/login`
- **Body:**
```json
{
  "username": "string", // username or email
  "password": "string"
}
```
- **Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@library.com",
      "role": "admin"
    },
    "tokens": {
      "accessToken": "jwt_access_token",
      "refreshToken": "jwt_refresh_token",
      "expiresIn": "15m"
    }
  }
}
```

#### 3. Refresh Token
- **POST** `/api/auth/refresh-token`
- **Body:**
```json
{
  "refreshToken": "string"
}
```

#### 4. Get Profile
- **GET** `/api/auth/me`
- **Headers:** `Authorization: Bearer <access_token>`

#### 5. Verify Token
- **GET** `/api/auth/verify`
- **Headers:** `Authorization: Bearer <access_token>`

#### 6. Logout
- **POST** `/api/auth/logout`
- **Body:**
```json
{
  "refreshToken": "string"
}
```

#### 7. Logout All Devices
- **POST** `/api/auth/logout-all`
- **Headers:** `Authorization: Bearer <access_token>`

## Authentication Middleware

### Usage dalam Routes
```typescript
import { authenticateToken, requireAdmin, requireLibrarianOrAdmin } from '../middleware/auth.js';

// Protect endpoint dengan authentication
fastify.get('/protected', {
  preHandler: authenticateToken
}, async (request, reply) => {
  const user = (request as any).user;
  // user berisi: { userId, username, email, role }
});

// Require admin role
fastify.post('/admin-only', {
  preHandler: [authenticateToken, requireAdmin]
}, async (request, reply) => {
  // Only admin can access
});

// Require librarian or admin
fastify.put('/librarian-or-admin', {
  preHandler: [authenticateToken, requireLibrarianOrAdmin]
}, async (request, reply) => {
  // Librarian or admin can access
});
```

### Custom Role Authorization
```typescript
import { authorizeRoles } from '../middleware/auth.js';

fastify.get('/custom-roles', {
  preHandler: [authenticateToken, authorizeRoles('admin', 'librarian')]
}, handler);
```

## User Roles

### 1. Admin
- Full access ke semua endpoints
- Dapat mengelola user lain
- Dapat mengakses semua fitur dashboard

### 2. Librarian
- Access ke fitur perpustakaan
- Dapat mengelola buku dan visitor
- Tidak dapat mengelola user admin

### 3. Viewer
- Read-only access
- Dapat melihat dashboard dan statistik
- Tidak dapat melakukan perubahan data

## Security Features

### 1. Password Security
- Password di-hash menggunakan bcrypt dengan salt rounds 12
- Password tidak pernah disimpan dalam bentuk plain text

### 2. JWT Security
- Access token memiliki expire time pendek (15 menit)
- Refresh token disimpan terenkripsi di database
- Token menggunakan issuer dan audience validation

### 3. Token Management
- Refresh token dapat di-revoke
- Logout all devices menghapus semua refresh token user
- Expired token otomatis dibersihkan dengan cron job

## Testing dengan cURL

### 1. Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

### 2. Access Protected Endpoint
```bash
curl -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 3. Refresh Token
```bash
curl -X POST http://localhost:5000/api/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

## File Structure

```
src/
├── middleware/
│   └── auth.ts              # Authentication middleware
├── models/
│   ├── User.ts             # User model
│   └── RefreshToken.ts     # Refresh token model
├── routes/
│   └── auth.ts             # Authentication routes
├── services/
│   └── authService.ts      # Authentication business logic
├── db/
│   └── authSequelize.ts    # Auth database connection
├── cron/
│   └── authCleanup.ts      # Token cleanup cron job
├── scripts/
│   └── setupAuthDatabase.ts # Database setup script
└── database/
    └── auth_schema.sql     # Database schema
```

## Troubleshooting

### Error: "Database connection failed"
- Pastikan MySQL server berjalan
- Check konfigurasi MYSQL2_* di file .env
- Pastikan database dan user sudah dibuat

### Error: "JWT_SECRET is required"
- Pastikan JWT_SECRET sudah diset di .env
- Gunakan secret yang strong untuk production

### Error: "Invalid token"
- Token mungkin expired, gunakan refresh token
- Check format Authorization header: "Bearer <token>"

### Error: "User not found"
- Pastikan database schema sudah ter-setup
- Check apakah default users sudah ter-insert

## Production Considerations

1. **JWT Secrets**: Gunakan secret yang kuat dan unik untuk production
2. **HTTPS**: Selalu gunakan HTTPS di production
3. **Rate Limiting**: Implementasikan rate limiting untuk login endpoints
4. **Monitoring**: Monitor failed login attempts
5. **Backup**: Regular backup database auth
6. **Token Rotation**: Pertimbangkan implementasi automatic token rotation