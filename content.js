// content.js - improved detection & autofill

// ===============================
// TRUSTED DOMAINS WHITELIST
// ===============================
const TRUSTED_DOMAINS = [
  "google.com", "accounts.google.com", "mail.google.com", "googleapis.com",
  "github.com", "gist.github.com",
  "microsoft.com", "login.microsoftonline.com", "live.com", "outlook.com", "office.com",
  "apple.com", "icloud.com",
  "amazon.com", "aws.amazon.com",
  "facebook.com", "fb.com", "instagram.com", "meta.com",
  "twitter.com", "x.com",
  "coderabbit.ai", "vercel.com", "netlify.com", "heroku.com",
  "auth0.com", "okta.com", "clerk.dev", "firebase.com", "firebaseapp.com",
  "stackoverflow.com", "stackexchange.com",
  "reddit.com", "discord.com", "slack.com",
  "gitlab.com", "bitbucket.org", "atlassian.com", "jira.com",
  "paypal.com", "stripe.com", "wise.com", "razorpay.com",
  "netflix.com", "spotify.com", "twitch.tv", "youtube.com", "youtu.be",
  "ebay.com", "shopify.com", "etsy.com", "flipkart.com",
  "linkedin.com", "whatsapp.com", "telegram.org", "zoom.us", "meet.google.com",
  "dropbox.com", "notion.so", "figma.com", "canva.com", "trello.com",
  "coursera.org", "udemy.com", "edx.org", "khanacademy.org",
  "medium.com", "wordpress.com", "blogger.com", "wikipedia.org"
];

// Hosting platforms that can contain malicious content - don't auto-trust
const HOSTING_PLATFORMS = [
  "appspot.com", "herokuapp.com", "netlify.app", "vercel.app",
  "github.io", "pages.dev", "web.app", "firebaseapp.com"
];

function isTrustedDomain(hostname) {
  const isHostingPlatform = HOSTING_PLATFORMS.some(platform => hostname.endsWith(platform));
  if (isHostingPlatform) return false;

  return TRUSTED_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );
}

