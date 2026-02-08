// background.js
importScripts('utils/crypto-utils.js');

const BACKEND_BASE_URL = "http://localhost:2025"; // <-- replace

// Helper keys in storage
const STORAGE_KEYS = {
  VAULT: 'securevault_vault',        // stores array of entries {id, site, url, username, ciphertext, iv, salt}
  MASTER_SALT: 'securevault_salt',   // salt used for PBKDF2 (base64)
  TOKEN: 'securevault_token'    
       // optional backend JWT after login
};

// Generate a UUID for entry ids
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c === 'x' ? 0 : 0);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Save encrypted entry in chrome.storage.local
async function saveEncryptedEntry(entry) {
  const all = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
  all.push(entry);
  await chrome.storage.local.set({ [STORAGE_KEYS.VAULT]: all });
  return entry;
}

// Messages from content/popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'SAVE_RAW_CREDENTIAL') {
        // msg.payload = { site, url, username, password, masterPassword }
        const { site, url, username, password, masterPassword } = msg.payload;

        // Ensure we have a salt (if none, create and store)
        let stored = await chrome.storage.local.get(STORAGE_KEYS.MASTER_SALT);
        let salt = stored[STORAGE_KEYS.MASTER_SALT];
        if (!salt) {
          salt = await cryptoUtils.generateRandomSalt();
          await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_SALT]: salt });
        }

        const key = await cryptoUtils.deriveKeyFromPassword(masterPassword, salt);
        const cipherObj = await cryptoUtils.encryptString(key, password);

        const entry = {
          id: uuidv4(),
          site,
          url,
          username,
          ciphertext: cipherObj.data,
          iv: cipherObj.iv,
          salt // store salt so decrypt can derive
        };

        await saveEncryptedEntry(entry);
        sendResponse({ success: true, entry });
      }

      if (msg.type === 'GET_VAULT') {
        const vault = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
        sendResponse({ success: true, vault });
      }

      if (msg.type === 'DELETE_ENTRY') {
        const id = msg.payload.id;
        const stored = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
        const filtered = stored.filter(e => e.id !== id);
        await chrome.storage.local.set({ [STORAGE_KEYS.VAULT]: filtered });
        sendResponse({ success: true });
      }

      if (msg.type === 'SYNC_TO_BACKEND') {
        const tokenStored = (await chrome.storage.local.get(STORAGE_KEYS.TOKEN))[STORAGE_KEYS.TOKEN];
        const vault = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
        const userData = (await chrome.storage.local.get("securevault_user"))["securevault_user"];
        
        if (!userData || !userData.email) {
          sendResponse({ success: false, error: "User not logged in" });
          return;
        }

        const res = await fetch(`${BACKEND_BASE_URL}/api/extension/sync-vault`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': tokenStored ? `Bearer ${tokenStored}` : '',
          },
          body: JSON.stringify({
            email: userData.email,
            vault
          })
        });

        if (!res.ok) {
          const text = await res.text();
          sendResponse({ success: false, error: text });
        } else {
          const data = await res.json();
          sendResponse({ success: true, data });
        }
      }

      // Google Safe Browsing via backend
if (msg.type === 'CHECK_URL_SAFETY') {
        const { url } = msg.payload || {};
        if (!url) {
          sendResponse({ success: false, error: "URL is required" });
          return;
        }

        const res = await fetch(`${BACKEND_BASE_URL}/api/extension/check-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url })
        });

        if (!res.ok) {
          const text = await res.text();
          sendResponse({ success: false, error: text });
          return;
        }

        const data = await res.json();
        sendResponse({ success: true, data });
      }
      if (msg.type === 'STORE_TOKEN') {
        await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: msg.payload.token });
        sendResponse({ success: true });
      }

    } catch (err) {
      console.error('bg error', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DETECTED_CREDENTIALS') {
    console.log('Detected credentials:', msg.payload);
    
    chrome.notifications.create({
      type: "basic",
      title: "Save Credentials?",
      message: `Do you want to save credentials for ${msg.payload.site}?`,
      iconUrl: "icons/icon128.png"
    });

    chrome.storage.local.set({ lastDetectedCredentials: msg.payload });
  }
});