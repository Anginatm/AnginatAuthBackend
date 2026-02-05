const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

class S3Service {
  /**
   * Upload file to S3
   * @param {Buffer|string} fileContent - File content as buffer or path
   * @param {string} fileName - Name of file in S3
   * @param {string} mimeType - MIME type of file
   * @returns {Promise<string>} S3 public URL of uploaded file
   */
  async uploadFile(fileContent, fileName, mimeType = 'application/octet-stream') {
    try {
      let body = fileContent;

      // If fileContent is a file path, read the file
      if (typeof fileContent === 'string' && fs.existsSync(fileContent)) {
        body = fs.readFileSync(fileContent);
      }

      const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `qrcodes/${Date.now()}-${fileName}`,
        Body: body,
        ContentType: mimeType,
      };

      const result = await s3.upload(params).promise();
      return result.Location;
    } catch (error) {
      console.error('S3 upload error:', error);
      throw new Error(`Failed to upload to S3: ${error.message}`);
    }
  }

  /**
   * Delete file from S3
   * @param {string} s3Url - S3 URL of file
   * @returns {Promise<boolean>}
   */
  async deleteFile(s3Url) {
    try {
      // Extract key from URL
      const url = new URL(s3Url);
      const key = url.pathname.substring(1); // Remove leading slash

      const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
      };

      await s3.deleteObject(params).promise();
      return true;
    } catch (error) {
      console.error('S3 delete error:', error);
      throw new Error(`Failed to delete from S3: ${error.message}`);
    }
  }

  /**
   * Upload buffer to S3
   * @param {Buffer} buffer - File buffer
   * @param {string} fileName - File name
   * @param {string} mimeType - MIME type
   * @returns {Promise<string>} S3 public URL
   */
  async uploadBuffer(buffer, fileName, mimeType = 'application/octet-stream') {
    try {
      const key = `qrcodes/${Date.now()}-${fileName}`;
      
      const params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      };

      const result = await s3.upload(params).promise();
      return result.Location;
    } catch (error) {
      console.error('S3 upload buffer error:', error);
      throw new Error(`Failed to upload buffer to S3: ${error.message}`);
    }
  }
}

module.exports = new S3Service();
