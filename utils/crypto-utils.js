// utils/crypto-utils.js
// Exposes async functions: deriveKeyFromPassword, encryptString, decryptString, generateRandomSalt
const cryptoUtils = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function bufToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
  }
  function base64ToBuf(b64) {
    const binStr = atob(b64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes.buffer;
  }

  async function generateRandomSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return bufToBase64(salt.buffer);
  }

  async function deriveKeyFromPassword(password, saltB64, iterations = 250000) {
    const saltBuf = base64ToBuf(saltB64);
    const pwKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBuf,
        iterations,
        hash: "SHA-256"
      },
      pwKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    return key;
  }

  async function encryptString(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext)
    );
    return {
      iv: bufToBase64(iv.buffer),
      data: bufToBase64(cipherBuf)
    };
  }

  async function decryptString(key, cipherObj) {
    const ivBuf = base64ToBuf(cipherObj.iv);
    const dataBuf = base64ToBuf(cipherObj.data);
    try {
      const plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuf },
        key,
        dataBuf
      );
      return dec.decode(plainBuf);
    } catch (e) {
      throw new Error("Decryption failed");
    }
  }

  return {
    generateRandomSalt,
    deriveKeyFromPassword,
    encryptString,
    decryptString,
    bufToBase64,
    base64ToBuf
  };
})();
