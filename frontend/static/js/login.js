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
        
        // Immediate client-side validation before API call
        if (!username || username.trim() === '') {
            showLoginError('Username or email is required');
            return;
        }
        
        if (!password || password.length < 1) {
            showLoginError('Password is required');
            return;
        }
        
        // Check rate limiting
        if (!checkRateLimit()) {
            return;
        }
        
        try {
            loginError.classList.add('d-none');
            
            // Show loading state
            const originalBtnText = loginButton.textContent;
            loginButton.disabled = true;
            loginButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Signing in...';
            
            // Sanitize input
            const sanitizedUsername = sanitizeInput(username);
            
            // Create an AbortController for timeout handling
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
                        password,
                        remember_me: rememberMe
                    }),
                    credentials: 'include', // Include cookies
                    signal: controller.signal // Add abort signal for timeout
                });
                
                // Clear the timeout since the request completed
                clearTimeout(timeoutId);
                
                const data = await response.json();
                
                if (!response.ok) {
                    // Handle failed login
                    handleFailedAttempt();
                    throw new Error(data.message || data.error || 'Login failed. Please check your credentials.');
                }
                
                // Reset failed attempts counter on success
                failedAttempts.count = 0;
                
                // Store auth token
                if (window.AuthHelper && AuthHelper.saveAuth) {
                    AuthHelper.saveAuth(data);
                } else if (window.AuthHelper && AuthHelper.setToken) {
                    AuthHelper.setToken(data.token, rememberMe);
                }
                
                // Show success message
                showLoginError('Login successful! Redirecting...', true);
                
                // Redirect to chat with slight delay
                setTimeout(() => {
                    window.location.href = '/my-chats';
                }, 1000);
            } catch (fetchError) {
                // Handle abort/timeout specifically
                if (fetchError.name === 'AbortError') {
                    throw new Error('Login request timed out. Please try again.');
                }
                throw fetchError;
            }
            
        } catch (error) {
            console.error('Login error:', error);
            showLoginError(error.message || 'An unexpected error occurred. Please try again.');
        } finally {
            // Always restore button state
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
        
        // Validate inputs
        if (!username) {
            showRegisterError('Username is required');
            return;
        }
        
        if (!email || !email.includes('@')) {
            showRegisterError('A valid email address is required');
            return;
        }
        
        if (!password || password.length < 8) {
            showRegisterError('Password must be at least 8 characters long');
            return;
        }
        
        // Validate password match
        if (password !== confirmPassword) {
            showRegisterError('Passwords do not match');
            return;
        }
        
        try {
            registerError.classList.add('d-none');
            
            // Show loading state
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creating account...';
            
            // Sanitize inputs
            const sanitizedUsername = sanitizeInput(username);
            const sanitizedEmail = sanitizeInput(email);
            
            // Call the registration API
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    username: sanitizedUsername,
                    email: sanitizedEmail,
                    password
                }),
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || data.error || 'Registration failed. Please try again.');
            }
            
            // Store auth token if auto-login after registration
            if (data.token && window.AuthHelper) {
                if (AuthHelper.saveAuth) {
                    AuthHelper.saveAuth(data);
                } else if (AuthHelper.setToken) {
                    AuthHelper.setToken(data.token, true);
                }
                
                // Show success and redirect
                showRegisterError('Registration successful! Redirecting...');
                registerError.classList.remove('alert-danger');
                registerError.classList.add('alert-success');
                
                setTimeout(() => {
                    window.location.href = '/my-chats';
                }, 1500);
            } else {
                // Show success message and switch to login
                registerForm.reset();
                switchFormMode('login');
                showLoginError('Registration successful! Please sign in with your new account.', true);
            }
            
        } catch (error) {
            console.error('Registration error:', error);
            showRegisterError(error.message || 'An unexpected error occurred');
            
            // Reset button
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    });

    // OAuth login handlers
    googleLoginBtn.addEventListener('click', () => {
        // Redirect to Google OAuth endpoint
        window.location.href = '/api/auth/oauth/google';
    });
    
    appleLoginBtn.addEventListener('click', () => {
        // Redirect to Apple OAuth endpoint
        window.location.href = '/api/auth/oauth/apple';
    });
    
    // Guest access handler
    guestAccessBtn.addEventListener('click', async () => {
        try {
            // Show loading state
            const originalBtnText = guestAccessBtn.textContent;
            guestAccessBtn.disabled = true;
            guestAccessBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
            
            // Call the guest login API
            const response = await fetch('/api/auth/guest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || data.error || 'Guest access failed. Please try again.');
            }
            
            // Store guest token
            if (window.AuthHelper) {
                if (AuthHelper.saveAuth) {
                    AuthHelper.saveAuth(data);
                } else if (AuthHelper.setToken) {
                    AuthHelper.setToken(data.token, false);
                }
            }
            
            // Redirect to chat
            window.location.href = '/my-chats';
            
        } catch (error) {
            console.error('Guest access error:', error);
            showLoginError(error.message || 'Failed to access as guest. Please try again.');
            
            // Reset button
            guestAccessBtn.disabled = false;
            guestAccessBtn.textContent = originalBtnText;
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