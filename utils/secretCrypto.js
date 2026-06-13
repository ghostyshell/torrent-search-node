const crypto = require('crypto');

function getEncryptionKey() {
  const secret =
    process.env.REAL_DEBRID_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is required for secret encryption');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSecret(plaintext) {
  if (!plaintext) return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(ciphertext) {
  if (!ciphertext) return null;

  if (!ciphertext.startsWith('v1:')) {
    return ciphertext;
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted secret format');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret,
};