// ===============================
// GOOGLE SAFE BROWSING VIA BACKEND
// ===============================
// ...existing code...
async function checkGoogleSafeBrowsing(url) {
  console.log("[FortiVault] 🔍 Step 1: Checking Google Safe Browsing via backend");
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


// ===============================
// LEXICAL PHISHING ANALYSIS
// ===============================
function checkPhishingLexical(url) {
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

  // Whitelist check
  if (isTrustedDomain(hostname)) {
    return { score: 0, reasons: ["✅ Trusted domain"] };
  }

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    score += 30;
    reasons.push("IP address used instead of domain name");
  }

  if (parsed.protocol !== "https:") {
    score += 20;
    reasons.push("Not using HTTPS");
  }

  const suspiciousTLDs = [".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".click", ".loan", ".work", ".date", ".racing", ".win", ".bid", ".stream", ".icu", ".buzz"];
  if (suspiciousTLDs.some(tld => hostname.endsWith(tld))) {
    score += 25;
    reasons.push("Suspicious TLD (Top Level Domain)");
  }

  const brands = [
    { name: "google", legit: ["google.com", "googleapis.com", "googleusercontent.com", "google.co"] },
    { name: "paypal", legit: ["paypal.com", "paypal.me"] },
    { name: "facebook", legit: ["facebook.com", "fb.com", "fb.me"] },
    { name: "microsoft", legit: ["microsoft.com", "live.com", "outlook.com", "office.com", "office365.com"] },
    { name: "apple", legit: ["apple.com", "icloud.com"] },
    { name: "amazon", legit: ["amazon.com", "amazon.co", "aws.amazon.com", "amzn.to", "amazonaws.com"] },
    { name: "netflix", legit: ["netflix.com"] },
    { name: "instagram", legit: ["instagram.com"] },
    { name: "twitter", legit: ["twitter.com", "x.com", "t.co"] },
    { name: "linkedin", legit: ["linkedin.com"] },
    { name: "dropbox", legit: ["dropbox.com"] },
    { name: "spotify", legit: ["spotify.com"] },
    { name: "discord", legit: ["discord.com", "discord.gg"] }
  ];

  for (const brand of brands) {
    if (hostname.includes(brand.name)) {
      const isLegit = brand.legit.some(legit =>
        hostname === legit || hostname.endsWith('.' + legit)
      );
      if (!isLegit) {
        score += 35;
        reasons.push(`Possible ${brand.name.charAt(0).toUpperCase() + brand.name.slice(1)} impersonation`);
        break;
      }
    }
  }

  const typosquatPatterns = [
    { pattern: /g[0o]{2}gle|go+gle|googl[e3]/i, brand: "Google" },
    { pattern: /faceb[0o]{2}k|facebo+k|facebok/i, brand: "Facebook" },
    { pattern: /pay[p]?a[l1]|paypa[l1]|paypai/i, brand: "PayPal" },
    { pattern: /amaz[0o]n|amazo+n|arnazon/i, brand: "Amazon" },
    { pattern: /micr[0o]s[0o]ft|rnicrosoft/i, brand: "Microsoft" },
    { pattern: /app[l1]e|appie/i, brand: "Apple" },
    { pattern: /netf[l1]ix|netfiix/i, brand: "Netflix" }
  ];

  for (const typo of typosquatPatterns) {
    if (typo.pattern.test(hostname)) {
      score += 40;
      reasons.push(`Typosquatting detected (fake ${typo.brand})`);
      break;
    }
  }

  const subdomainCount = hostname.split('.').length - 2;
  if (subdomainCount > 3) {
    score += 15;
    reasons.push(`Too many subdomains (${subdomainCount + 2} levels)`);
  }

  if (fullUrl.includes('@')) {
    score += 25;
    reasons.push("@ symbol in URL (potential redirect trick)");
  }

  if (/%[0-9a-f]{2}/i.test(hostname)) {
    score += 20;
    reasons.push("Encoded characters in hostname");
  }

  if (hostname.length > 40) {
    score += 10;
    reasons.push("Unusually long hostname");
  }

  const hyphenCount = (hostname.match(/-/g) || []).length;
  if (hyphenCount > 3) {
    score += 10;
    reasons.push(`Too many hyphens in hostname (${hyphenCount})`);
  }

  if (/\d{4,}/.test(hostname)) {
    score += 10;
    reasons.push("Suspicious number pattern in hostname");
  }

  const suspiciousPathKeywords = ["login", "signin", "verify", "secure", "account", "update", "confirm", "banking", "password"];
  if (suspiciousPathKeywords.some(keyword => path.includes(keyword))) {
    score += 10;
    reasons.push("Suspicious keywords in URL path");
  }

  return { score: Math.min(score, 100), reasons };
}

// ===============================
// COMBINED PHISHING CHECK (Safe Browsing FIRST, then Lexical)
// ===============================
async function checkPhishing(url) {
  const googleResult = await checkGoogleSafeBrowsing(url);
  const lexicalResult = checkPhishingLexical(url);

  let finalScore = lexicalResult.score;
  const allReasons = [...lexicalResult.reasons];

  if (googleResult.flagged) {
    finalScore += 50;
    allReasons.unshift("🚨 Flagged by Google Safe Browsing");
  }

  finalScore = Math.min(finalScore, 100);

  return { score: finalScore, reasons: allReasons, googleFlagged: googleResult.flagged };
}

// ===============================
// PHISHING WARNING POPUP
// ===============================
function showPhishingWarning(url, score, reasons = []) {
  const existing = document.getElementById('fortivault-phishing-warning');
  if (existing) existing.remove();

  const reasonsList = reasons.length > 0 
    ? `<ul style="text-align: left; margin: 16px 0; padding-left: 20px; color: #fbd38d; font-size: 14px;">
        ${reasons.filter(r => r !== "Trusted domain" && r !== "✅ Trusted domain").map(r => `<li style="margin: 6px 0;">⚠️ ${r}</li>`).join('')}
       </ul>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'fortivault-phishing-warning';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    ">
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 2px solid #f56565;
        border-radius: 16px;
        padding: 32px;
        max-width: 500px;
        text-align: center;
        box-shadow: 0 20px 60px rgba(245, 101, 101, 0.3);
        animation: shake 0.5s ease-in-out;
      ">
        <style>
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
            20%, 40%, 60%, 80% { transform: translateX(5px); }
          }
        </style>
        <div style="font-size: 64px; margin-bottom: 16px;">🚨</div>
        <h1 style="color: #f56565; margin: 0 0 16px 0; font-size: 28px;">Phishing Warning!</h1>
        <p style="color: #e2e8f0; font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
          FortiVault detected this website as potentially dangerous.
        </p>
        <p style="color: #a0aec0; font-size: 14px; margin-bottom: 16px;">
          Risk Score: <span style="color: #f56565; font-weight: bold;">${score}/100</span>
        </p>
        ${reasonsList}
        <p style="color: #a0aec0; font-size: 13px; word-break: break-all; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; margin: 16px 0;">
          ${url}
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
          <button id="fortivault-go-back" style="
            background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
            color: white;
            border: none;
            padding: 14px 32px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          ">← Go Back to Safety</button>
          <button id="fortivault-proceed" style="
            background: transparent;
            color: #a0aec0;
            border: 1px solid #4a5568;
            padding: 14px 24px;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
          ">Proceed Anyway</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  document.getElementById('fortivault-go-back').addEventListener('click', () => {
    window.history.back();
    setTimeout(() => {
      if (document.getElementById('fortivault-phishing-warning')) {
        window.location.href = 'about:blank';
      }
    }, 100);
  });
  
  document.getElementById('fortivault-proceed').addEventListener('click', () => {
    overlay.remove();
  });
}

// ===============================
// MAIN: Check current page on load
// ===============================
(async () => {
  const url = window.location.href;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  const result = await checkPhishing(url);
  if (result.score >= 40) {
    showPhishingWarning(url, result.score, result.reasons);
  }
})();

// ===============================
// AUTOFILL HANDLER
// ===============================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AUTOFILL') {
    const { username, password } = msg.payload;
    
    const usernameFields = document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"], input[autocomplete="username"]');
    const usernameField = usernameFields[0];
    const passwordField = document.querySelector('input[type="password"]');
    
    if (usernameField && username) {
      usernameField.value = username;
      usernameField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    if (passwordField && password) {
      passwordField.value = password;
      passwordField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    sendResponse({ success: true });
  }
});

// ===============================
// FORM DETECTION (for saving credentials)
// ===============================
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  
  const passwordField = form.querySelector('input[type="password"]');
  if (!passwordField || !passwordField.value) return;
  
  const usernameFields = form.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"]');
  const usernameField = usernameFields[0];
  
  if (usernameField && usernameField.value) {
    const credentials = {
      site: window.location.hostname,
      url: window.location.href,
      username: usernameField.value,
      password: passwordField.value
    };
    
    await chrome.storage.local.set({ lastDetectedCredentials: credentials });
    chrome.runtime.sendMessage({ type: 'DETECTED_CREDENTIALS', payload: credentials });
  }
});