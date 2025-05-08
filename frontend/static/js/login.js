/**
 * ABDRE Chat - Authentication Handling
 * Manages login, registration, and OAuth authentication
 */
document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');
    const formTitle = document.getElementById('form-title');
    const formSubtitle = document.getElementById('form-subtitle');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');
    const loginButton = document.getElementById('login-button');
    const googleLoginBtn = document.getElementById('google-login');
    const appleLoginBtn = document.getElementById('apple-login');
    const guestAccessBtn = document.getElementById('guest-access');
    const passwordToggles = document.querySelectorAll('.password-toggle');
    
    // CSRF Token
    let csrfToken = '';
    
    // Set up rate limiting for failed attempts
    const failedAttempts = {
        count: 0,
        lastAttempt: 0,
        lockoutUntil: 0
    };
    
    // Initialize
    function init() {
        console.log('Initializing login page...');
        
        // Generate CSRF token if not already present
        getCsrfToken();
        
        // Check if user is already authenticated
        if (window.AuthHelper && AuthHelper.isAuthenticated()) {
            // Redirect to My Chats if already logged in
            redirectIfAuthenticated();
        }
    }

    // Get or generate CSRF token
    function getCsrfToken() {
        if (window.AuthHelper && AuthHelper._getCsrfToken) {
            csrfToken = AuthHelper._getCsrfToken();
        } else {
            // Generate random token if AuthHelper not available
            csrfToken = generateRandomToken(32);
        }
        return csrfToken;
    }
    
    // Generate random token
    function generateRandomToken(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const randomValues = new Uint8Array(length);
        window.crypto.getRandomValues(randomValues);
        for (let i = 0; i < length; i++) {
            result += chars.charAt(randomValues[i] % chars.length);
        }
        return result;
    }

    // Toggle between login and register forms
    function switchFormMode(mode) {
        if (mode === 'login') {
            loginForm.classList.remove('d-none');
            registerForm.classList.add('d-none');
            loginTab.classList.add('active');
            registerTab.classList.remove('active');
            formTitle.textContent = 'Welcome Back';
            formSubtitle.textContent = 'Sign in to continue to ABDRE Chat';
        } else {
            loginForm.classList.add('d-none');
            registerForm.classList.remove('d-none');
            loginTab.classList.remove('active');
            registerTab.classList.add('active');
            formTitle.textContent = 'Create Account';
            formSubtitle.textContent = 'Sign up to start using ABDRE Chat';
        }
        // Clear any error messages
        loginError.classList.add('d-none');
        registerError.classList.add('d-none');
        loginError.classList.remove('alert-success');
        loginError.classList.add('alert-danger');
    }

    // Check URL for mode parameter
    function checkUrlForMode() {
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        if (mode === 'register') {
            switchFormMode('register');
        }
    }

    // Validate login form
    function validateLoginForm(username, password) {
        if (!username || username.trim() === '') {
            showLoginError('Username or email is required');
            return false;
        }
        
        if (!password || password.length < 1) {
            showLoginError('Password is required');
            return false;
        }
        
        return true;
    }
    
    // Show login error message
    function showLoginError(message, isSuccess = false) {
        loginError.textContent = message;
        loginError.classList.remove('d-none');
        
        if (isSuccess) {
            loginError.classList.remove('alert-danger');
            loginError.classList.add('alert-success');
        } else {
            loginError.classList.remove('alert-success');
            loginError.classList.add('alert-danger');
        }
    }
    
    // Show register error message
    function showRegisterError(message) {
        registerError.textContent = message;
        registerError.classList.remove('d-none');
    }
    
    // Check rate limiting
    function checkRateLimit() {
        const now = Date.now();
        
        // Reset failed attempts if it's been more than 15 minutes
        if (now - failedAttempts.lastAttempt > 15 * 60 * 1000) {
            failedAttempts.count = 0;
        }
        
        // Check if user is in lockout period
        if (failedAttempts.lockoutUntil > now) {
            const remainingSeconds = Math.ceil((failedAttempts.lockoutUntil - now) / 1000);
            showLoginError(`Too many failed attempts. Please try again in ${remainingSeconds} seconds.`);
            return false;
        }
        
        return true;
    }
    
    // Handle failed login attempt
    function handleFailedAttempt() {
        const now = Date.now();
        failedAttempts.count++;
        failedAttempts.lastAttempt = now;
        
        // Apply exponential backoff for lockouts
        if (failedAttempts.count >= 5) {
            // Starting with 30 seconds at 5 attempts, doubling each time
            const lockoutDuration = Math.min(30 * Math.pow(2, failedAttempts.count - 5), 30 * 60) * 1000;
            failedAttempts.lockoutUntil = now + lockoutDuration;
            
            const lockoutMinutes = Math.ceil(lockoutDuration / 60000);
            showLoginError(`Too many failed attempts. Account locked for ${lockoutMinutes} minute(s).`);
        }
    }
    
    // Redirect if already authenticated
    function redirectIfAuthenticated() {
        if (window.AuthHelper && AuthHelper.isAuthenticated()) {
            window.location.href = '/my-chats';
        }
    }

    // Initialize based on URL
    init();
    checkUrlForMode();

    // Tab event listeners
    loginTab.addEventListener('click', () => switchFormMode('login'));
    registerTab.addEventListener('click', () => switchFormMode('register'));

    // Toggle password visibility
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', function() {
            const passwordField = this.parentElement.querySelector('input');
            const icon = this.querySelector('i');
            
            if (passwordField.type === 'password') {
                passwordField.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                passwordField.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    });

    // Handle login form submission
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me').checked;
        
        // Immediate client-side validation
        if (!validateLoginForm(username, password)) {
            return;
        }
        
        // Check rate limiting
        if (!checkRateLimit()) {
            return;
        }
        
        // Get login button and save original text
        const loginButton = document.getElementById('login-button');
        const originalBtnText = loginButton.textContent;
        
        try {
            // Hide previous error message
            loginError.classList.add('d-none');
            
            // Show loading state
            loginButton.disabled = true;
            loginButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Signing in...';
            
            // Sanitize input
            const sanitizedUsername = sanitizeInput(username);
            
            if (window.ApiClient && ApiClient.login) {
                try {
                    // Use ApiClient for login
                    const loginResult = await ApiClient.login({
                        username: sanitizedUsername,
                        password: password,
                        remember: rememberMe
                    });
                    
                    console.log('Login successful');
                    
                    // Redirect to chat page
                    window.location.href = '/my-chats';
                } catch (error) {
                    console.error('Login error:', error);
                    
                    showLoginError(error.message || 'Login failed. Please check your credentials.');
                    handleFailedAttempt();
                }
            } else {
                // Fallback to direct API call if ApiClient is not available
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                try {
                    // Call the authentication API with timeout
                    const response = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': csrfToken
                        },
                        body: JSON.stringify({
                            username: sanitizedUsername,
                            password: password,
                            remember: rememberMe
                        }),
                        signal: controller.signal,
                        credentials: 'include' // Include cookies
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || `Login failed (${response.status})`);
                    }
                    
                    const data = await response.json();
                    
                    // Store auth data
                    if (window.AuthHelper) {
                        AuthHelper.saveAuth(data);
                    } else {
                        // Fallback storage if AuthHelper not available
                        localStorage.setItem('authToken', data.token);
                        localStorage.setItem('userData', JSON.stringify(data.user));
                    }
                    
                    // Redirect to dashboard
                    window.location.href = '/my-chats';
                } catch (error) {
                    clearTimeout(timeoutId);
                    
                    if (error.name === 'AbortError') {
                        showLoginError('Login request timed out. Please try again.');
                    } else {
                        showLoginError(error.message || 'Login failed. Please check your credentials.');
                        handleFailedAttempt();
                    }
                }
            }
        } finally {
            // Reset button state
            loginButton.disabled = false;
            loginButton.textContent = originalBtnText;
        }
    });

    // Handle register form submission
    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('register-username').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        
        // Validate form
        if (!username || username.length < 3 || username.length > 30) {
            showRegisterError('Username must be between 3 and 30 characters');
            return;
        }
        
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            showRegisterError('Please enter a valid email address');
            return;
        }
        
        if (!password || password.length < 8) {
            showRegisterError('Password must be at least 8 characters long');
            return;
        }
        
        if (password !== confirmPassword) {
            showRegisterError('Passwords do not match');
            return;
        }
        
        // Get register button and save original text
        const registerBtn = document.getElementById('register-submit-btn');
        const originalBtnText = registerBtn.textContent;
        
        try {
            registerError.classList.add('d-none');
            
            // Show loading state
            registerBtn.disabled = true;
            registerBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating account...';
            
            if (window.ApiClient && ApiClient.register) {
                try {
                    // Use ApiClient for registration
                    const registerResult = await ApiClient.register({
                        username: sanitizeInput(username),
                        email: sanitizeInput(email),
                        password: password
                    });
                    
                    console.log('Registration successful');
                    
                    // Switch to login form
                    switchFormMode('login');
                    
                    // Show success message in login form
                    showLoginError('Account created successfully! Please sign in.', true);
                } catch (error) {
                    console.error('Registration error:', error);
                    showRegisterError(error.message || 'Registration failed. Please try again.');
                }
            } else if (window.AuthHelper && AuthHelper.register) {
                // Fall back to AuthHelper register
                const registerResult = await AuthHelper.register({
                    username: sanitizeInput(username),
                    email: sanitizeInput(email),
                    password: password
                });
                
                if (registerResult.success) {
                    // Switch to login form
                    switchFormMode('login');
                    
                    // Show success message in login form
                    showLoginError('Account created successfully! Please sign in.', true);
                } else {
                    showRegisterError(registerResult.error || 'Registration failed. Please try again.');
                }
            } else {
                // Fallback to direct API call
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
                try {
                    const response = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': csrfToken
                        },
                        body: JSON.stringify({
                            username: sanitizeInput(username),
                            email: sanitizeInput(email),
                            password: password
                        }),
                        signal: controller.signal,
                        credentials: 'include'
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || `Registration failed (${response.status})`);
                    }
                    
                    // Switch to login form
                    switchFormMode('login');
                    
                    // Show success message in login form
                    showLoginError('Account created successfully! Please sign in.', true);
                } catch (error) {
                    clearTimeout(timeoutId);
                    
                    if (error.name === 'AbortError') {
                        showRegisterError('Registration request timed out. Please try again.');
                    } else {
                        showRegisterError(error.message || 'Registration failed. Please try again.');
                    }
                }
            }
        } finally {
            // Reset button state
            registerBtn.disabled = false;
            registerBtn.textContent = originalBtnText;
        }
    });

    // Google login handler
    googleLoginBtn.addEventListener('click', function() {
        if (window.ApiClient && ApiClient.oauth) {
            ApiClient.oauth.google()
                .then(() => {
                    window.location.href = '/my-chats';
                })
                .catch(error => {
                    console.error('Google login error:', error);
                    showLoginError('Google login failed. Please try again.');
                });
        } else if (window.AuthHelper && AuthHelper.oauthGoogle) {
            AuthHelper.oauthGoogle()
                .then(result => {
                    if (result.success) {
                        window.location.href = '/my-chats';
                    } else {
                        showLoginError(result.error || 'Google login failed. Please try again.');
                    }
                })
                .catch(error => {
                    console.error('Google login error:', error);
                    showLoginError('Google login failed. Please try again.');
                });
        } else {
            // Fallback to redirect
            window.location.href = '/api/auth/oauth/google';
        }
    });
    
    // Apple login handler
    appleLoginBtn.addEventListener('click', function() {
        if (window.ApiClient && ApiClient.oauth) {
            ApiClient.oauth.apple()
                .then(() => {
                    window.location.href = '/my-chats';
                })
                .catch(error => {
                    console.error('Apple login error:', error);
                    showLoginError('Apple login failed. Please try again.');
                });
        } else if (window.AuthHelper && AuthHelper.oauthApple) {
            AuthHelper.oauthApple()
                .then(result => {
                    if (result.success) {
                        window.location.href = '/my-chats';
                    } else {
                        showLoginError(result.error || 'Apple login failed. Please try again.');
                    }
                })
                .catch(error => {
                    console.error('Apple login error:', error);
                    showLoginError('Apple login failed. Please try again.');
                });
        } else {
            // Fallback to redirect
            window.location.href = '/api/auth/oauth/apple';
        }
    });
    
    // Handle guest access button
    guestAccessBtn.addEventListener('click', async function() {
        // Save original button text
        const originalText = this.textContent;
        
        try {
            // Show loading state
            this.disabled = true;
            this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Continuing...';
            
            if (window.ApiClient && ApiClient.loginAsGuest) {
                try {
                    // Use ApiClient for guest login
                    await ApiClient.loginAsGuest();
                    
                    // Redirect to chat
                    window.location.href = '/my-chats';
                } catch (error) {
                    console.error('Guest login error:', error);
                    showLoginError('Failed to continue as guest. Please try again.');
                }
            } else if (window.AuthHelper && AuthHelper.loginAsGuest) {
                // Use AuthHelper for guest login
                const result = await AuthHelper.loginAsGuest();
                
                if (result.success) {
                    window.location.href = '/my-chats';
                } else {
                    showLoginError(result.error || 'Failed to continue as guest. Please try again.');
                }
            } else {
                // Fallback to direct API call
                try {
                    const response = await fetch('/api/auth/visitor', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': csrfToken
                        },
                        credentials: 'include'
                    });
                    
                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Failed to continue as guest');
                    }
                    
                    const data = await response.json();
                    
                    // Store visitor token
                    if (window.AuthHelper) {
                        AuthHelper.saveAuth(data);
                    } else {
                        // Fallback storage
                        localStorage.setItem('visitorId', data.visitor_id);
                        localStorage.setItem('authToken', data.token);
                    }
                    
                    // Redirect to chat
                    window.location.href = '/my-chats';
                } catch (error) {
                    console.error('Guest login error:', error);
                    showLoginError('Failed to continue as guest. Please try again.');
                }
            }
        } finally {
            // Reset button state
            this.disabled = false;
            this.textContent = originalText;
        }
    });
    
    // Sanitize input to prevent XSS
    function sanitizeInput(input) {
        if (!input) return '';
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    // Check for messages in URL params
    function checkForMessages() {
        const urlParams = new URLSearchParams(window.location.search);
        const message = urlParams.get('message');
        const error = urlParams.get('error');
        
        if (error) {
            showLoginError(decodeURIComponent(error));
        }
        
        if (message) {
            showLoginError(decodeURIComponent(message), true);
        }
    }
    
    // Check for URL messages
    checkForMessages();
}); 