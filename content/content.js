// content.js - Auto-save and auto-fill logic

const API_BASE = 'https://your-backend-api.com';

// Helper: Get JWT from storage



// Detect login form and auto-save
function detectAndSave() {
  const inputs = Array.from(document.querySelectorAll('input'));
  const emailFields = inputs.filter(input =>
    input.type === 'email' ||
    /email|user|login/i.test(input.name) ||
    /email|user|login/i.test(input.placeholder)
  );
  const passwordFields = inputs.filter(input => input.type === 'password');

  if (emailFields.length === 0 || passwordFields.length === 0) return;

  const emailField = emailFields[0];
  const passwordField = passwordFields[0];

  // Prevent duplicate listeners
  if (passwordField.dataset.fortivaultHandled) return;
  passwordField.dataset.fortivaultHandled = 'true';

  passwordField.addEventListener('blur', async () => {
    const url = window.location.href;
    const username = emailField.value.trim();
    const password = passwordField.value;

    if (!username || !password) return;

    try {
      // 1. Check password breach via HIBP proxy
      const hibpRes = await fetch(`${API_BASE}/api/hibp/check?password=${encodeURIComponent(password)}`);
      if (!hibpRes.ok) throw new Error('HIBP check failed');
      const hibpData = await hibpRes.json();

      if (hibpData.count > 0) {
        alert(`⚠️ This password was found in ${hibpData.count} data breaches!\nPlease choose a stronger password.`);
        return;
      }

      // 2. Check URL safety via Safe Browsing proxy
      const safeRes = await fetch(`${API_BASE}/api/safe/check?url=${encodeURIComponent(url)}`);
      if (!safeRes.ok) throw new Error('Safe Browsing check failed');
      const safeData = await safeRes.json();

      if (safeData.phishing) {
        alert('🚨 Warning: This website may be a phishing site!\nCredential save blocked.');
        return;
      }

      // 3. Save to backen
      const saveRes = await fetch(`${API_BASE}/api/passwords/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url, username, password })
      });

      if (saveRes.ok) {
        console.log('🔐 Credential saved securely!');
      } else {
        console.error('Save failed:', await saveRes.text());
      }
    } catch (err) {
      console.error('Auto-save error:', err);
    }
  });
}

// Auto-fill credentials
// Auto-fill credentials using domain-based endpoint
async function autoFill() {
  const hostname = window.location.hostname; // e.g., "google.com"

  try {
    const res = await fetch(`https://your-backend-api.com/api/users/${hostname}/password`, {
      credentials: 'include' // ← Critical: sends cookies
    });

    if (!res.ok) {
      if (res.status === 404) {
        console.log('No saved login for this domain.');
      } else {
        console.warn('Auto-fill request failed:', res.status);
      }
      return;
    }

    const data = await res.json();

    if (data.success && data.password) {
      const { username, password } = data.password;

      // Find inputs
      const emailFields = Array.from(document.querySelectorAll('input')).filter(input =>
        input.type === 'email' ||
        /email|user|login/i.test(input.name) ||
        /email|user|login/i.test(input.placeholder)
      );
      const passwordFields = document.querySelectorAll('input[type="password"]');

      if (emailFields.length > 0 && passwordFields.length > 0) {
        emailFields[0].value = username;
        passwordFields[0].value = password;

        // Trigger input events for React/Vue
        emailFields[0].dispatchEvent(new Event('input', { bubbles: true }));
        passwordFields[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  } catch (err) {
    console.warn('Auto-fill error:', err.message);
  }
}
// Observe DOM changes (for SPAs like React/Angular)
const observer = new MutationObserver(() => {
  detectAndSave();
});

observer.observe(document.body, { childList: true, subtree: true });

// Run on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    detectAndSave();
    autoFill();
  }, 800);
});