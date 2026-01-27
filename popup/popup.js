// popup/popup.js
(async () => {
  const masterInput = document.getElementById('masterPassword');
  const unlockBtn = document.getElementById('unlockBtn');
  const lockBtn = document.getElementById('lockBtn');
  const vaultSection = document.getElementById('vault-section');
  const vaultList = document.getElementById('vaultList');
  const addManualBtn = document.getElementById('addManualBtn');
  const siteInput = document.getElementById('siteInput');
  const urlInput = document.getElementById('urlInput');
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const syncBtn = document.getElementById('syncBtn');
  const loginBtn = document.getElementById('loginBtn');
  const messageDiv = document.getElementById('message');

  const STORAGE_KEYS = {
    VAULT: 'securevault_vault',
    MASTER_SALT: 'securevault_salt',
    TOKEN: 'securevault_token'
  };

  let masterKey = null;
  let masterPassword = null;

  function showMessage(msg, timeout = 3000, type = 'success') {
    messageDiv.textContent = msg;
    messageDiv.style.display = 'block';
    
    // Apply different styles based on message type
    if (type === 'error') {
      messageDiv.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    } else if (type === 'info') {
      messageDiv.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    } else {
      messageDiv.style.background = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
    }
    
    setTimeout(() => {
      messageDiv.textContent = '';
      messageDiv.style.display = 'none';
    }, timeout);
  }

  // Unlock vault
  unlockBtn.addEventListener('click', async () => {
    const pw = masterInput.value;
    if (!pw) return showMessage('Enter master password', 3000, 'error');

    const stored = await chrome.storage.local.get([STORAGE_KEYS.MASTER_SALT, 'securevault_master_hash']);
    let salt = stored[STORAGE_KEYS.MASTER_SALT];
    let storedHash = stored['securevault_master_hash'];

    if (!salt) {
      salt = await cryptoUtils.generateRandomSalt();
      await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_SALT]: salt });
    }

    // Hash password for verification
    const enc = new TextEncoder().encode(pw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (!storedHash) {
      await chrome.storage.local.set({ 'securevault_master_hash': hashHex });
      showMessage('Master password set successfully!');
    } else if (storedHash !== hashHex) {
      return showMessage('Incorrect master password', 3000, 'error');
    }

    try {
      masterKey = await cryptoUtils.deriveKeyFromPassword(pw, salt);
      masterPassword = pw;
      await renderVault();
      document.getElementById('auth-section').style.display = 'none';
      vaultSection.style.display = 'block';
      showMessage('Vault unlocked', 3000, 'success');
    } catch (err) {
      console.error(err);
      showMessage('Failed to derive key', 3000, 'error');
    }
  });

  // Lock vault
  lockBtn.addEventListener('click', () => {
    masterKey = null;
    masterPassword = null;
    vaultSection.style.display = 'none';
    document.getElementById('auth-section').style.display = 'block';
    masterInput.value = '';
  });

  // Render vault
  async function renderVault() {
    vaultList.innerHTML = '';
    const data = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];

    for (const e of data) {
      try {
        if (!e.iv || !e.ciphertext || !e.salt) {
          console.warn("⚠️ Skipping unencrypted entry:", e);
          continue;
        }

        const key = await cryptoUtils.deriveKeyFromPassword(masterPassword, e.salt);
        const pwd = await cryptoUtils.decryptString(key, { iv: e.iv, data: e.ciphertext });

        const div = document.createElement('div');
        div.className = 'entry';
        div.innerHTML = `
          <div class="left">
            <div><strong>${e.site}</strong></div>
            <div class="small"><a href="${e.url}" target="_blank" rel="noopener noreferrer" class="url-link">${e.url}</a></div>
            <div class="small">Username: ${e.username}</div>
            <div class="small">Password: <span class="pwd">*****</span></div>
          </div>
          <div class="entry-actions">
            <button class="reveal">Reveal</button>
            <button class="fill">Autofill</button>
            <button class="del">Delete</button>
          </div>
        `;
        vaultList.appendChild(div);

        div.querySelector('.reveal').addEventListener('click', () => {
          div.querySelector('.pwd').textContent = pwd;
        });

        div.querySelector('.fill').addEventListener('click', () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'AUTOFILL',
              payload: { username: e.username, password: pwd }
            });
          });
          showMessage('Sent credentials to page');
        });

        div.querySelector('.del').addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'DELETE_ENTRY', payload: { id: e.id } });
          await renderVault();
        });

      } catch (err) {
        console.error("Decrypt fail for entry:", e, err);
      }
    }
  }

  // Add manual entry
  addManualBtn.addEventListener('click', async () => {
    if (!masterKey || !masterPassword) return showMessage('Unlock vault first', 3000, 'error');
    const site = siteInput.value;
    const url = urlInput.value;
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (!site || !password) return showMessage('Site and password required', 3000, 'error');

    const stored = await chrome.storage.local.get(STORAGE_KEYS.MASTER_SALT);
    const salt = stored[STORAGE_KEYS.MASTER_SALT];
    const key = await cryptoUtils.deriveKeyFromPassword(masterPassword, salt);
    const cipherObj = await cryptoUtils.encryptString(key, password);

    const entry = {
      id: Date.now().toString(),
      site,
      url,
      username,
      ciphertext: cipherObj.data,
      iv: cipherObj.iv,
      salt
    };

    const vault = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
    vault.push(entry);
    await chrome.storage.local.set({ [STORAGE_KEYS.VAULT]: vault });

    siteInput.value = urlInput.value = usernameInput.value = passwordInput.value = '';
    await renderVault();
    showMessage('Added to local vault');
  });

  // Sync to backend
  syncBtn.addEventListener('click', async () => {
    showMessage('Syncing...', 3000, 'info');
    chrome.runtime.sendMessage({ type: 'SYNC_TO_BACKEND' }, (resp) => {
      if (resp && resp.success) showMessage('Sync succeeded');
      else showMessage('Sync failed: ' + (resp && resp.error ? JSON.stringify(resp.error) : 'unknown'));
    });
  });

  // Backend login
  loginBtn.addEventListener('click', () => {
    document.getElementById('login-modal').style.display = 'block';
  });

  document.getElementById('backendLoginBtn').addEventListener('click', async () => {
    const email = document.getElementById('backendEmail').value;
    const pw = document.getElementById('backendPassword').value;
    if (!email || !pw) return showMessage('Enter backend credentials', 3000, 'error');

    try {
      const res = await fetch('http://localhost:2025/api/extension/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, masterPassword: pw })
      });
      if (!res.ok) {
        const txt = await res.text();
        return showMessage('Login failed: ' + txt, 3000, 'error');
      }
      const data = await res.json();
      if (data.success) {
      await chrome.storage.local.set({ "securevault_user": data.user });
      await chrome.runtime.sendMessage({ type: 'STORE_TOKEN', payload: { token: data.token } });
      showMessage("Login successful, ready to sync");
}

    } catch (err) {
      showMessage('Login error', 3000, 'error');
    }
  });

  document.getElementById('closeLoginModal').addEventListener('click', () => {
    document.getElementById('login-modal').style.display = 'none';
  });

  // Auto-detected credentials
  document.addEventListener("DOMContentLoaded", async () => {
    const data = await chrome.storage.local.get("lastDetectedCredentials");
    const detected = data.lastDetectedCredentials;

    if (detected) {
      const confirmBox = document.getElementById("detected-credentials");
      confirmBox.style.display = "block";
      confirmBox.innerHTML = `
        <p>Save credentials for <strong>${detected.site}</strong>?</p>
        <p><small>${detected.url}</small></p>
        <button id="saveDetected">Save</button>
        <button id="dismissDetected">Dismiss</button>
      `;

      document.getElementById("saveDetected").addEventListener("click", async () => {
        if (!masterPassword) return showMessage("Unlock vault first", 3000, 'error');

        const vaultData = (await chrome.storage.local.get(STORAGE_KEYS.VAULT))[STORAGE_KEYS.VAULT] || [];
        const stored = await chrome.storage.local.get(STORAGE_KEYS.MASTER_SALT);
        const salt = stored[STORAGE_KEYS.MASTER_SALT];
        const key = await cryptoUtils.deriveKeyFromPassword(masterPassword, salt);
        const cipherObj = await cryptoUtils.encryptString(key, detected.password);

        const entry = {
          id: Date.now().toString(),
          site: detected.site,
          url: detected.url,
          username: detected.username,
          ciphertext: cipherObj.data,
          iv: cipherObj.iv,
          salt
        };

        vaultData.push(entry);
        await chrome.storage.local.set({ [STORAGE_KEYS.VAULT]: vaultData });
        await chrome.storage.local.remove("lastDetectedCredentials");

        confirmBox.innerHTML = "<p>✅ Credentials saved successfully!</p>";
        await renderVault();
      });

      document.getElementById("dismissDetected").addEventListener("click", async () => {
        await chrome.storage.local.remove("lastDetectedCredentials");
        confirmBox.style.display = "none";
      });
    }
  });

})();
