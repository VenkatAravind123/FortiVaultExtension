// Enhanced form detection and auto-fill trigger
class FormDetector {
  constructor() {
    this.observedForms = new Set();
    this.init();
  }
  
  init() {
    // Check existing forms on page load
    this.checkPageForForms();
    
    // Observe for new forms
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.checkElementForForms(node);
            }
          });
        }
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  checkPageForForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => this.processForm(form));
  }
  
  checkElementForForms(element) {
    if (element.tagName === 'FORM') {
      this.processForm(element);
    }
    
    const forms = element.querySelectorAll('form');
    forms.forEach(form => this.processForm(form));
  }
  
  processForm(form) {
    const formId = form.id || form.className || Math.random().toString();
    
    if (this.observedForms.has(formId)) {
      return;
    }
    
    this.observedForms.add(formId);
    
    // Check if this is a login form
    if (this.isLoginForm(form)) {
      // Check if we should auto-fill
      this.checkForAutoFill(form);
      
      // Set up auto-save
      this.setupAutoSave(form);
    }
  }
  
  isLoginForm(form) {
    const passwordFields = form.querySelectorAll('input[type="password"]');
    return passwordFields.length > 0;
  }
  
  async checkForAutoFill(form) {
    const currentUrl = window.location.href;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'checkAutoFill',
        url: currentUrl
      });
      
      if (response.shouldAutoFill && response.credentials) {
        // Wait a bit for page to fully load
        setTimeout(() => {
          this.performAutoFill(form, response.credentials);
        }, 500);
      }
    } catch (error) {
      console.error('Auto-fill check failed:', error);
    }
  }
  
  performAutoFill(form, credentials) {
    const usernameFields = form.querySelectorAll(
      'input[type="email"], input[type="text"][name*="user"], input[name*="email"], input[autocomplete="username"]'
    );
    const passwordFields = form.querySelectorAll('input[type="password"]');
    
    if (usernameFields.length > 0 && credentials.username) {
      usernameFields[0].value = credentials.username;
      usernameFields[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    if (passwordFields.length > 0 && credentials.password) {
      passwordFields[0].value = credentials.password;
      passwordFields[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  
  setupAutoSave(form) {
    const originalSubmit = form.submit;
    
    form.submit = () => {
      this.handleFormSubmit(form);
      originalSubmit.call(form);
    };
    
    form.addEventListener('submit', (e) => {
      this.handleFormSubmit(form);
    });
  }
  
  async handleFormSubmit(form) {
    const formData = this.extractFormData(form);
    
    if (formData && formData.password) {
      try {
        await chrome.runtime.sendMessage({
          action: 'autoSavePassword',
          data: formData
        });
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }
  }
  
  extractFormData(form) {
    const url = window.location.href;
    let username = '';
    let password = '';
    
    const inputs = form.querySelectorAll('input');
    inputs.forEach(input => {
      const type = input.type.toLowerCase();
      const name = (input.name + input.id + input.placeholder).toLowerCase();
      const value = input.value;
      
      if (type === 'password' && value) {
        password = value;
      } else if ((type === 'email' || type === 'text') && value) {
        if (name.includes('user') || name.includes('email') || name.includes('login') || 
            name.includes('mail') || input.getAttribute('autocomplete') === 'username') {
          username = value;
        }
      }
    });
    
    if (username && password) {
      return { url, username, password };
    }
    
    return null;
  }
}

// Initialize form detector when content script loads
new FormDetector();