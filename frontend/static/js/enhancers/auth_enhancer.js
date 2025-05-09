/**
 * Authentication Enhancer for ABDRE Chat
 * Handles form submissions for login and registration
 */

// Make sure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

/**
 * Auth Enhancer
 * Handles authentication form submissions and related functionality
 */
ABDRE.Enhancers.Auth = (function() {
    'use strict';

    // DOM Elements
    let loginForm;
    let registerForm;
    let passwordToggleBtns;

    /**
     * Initialize enhancer
     */
    function init() {
        // Find forms
        loginForm = document.getElementById('login-form');
        registerForm = document.getElementById('register-form');
        
        // Setup password visibility toggles
        passwordToggleBtns = document.querySelectorAll('.password-toggle-btn');
        
        // Attach event listeners
        attachEventListeners();
        
        console.log('Auth enhancer initialized');
    }

    /**
     * Attach event listeners to forms and buttons
     */
    function attachEventListeners() {
        // Login form
        if (loginForm) {
            loginForm.addEventListener('submit', handleLoginSubmit);
        }
        
        // Register form
        if (registerForm) {
            registerForm.addEventListener('submit', handleRegisterSubmit);
        }
        
        // Password toggle buttons
        if (passwordToggleBtns.length > 0) {
            passwordToggleBtns.forEach(btn => {
                btn.addEventListener('click', togglePasswordVisibility);
            });
        }
    }

    /**
     * Handle login form submission
     * @param {Event} e - Submit event
     */
    function handleLoginSubmit(e) {
        e.preventDefault();
        
        // Get form data
        const formData = new FormData(loginForm);
        
        // Convert to JSON object
        const jsonData = {};
        formData.forEach((value, key) => {
            if (key === 'remember') {
                jsonData[key] = value === 'on';
            } else {
                jsonData[key] = value;
            }
        });
        
        // Get redirect URL from form
        const redirectTo = formData.get('redirect_to') || '/my-chats';
        
        // Submit form data as JSON
        fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(jsonData),
            credentials: 'same-origin'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = redirectTo;
            } else {
                showError(data.error || 'Login failed. Please check your credentials.');
            }
        })
        .catch(error => {
            console.error('Login error:', error);
            showError('An error occurred during login. Please try again.');
        });
    }

    /**
     * Handle register form submission
     * @param {Event} e - Submit event
     */
    function handleRegisterSubmit(e) {
        e.preventDefault();
        
        // Get form data
        const formData = new FormData(registerForm);
        
        // Convert to JSON object
        const jsonData = {};
        formData.forEach((value, key) => {
            if (key === 'terms') {
                jsonData[key] = value === 'on';
            } else {
                jsonData[key] = value;
            }
        });
        
        // Validate password match
        if (jsonData.password !== jsonData.confirm_password) {
            showError('Passwords do not match.');
            return;
        }
        
        // Get redirect URL from form
        const redirectTo = formData.get('redirect_to') || '/my-chats';
        
        // Submit form data as JSON
        fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(jsonData),
            credentials: 'same-origin'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = redirectTo;
            } else {
                showError(data.error || 'Registration failed. Please try again.');
            }
        })
        .catch(error => {
            console.error('Registration error:', error);
            showError('An error occurred during registration. Please try again.');
        });
    }

    /**
     * Toggle password field visibility
     * @param {Event} e - Click event
     */
    function togglePasswordVisibility(e) {
        const btn = e.currentTarget;
        const wrapper = btn.closest('.password-input-wrapper');
        const input = wrapper.querySelector('input');
        
        if (input.type === 'password') {
            input.type = 'text';
            btn.setAttribute('aria-label', 'Hide password');
            btn.classList.add('show-password');
        } else {
            input.type = 'password';
            btn.setAttribute('aria-label', 'Show password');
            btn.classList.remove('show-password');
        }
    }

    /**
     * Show error message in the form
     * @param {string} message - Error message to display
     */
    function showError(message) {
        // Check for existing error element
        let errorElement = document.querySelector('.alert.alert-error');
        
        // Create new error element if it doesn't exist
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'alert alert-error';
            
            // Insert at the top of the form
            const form = loginForm || registerForm;
            form.insertAdjacentElement('afterbegin', errorElement);
        }
        
        // Set error message
        errorElement.textContent = message;
        
        // Ensure it's visible
        errorElement.style.display = 'block';
    }

    // Public API
    return {
        init: init
    };

})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    ABDRE.Enhancers.Auth.init();
}); 