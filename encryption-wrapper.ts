export class NexusVault {
  private static ALGO = 'AES-GCM';

  static async deriveKey(password: string, salt: Uint8Array) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      baseKey, { name: this.ALGO, length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  static async encrypt(text: string, key: CryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({ name: this.ALGO, iv }, key, encoded);
    return { 
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))), 
      iv: btoa(String.fromCharCode(...iv)) 
    };
  }

  static async decrypt(encryptedContent: { ciphertext: string; iv: string }, key: CryptoKey) {
    const iv = new Uint8Array(atob(encryptedContent.iv).split('').map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(encryptedContent.ciphertext).split('').map(c => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt(
      { name: this.ALGO, iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }
}
