/**
 * Password Strength Enhancer for ABDRE Chat
 * Provides visual indication of password strength
 */

// Make sure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

/**
 * Password Strength Enhancer
 * Evaluates password strength and provides visual feedback
 */
ABDRE.Enhancers.PasswordStrength = (function() {
    'use strict';

    // DOM Elements
    let passwordInput;
    let confirmPasswordInput;
    let strengthMeter;
    let strengthText;

    // Strength thresholds
    const STRENGTH = {
        WEAK: 0,
        FAIR: 40,
        GOOD: 80,
        STRONG: 100
    };

    /**
     * Initialize enhancer
     */
    function init() {
        // Find elements
        passwordInput = document.getElementById('password');
        confirmPasswordInput = document.getElementById('confirm-password');
        strengthMeter = document.getElementById('strength-meter-fill');
        strengthText = document.getElementById('strength-text');
        
        // Only proceed if we're on a page with password strength meter
        if (!passwordInput || !strengthMeter) {
            return;
        }
        
        // Attach event listeners
        attachEventListeners();
        
        console.log('Password strength enhancer initialized');
    }

    /**
     * Attach event listeners
     */
    function attachEventListeners() {
        // Update strength when password changes
        passwordInput.addEventListener('input', updateStrength);
        
        // Check match when confirm password changes
        if (confirmPasswordInput) {
            confirmPasswordInput.addEventListener('input', checkPasswordMatch);
        }
    }

    /**
     * Update password strength meter
     */
    function updateStrength() {
        const password = passwordInput.value;
        const score = calculatePasswordStrength(password);
        
        // Update visual meter
        strengthMeter.style.width = `${score}%`;
        
        // Update color class
        strengthMeter.className = 'strength-meter-fill';
        if (score >= STRENGTH.STRONG) {
            strengthMeter.classList.add('strong');
            strengthText.textContent = 'Strong password';
        } else if (score >= STRENGTH.GOOD) {
            strengthMeter.classList.add('good');
            strengthText.textContent = 'Good password';
        } else if (score >= STRENGTH.FAIR) {
            strengthMeter.classList.add('fair');
            strengthText.textContent = 'Fair password';
        } else {
            strengthMeter.classList.add('weak');
            strengthText.textContent = 'Weak password';
        }
        
        // If confirm password is filled, check match
        if (confirmPasswordInput && confirmPasswordInput.value) {
            checkPasswordMatch();
        }
    }

    /**
     * Calculate password strength score (0-100)
     * @param {string} password - Password to evaluate
     * @return {number} - Score between 0 and 100
     */
    function calculatePasswordStrength(password) {
        if (!password) {
            return 0;
        }
        
        let score = 0;
        
        // Length contribution (up to 30 points)
        score += Math.min(30, password.length * 3);
        
        // Character variety contribution
        if (/[A-Z]/.test(password)) score += 10; // Uppercase
        if (/[a-z]/.test(password)) score += 10; // Lowercase
        if (/[0-9]/.test(password)) score += 10; // Numbers
        if (/[^A-Za-z0-9]/.test(password)) score += 15; // Special characters
        
        // Complexity patterns (up to 25 points)
        if (/(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])/.test(password)) score += 15;
        if (/(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/.test(password)) score += 10;
        
        return Math.min(100, score);
    }

    /**
     * Check if passwords match
     */
    function checkPasswordMatch() {
        if (!confirmPasswordInput) return;
        
        const password = passwordInput.value;
        const confirm = confirmPasswordInput.value;
        
        if (confirm && password !== confirm) {
            confirmPasswordInput.classList.add('error');
            confirmPasswordInput.setCustomValidity('Passwords do not match');
        } else {
            confirmPasswordInput.classList.remove('error');
            confirmPasswordInput.setCustomValidity('');
        }
    }

    // Public API
    return {
        init: init
    };

})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    ABDRE.Enhancers.PasswordStrength.init();
}); 