class AuthService {
  static async login(email, password) {
    try {
      const response = await fetch('https://your-backend.com/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        throw new Error('Invalid credentials');
      }

      const data = await response.json();
      await chrome.storage.local.set({
        token: data.token,
        userEmail: email
      });
      
      return data;
    } catch (error) {
      throw error;
    }
  }

  static async logout() {
    await chrome.storage.local.remove(['token', 'userEmail']);
  }

  static async isAuthenticated() {
    const result = await chrome.storage.local.get(['token']);
    return !!result.token;
  }

  static async getToken() {
    const result = await chrome.storage.local.get(['token']);
    return result.token;
  }
}