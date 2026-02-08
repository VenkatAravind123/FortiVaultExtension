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

        div.querySelector('.fill').addEventListener('click', async () => {
          const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
          const url = tab.url;

          const result = await checkPhishing(url);

          console.log("Phishing Risk Score:", result.score);

          if (result.score >= 70) {
            alert("🚨 Malicious site detected. Autofill blocked.");
            return;
          }

          if (result.score >= 30) {
            const ok = confirm("⚠ Suspicious website detected. Continue autofill?");
            if (!ok) return;
          }

          chrome.tabs.sendMessage(tab.id, {
            type: 'AUTOFILL',
            payload: { username: e.username, password: pwd }
          });
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

  // ========== URL RISK CHECKER ==========

  const TRUSTED_DOMAINS = [
    "google.com", "accounts.google.com", "mail.google.com", "googleapis.com",
    "github.com", "microsoft.com", "login.microsoftonline.com", "live.com", "outlook.com",
    "apple.com", "icloud.com", "amazon.com", "aws.amazon.com",
    "facebook.com", "fb.com", "instagram.com", "meta.com", "twitter.com", "x.com",
    "coderabbit.ai", "vercel.com", "netlify.com", "heroku.com",
    "auth0.com", "okta.com", "clerk.dev", "firebase.com",
    "stackoverflow.com", "reddit.com", "discord.com", "slack.com",
    "paypal.com", "stripe.com", "wise.com", "razorpay.com",
    "netflix.com", "spotify.com", "twitch.tv", "youtube.com",
    "ebay.com", "shopify.com", "linkedin.com", "whatsapp.com", "zoom.us",
    "dropbox.com", "notion.so", "figma.com", "canva.com", "medium.com"
  ];

  const HOSTING_PLATFORMS = [
    "appspot.com", "herokuapp.com", "netlify.app", "vercel.app",
    "github.io", "pages.dev", "web.app", "firebaseapp.com"
  ];

  function isTrustedDomain(hostname) {
    const isHostingPlatform = HOSTING_PLATFORMS.some(platform => hostname.endsWith(platform));
    if (isHostingPlatform) return false;
    return TRUSTED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  }

  function checkPhishingScore(url) {
    let score = 0;
    const reasons = [];

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { score: 100, reasons: ["Malformed URL"] };
    }

    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const fullUrl = url.toLowerCase();

    if (isTrustedDomain(hostname)) {
      return { score: 0, reasons: ["✅ Trusted domain"] };
    }

    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      score += 30;
      reasons.push("IP address used instead of domain");
    }

    if (parsed.protocol !== "https:") {
      score += 20;
      reasons.push("Not using HTTPS");
    }

    const suspiciousTLDs = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".click", ".loan", ".work", ".icu", ".buzz"];
    if (suspiciousTLDs.some(tld => hostname.endsWith(tld))) {
      score += 25;
      reasons.push("Suspicious TLD");
    }

    const brands = [
      { name: "google", legit: ["google.com", "googleapis.com", "googleusercontent.com"] },
      { name: "paypal", legit: ["paypal.com", "paypal.me"] },
      { name: "facebook", legit: ["facebook.com", "fb.com"] },
      { name: "microsoft", legit: ["microsoft.com", "live.com", "outlook.com", "office.com"] },
      { name: "apple", legit: ["apple.com", "icloud.com"] },
      { name: "amazon", legit: ["amazon.com", "amzn.to", "amazonaws.com"] },
      { name: "netflix", legit: ["netflix.com"] },
      { name: "instagram", legit: ["instagram.com"] },
      { name: "linkedin", legit: ["linkedin.com"] },
      { name: "twitter", legit: ["twitter.com", "x.com"] },
      { name: "discord", legit: ["discord.com", "discord.gg"] },
      { name: "spotify", legit: ["spotify.com"] }
    ];

    for (const brand of brands) {
      if (hostname.includes(brand.name)) {
        const isLegit = brand.legit.some(legit => hostname === legit || hostname.endsWith('.' + legit));
        if (!isLegit) {
          score += 35;
          reasons.push(`Possible ${brand.name.charAt(0).toUpperCase() + brand.name.slice(1)} impersonation`);
          break;
        }
      }
    }

    const typosquatPatterns = [
      { pattern: /g[0o]{2}gle|googl[e3]/i, brand: "Google" },
      { pattern: /faceb[0o]{2}k/i, brand: "Facebook" },
      { pattern: /pay[p]?a[l1]/i, brand: "PayPal" },
      { pattern: /amaz[0o]n|arnazon/i, brand: "Amazon" },
      { pattern: /micr[0o]s[0o]ft|rnicrosoft/i, brand: "Microsoft" },
      { pattern: /app[l1]e/i, brand: "Apple" },
      { pattern: /netf[l1]ix/i, brand: "Netflix" }
    ];

    for (const typo of typosquatPatterns) {
      if (typo.pattern.test(hostname)) {
        score += 40;
        reasons.push(`Typosquatting (fake ${typo.brand})`);
        break;
      }
    }

    if (hostname.split('.').length > 4) {
      score += 15;
      reasons.push("Too many subdomains");
    }

    if (fullUrl.includes('@')) {
      score += 25;
      reasons.push("@ symbol (redirect trick)");
    }

    if (/%[0-9a-f]{2}/i.test(hostname)) {
      score += 20;
      reasons.push("Encoded characters in hostname");
    }

    if (hostname.length > 40) {
      score += 10;
      reasons.push("Very long hostname");
    }

    if ((hostname.match(/-/g) || []).length > 3) {
      score += 10;
      reasons.push("Excessive hyphens");
    }

    if (/\d{4,}/.test(hostname)) {
      score += 10;
      reasons.push("Suspicious number pattern");
    }

    return { score: Math.min(score, 100), reasons };
  }

  // Safe Browsing via backend
  // ...existing code...
