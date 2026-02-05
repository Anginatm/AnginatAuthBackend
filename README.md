# Anginat Auth Backend

Simple product authentication API - verify codes and identify brands.

## Flow

1. **Create Brand** → Add brand with name, logo, contact info
2. **Upload Codes** → Upload CSV of authentication codes linked to brand
3. **Verify Code** → Public endpoint returns: authenticated (true/false) + brand info

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your MongoDB URI
npm run dev
```

## API Endpoints

### Public (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/verify/:code` | Verify a code |
| POST | `/api/verify` | Verify a code (body: `{ code }`) |

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |

### Brands (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/brands` | Create brand |
| GET | `/api/brands` | List brands |
| GET | `/api/brands/:id` | Get brand |
| PATCH | `/api/brands/:id` | Update brand |
| DELETE | `/api/brands/:id` | Deactivate brand |

### Codes (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/codes/upload` | Upload CSV (form-data: file + brandId) |
| POST | `/api/codes` | Add single code |
| GET | `/api/codes` | List codes |
| DELETE | `/api/codes/:id` | Delete code |
| GET | `/api/codes/template` | Download CSV template |

## Usage Examples

### 1. Register & Login

```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@test.com","password":"password123"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'
```

### 2. Create Brand

```bash
curl -X POST http://localhost:5000/api/brands \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Acme Corp",
    "logo": "https://example.com/logo.png",
    "website": "https://acme.com",
    "contactEmail": "support@acme.com"
  }'
```

### 3. Upload Codes (CSV)

```bash
curl -X POST http://localhost:5000/api/codes/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@codes.csv" \
  -F "brandId=BRAND_ID_HERE"
```

CSV format:
```csv
code
ABC123
XYZ789
DEF456
```

### 4. Verify Code (Public)

```bash
curl http://localhost:5000/api/verify/ABC123
```

**Response if authentic:**
```json
{
  "authenticated": true,
  "message": "Product is genuine",
  "brand": {
    "name": "Acme Corp",
    "logo": "https://example.com/logo.png",
    "website": "https://acme.com",
    "contactEmail": "support@acme.com"
  }
}
```

**Response if not found:**
```json
{
  "authenticated": false,
  "message": "This code is not valid. Product may be counterfeit."
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 5000 |
| MONGODB_URI | MongoDB connection string | mongodb://localhost:27017/anginat-auth |
| JWT_SECRET | JWT signing secret | (required) |
| JWT_EXPIRES_IN | Token expiry | 7d |
| CORS_ORIGINS | Allowed origins (comma-separated) | * |

## Deploy

```bash
# PM2
pm2 start server.js --name anginat-auth

# Docker
docker build -t anginat-auth .
docker run -p 5000:5000 --env-file .env anginat-auth
```

## License

MIT © Anginat
