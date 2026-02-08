export async function checkPhishing(url) {
  let score = 0;
  console.log(`[FortiVault] Checking URL: ${url}`);

  // ---- Google Safe Browsing ----
  const blacklisted = await checkGoogleSafeBrowsing(url);
  if (blacklisted) {
    score += 40;
    console.log('[FortiVault] ⚠️ URL flagged by Google Safe Browsing: +40 points');
  }

  // ---- Lexical Features ----
  if (url.length > 75) score += 10;
  if (containsIPAddress(url)) score += 15;
  if (countSpecialChars(url) > 5) score += 10;
  if (!url.startsWith("https")) score += 10;
  if (hasSuspiciousKeyword(url)) score += 10;
  if (countSubdomains(url) > 3) score += 5;

  console.log(`[FortiVault] 🔒 Final Risk Score for ${url}: ${score}/100`);
  return Math.min(score, 100);
}

function containsIPAddress(url) {
  return /\d+\.\d+\.\d+\.\d+/.test(url);
}

function countSpecialChars(url) {
  return (url.match(/[@?=%]/g) || []).length;
}

function hasSuspiciousKeyword(url) {
  const words = ["login","verify","update","secure","account","bank"];
  return words.some(w => url.toLowerCase().includes(w));
}

function countSubdomains(url) {
  try {
    const host = new URL(url).hostname;
    return host.split(".").length - 2;
  } catch {
    return 0;
  }
}

async function checkGoogleSafeBrowsing(url) {
  // USE THE SAME API KEY AS YOUR BACKEND
  const API_KEY = "AIzaSyD26EeE5gdCS4H14TlkxPNzJ435kmxGrnk"; // <-- Replace this!
  
  console.log("[FortiVault] ════════════════════════════════════════════════════");
  console.log("[FortiVault] 🔍 Step 1: Checking Google Safe Browsing");
  console.log("[FortiVault] URL being checked:", url);
  console.log("[FortiVault] API Key (first 10 chars):", API_KEY.substring(0, 10) + "...");
  
  try {
    const requestBody = {
      client: {
        clientId: "fortivault-app",
        clientVersion: "1.0.0"
      },
      threatInfo: {
        threatTypes: [
          "MALWARE",
          "SOCIAL_ENGINEERING",
          "UNWANTED_SOFTWARE",
          "POTENTIALLY_HARMFUL_APPLICATION"
        ],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }]
      }
    };

    console.log("[FortiVault] Sending request...");

    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }
    );

    console.log("[FortiVault] Response status:", res.status);

    const data = await res.json();
    console.log("[FortiVault] Full API response:", JSON.stringify(data, null, 2));

    if (data.error) {
      console.error("[FortiVault] ❌ API returned error:", data.error);
      return { flagged: false, threats: [], error: data.error.message };
    }

    if (data.matches && data.matches.length > 0) {
      console.log("[FortiVault] 🚨🚨🚨 THREAT DETECTED! 🚨🚨🚨");
      return { flagged: true, threats: data.matches };
    }
    
    console.log("[FortiVault] ✅ URL is clean (no matches)");
    return { flagged: false, threats: [] };
    
  } catch (err) {
    console.error("[FortiVault] ⚠️ Fetch error:", err);
    return { flagged: false, threats: [], error: err.message };
  }
}
