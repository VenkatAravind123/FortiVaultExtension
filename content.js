// content.js - improved detection & autofill

function isVisibleInput(el) {
  if (!el) return false;
  // exclude hidden inputs explicitly
  if (el.type && el.type.toLowerCase() === 'hidden') return false;
  // exclude disabled/readOnly (optional)
  if (el.disabled) return false;
  // check rendered size / in-document visibility
  const rects = el.getClientRects();
  if (!rects || rects.length === 0) return false;
  // also ensure element isn't aria-hidden/hidden attribute
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

// prefer candidate ranking: explicit name/id matches > placeholder/label > visible text/email input
function findBestUsernameInput(form) {
  const inputs = Array.from(form.querySelectorAll('input'));
  // strong name/id patterns:
  const priorityPatterns = [/username/i, /\buser\b/i, /login/i, /email/i, /mail/i];

  // 1) find visible inputs whose name/id matching priority patterns
  for (const pat of priorityPatterns) {
    const match = inputs.find(i => isVisibleInput(i) && ((i.name && pat.test(i.name)) || (i.id && pat.test(i.id))));
    if (match) return match;
  }

  // 2) find visible input with type=email or type=text and non-empty placeholder suggesting username
  const emailOrText = inputs.filter(i => isVisibleInput(i) && (/^(text|email)$/i.test(i.type || 'text')));
  const byPlaceholder = emailOrText.find(i => i.placeholder && /user|email|login/i.test(i.placeholder));
  if (byPlaceholder) return byPlaceholder;

  // 3) fallback: first visible text/email input
  if (emailOrText.length) return emailOrText[0];

  // 4) fallback: first visible input (unlikely)
  return inputs.find(i => isVisibleInput(i)) || null;
}

function findPasswordInput(form) {
  const pwd = form.querySelector('input[type="password"]');
  if (pwd && isVisibleInput(pwd)) return pwd;
  // fallback: any visible input with name containing pass
  return Array.from(form.querySelectorAll('input')).find(i => isVisibleInput(i) && /pass/i.test(i.name || i.id || '')) || null;
}

function detectLoginForm() {
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    // attach submit listener once
    if (form.dataset.secpassDetectAttached === '1') return;
    form.dataset.secpassDetectAttached = '1';

    form.addEventListener('submit', (e) => {
      try {
        const usernameField = findBestUsernameInput(form);
        const passwordField = findPasswordInput(form);

        if (usernameField && passwordField) {
          const credentials = {
            site: location.hostname,
            url: location.href,
            username: usernameField.value,
            password: passwordField.value
          };
          // do NOT console.log real credentials in production
          chrome.runtime.sendMessage({ type: 'DETECTED_CREDENTIALS', payload: credentials });
        }
      } catch (err) {
        console.error('detectLoginForm error', err);
      }
    }, true); // use capture to try to catch before page navigation
  });
}

// Autofill handler (message listener already present in your script)
// Update the selector to pick visible fields in the page before filling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AUTOFILL") {
    const { username, password } = message.payload;

    // find best username & password fields on the active page
    let usernameField = document.querySelector("input[type='email'], input[type='text'], input[name*='user'], input[id*='user'], input[name*='login'], input[id*='login']");
    // prefer visible one
    if (!isVisibleInput(usernameField)) {
      const candidates = Array.from(document.querySelectorAll("input[type='email'], input[type='text'], input[name], input[id]"))
        .filter(isVisibleInput);
      // prefer name/id matching
      usernameField = candidates.find(i => /user|email|login/i.test(i.name || i.id || i.placeholder)) || candidates[0];
    }

    let passField = document.querySelector("input[type='password']");
    if (!isVisibleInput(passField)) {
      passField = Array.from(document.querySelectorAll("input[type='password']")).find(isVisibleInput);
    }

    if (usernameField && passField) {
      usernameField.focus();
      usernameField.value = username + "";
      passField.focus();
      passField.value = password + "";
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No visible login fields found" });
    }
  }
});

// initial run
detectLoginForm();

// Re-run detection when DOM changes (some sites render forms dynamically)
const mo = new MutationObserver(() => detectLoginForm());
mo.observe(document, { childList: true, subtree: true });