async function checkGoogleSafeBrowsing(url) {
  console.log("[FortiVault] 🔍 Checking Google Safe Browsing via backend");
  console.log("[FortiVault] ✅ Sending URL to backend:", url);

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "CHECK_URL_SAFETY",
      payload: { url }
    });

    console.log("[FortiVault] ✅ Backend response received:", resp);

    if (!resp || !resp.success) {
      console.log("[FortiVault] ❌ Backend error:", resp?.error);
      return { flagged: false, threats: [], error: resp?.error || "Backend error" };
    }

    const data = resp.data;
    console.log("[FortiVault] ✅ Parsed backend data:", data);

    if (data.safe === false) {
      console.log("[FortiVault] 🚨 URL flagged by backend Safe Browsing");
      return { flagged: true, threats: data.threats || [] };
    }

    console.log("[FortiVault] ✅ URL clean by backend Safe Browsing");
    return { flagged: false, threats: [] };
  } catch (err) {
    console.log("[FortiVault] ❌ Safe Browsing check failed:", err.message);
    return { flagged: false, threats: [], error: err.message };
  }
}
// ...existing code...

  async function checkPhishing(url) {
    const googleResult = await checkGoogleSafeBrowsing(url);
    const lexicalResult = checkPhishingScore(url);

    let finalScore = lexicalResult.score;
    const allReasons = [...lexicalResult.reasons];

    if (googleResult.flagged) {
      finalScore += 50;
      allReasons.unshift("🚨 Flagged by Google Safe Browsing");
    }

    finalScore = Math.min(finalScore, 100);
    return { score: finalScore, reasons: allReasons, googleFlagged: googleResult.flagged };
  }

  const urlCheckInput = document.getElementById('urlCheckInput');
  const checkUrlBtn = document.getElementById('checkUrlBtn');
  const urlRiskResult = document.getElementById('urlRiskResult');

  if (checkUrlBtn) {
    checkUrlBtn.addEventListener('click', async () => {
      let url = urlCheckInput.value.trim();
      
      if (!url) {
        showMessage('Please enter a URL', 3000, 'error');
        return;
      }
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      urlRiskResult.style.display = 'block';
      urlRiskResult.innerHTML = '<div>🔍 Checking URL...</div>';
      
      const result = await checkPhishing(url);
      const finalScore = result.score;
      const allReasons = result.reasons;
      
      let riskLevel, riskClass, emoji;
      if (finalScore === 0) {
        riskLevel = 'Safe - Trusted Domain';
        riskClass = 'safe';
        emoji = '✅';
      } else if (finalScore < 25) {
        riskLevel = 'Low Risk';
        riskClass = 'safe';
        emoji = '🟢';
      } else if (finalScore < 50) {
        riskLevel = 'Moderate Risk';
        riskClass = 'moderate';
        emoji = '⚠️';
      } else if (finalScore < 75) {
        riskLevel = 'High Risk';
        riskClass = 'dangerous';
        emoji = '🔴';
      } else {
        riskLevel = 'Very High Risk - Likely Phishing!';
        riskClass = 'dangerous';
        emoji = '🚨';
      }
      
      const reasonsHtml = allReasons.length > 0 
        ? `<div style="font-size: 11px; margin-top: 10px; text-align: left; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px;">
            ${allReasons.map(r => `• ${r}`).join('<br>')}
           </div>`
        : '';
      
      urlRiskResult.className = `risk-result ${riskClass}`;
      urlRiskResult.innerHTML = `
        <div style="font-size: 18px; margin-bottom: 4px;">${emoji} <strong>${riskLevel}</strong></div>
        <div style="font-size: 14px; margin-top: 4px;">Risk Score: ${finalScore}/100</div>
        <div class="risk-score-bar">
          <div class="risk-score-fill" style="width: ${finalScore}%; background: ${finalScore < 25 ? '#48bb78' : finalScore < 50 ? '#ed8936' : '#f56565'};"></div>
        </div>
        ${reasonsHtml}
      `;
    });

    urlCheckInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') checkUrlBtn.click();
    });
  }
})();