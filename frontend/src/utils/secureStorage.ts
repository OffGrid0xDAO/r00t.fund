/**
 * Secure Storage Utility
 *
 * SECURITY FIX: Encrypts sensitive data before storing in localStorage
 *
 * Uses:
 * - PBKDF2 for key derivation (100,000 iterations)
 * - AES-GCM for authenticated encryption
 * - Random salt and IV for each encryption
 *
 * This prevents XSS attacks from stealing plaintext secrets from localStorage.
 */

// Salt length for PBKDF2
const SALT_LENGTH = 16;
// IV length for AES-GCM
const IV_LENGTH = 12;
// PBKDF2 iterations (OWASP recommends minimum 100,000 for PBKDF2-SHA256)
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive an encryption key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-GCM using a password-derived key
 * @param data - Data to encrypt (will be JSON stringified)
 * @param password - Password for key derivation
 * @returns Base64-encoded encrypted string (salt + iv + ciphertext)
 */
export async function encryptData<T>(data: T, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataString = JSON.stringify(data);
  const dataBytes = encoder.encode(dataString);

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive key from password
  const key = await deriveKey(password, salt);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBytes
  );

  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data with AES-GCM using a password-derived key
 * @param encryptedBase64 - Base64-encoded encrypted string
 * @param password - Password for key derivation
 * @returns Decrypted and parsed data
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export async function decryptData<T>(encryptedBase64: string, password: string): Promise<T> {
  const decoder = new TextDecoder();

  // Decode base64
  const combined = new Uint8Array(
    atob(encryptedBase64).split('').map(c => c.charCodeAt(0))
  );

  // Extract salt, iv, and ciphertext
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  // Derive key from password
  const key = await deriveKey(password, salt);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  // Parse and return
  const dataString = decoder.decode(decrypted);
  return JSON.parse(dataString) as T;
}

/**
 * Check if a string looks like encrypted data (base64 with correct length)
 */
export function isEncrypted(data: string): boolean {
  try {
    // Minimum length: salt (16) + iv (12) + tag (16) + some data = ~60 chars base64
    if (data.length < 60) return false;
    // Try to decode as base64
    const decoded = atob(data);
    // Check if decoded length is at least salt + iv + tag
    return decoded.length >= SALT_LENGTH + IV_LENGTH + 16;
  } catch {
    return false;
  }
}

// Storage key prefix for encrypted data
const ENCRYPTED_PREFIX = 'enc_';

/**
 * Secure storage wrapper that encrypts data before storing
 */
export class SecureStorage {
  private password: string | null = null;
  private isUnlocked = false;

  /**
   * Unlock the storage with a password
   * @param password - User's password
   * @returns true if unlocked successfully
   */
  async unlock(password: string): Promise<boolean> {
    // Test if password is correct by trying to decrypt a test value
    const testKey = ENCRYPTED_PREFIX + 'test';
    const testValue = localStorage.getItem(testKey);

    if (testValue) {
      try {
        await decryptData(testValue, password);
      } catch {
        // Wrong password
        return false;
      }
    } else {
      // First time - store a test value
      const encrypted = await encryptData({ test: true }, password);
      localStorage.setItem(testKey, encrypted);
    }

    this.password = password;
    this.isUnlocked = true;
    return true;
  }

  /**
   * Lock the storage (clear password from memory)
   */
  lock(): void {
    this.password = null;
    this.isUnlocked = false;
  }

  /**
   * Check if storage is unlocked
   */
  get unlocked(): boolean {
    return this.isUnlocked;
  }

  /**
   * Set an encrypted item
   * @throws Error if storage is locked
   */
  async setItem<T>(key: string, value: T): Promise<void> {
    if (!this.password) {
      throw new Error('Storage is locked. Call unlock() first.');
    }
    const encrypted = await encryptData(value, this.password);
    localStorage.setItem(ENCRYPTED_PREFIX + key, encrypted);
  }

  /**
   * Get and decrypt an item
   * @throws Error if storage is locked or decryption fails
   */
  async getItem<T>(key: string): Promise<T | null> {
    if (!this.password) {
      throw new Error('Storage is locked. Call unlock() first.');
    }
    const encrypted = localStorage.getItem(ENCRYPTED_PREFIX + key);
    if (!encrypted) return null;
    return decryptData<T>(encrypted, this.password);
  }

  /**
   * Remove an item
   */
  removeItem(key: string): void {
    localStorage.removeItem(ENCRYPTED_PREFIX + key);
  }

  /**
   * Check if an encrypted item exists
   */
  hasItem(key: string): boolean {
    return localStorage.getItem(ENCRYPTED_PREFIX + key) !== null;
  }

  /**
   * Change the password (re-encrypts all data)
   * @param oldPassword - Current password
   * @param newPassword - New password
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    // Verify old password
    if (!await this.unlock(oldPassword)) {
      return false;
    }

    // Find all encrypted keys
    const encryptedKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ENCRYPTED_PREFIX)) {
        encryptedKeys.push(key);
      }
    }

    // Re-encrypt all data with new password
    for (const fullKey of encryptedKeys) {
      const key = fullKey.slice(ENCRYPTED_PREFIX.length);
      const encrypted = localStorage.getItem(fullKey);
      if (encrypted) {
        try {
          const data = await decryptData(encrypted, oldPassword);
          const newEncrypted = await encryptData(data, newPassword);
          localStorage.setItem(fullKey, newEncrypted);
        } catch {
          // Skip corrupted entries
          console.warn(`Failed to re-encrypt ${key}`);
        }
      }
    }

    // Update stored password
    this.password = newPassword;
    return true;
  }

  /**
   * Check if any encrypted data exists (to determine if password is set)
   */
  hasEncryptedData(): boolean {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ENCRYPTED_PREFIX)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all encrypted data (use with caution!)
   */
  clearAll(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ENCRYPTED_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    this.lock();
  }
}

// Singleton instance
export const secureStorage = new SecureStorage();
