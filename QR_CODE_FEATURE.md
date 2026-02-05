# QR Code Generation Feature

## Overview
This feature allows you to generate QR codes for authentication codes and store them in AWS S3. The QR codes contain a URL to a frontend page with the auth code as a parameter.

## Environment Variables Required

Add these to your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your_s3_bucket_name

# Frontend URL for QR code data
FRONTEND_BASE_URL=http://localhost:3000
```

## API Endpoints

### 1. Generate QR Code
**POST** `/api/codes/:codeId/generate-qr`

Generate and store a QR code for an authentication code.

**Request Body:**
```json
{
  "frontendUrl": "https://example.com/verify"
}
```

**Response:**
```json
{
  "success": true,
  "message": "QR code generated and stored successfully",
  "data": {
    "codeId": "ObjectId",
    "code": "ABC123",
    "qrCodeUrl": "https://your-bucket.s3.amazonaws.com/qrcodes/...",
    "qrData": "https://example.com/verify?code=ABC123",
    "brand": {
      "_id": "ObjectId",
      "name": "Brand Name"
    }
  }
}
```

### 2. Get QR Code
**GET** `/api/codes/:codeId/qr`

Retrieve the QR code URL for an authentication code.

**Response:**
```json
{
  "success": true,
  "data": {
    "codeId": "ObjectId",
    "code": "ABC123",
    "qrCodeUrl": "https://your-bucket.s3.amazonaws.com/qrcodes/...",
    "brand": {
      "_id": "ObjectId",
      "name": "Brand Name"
    }
  }
}
```

### 3. Regenerate QR Code
**PATCH** `/api/codes/:codeId/regenerate-qr`

Regenerate a QR code and replace the old one in S3.

**Request Body:**
```json
{
  "frontendUrl": "https://example.com/verify"
}
```

**Response:** Same as Generate QR Code endpoint

## Database Schema Updates

The `AuthCode` model now includes:

```javascript
qrCodeUrl: {
  type: String,
  sparse: true,  // Optional, only for codes with QR codes
}
```

## How It Works

1. **QR Code Data**: The QR code contains a frontend URL with the auth code as a query parameter:
   - Example: `https://example.com/verify?code=ABC123`

2. **S3 Storage**: Generated QR codes are stored in AWS S3 under the `qrcodes/` prefix with timestamps for uniqueness

3. **Database Storage**: The S3 URL is saved in the `AuthCode` document's `qrCodeUrl` field

4. **Update/Regeneration**: When regenerating, the old QR code is automatically deleted from S3

## Installation

The `qrcode` package has been added to dependencies. Run:

```bash
npm install
```

## AWS S3 Bucket Configuration

Ensure your S3 bucket has:
- Public read access for the `qrcodes/` folder (or enable public-read ACL)
- Appropriate CORS configuration if accessed from frontend
- Proper IAM permissions for your AWS user

## Error Handling

- Returns 404 if auth code doesn't exist
- Returns 400 if frontendUrl is missing
- Returns 500 with error message for S3 or other server errors

## Frontend Integration

When a user scans the QR code, they'll be directed to:
```
https://example.com/verify?code=ABC123
```

Your frontend can then:
1. Extract the `code` parameter from the URL
2. Use it to verify the product authenticity
