/**
 * ABDRE Chat - Settings
 * 
 * Handles user settings management
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Settings Module
ABDRE.Settings = (function() {
    // Cache DOM elements
    const profileForm = document.getElementById('profile-form');
    const displayNameInput = document.getElementById('display-name');
    const bioInput = document.getElementById('bio');
    const emailNotificationsToggle = document.getElementById('email-notifications');
    const pushNotificationsToggle = document.getElementById('push-notifications');
    const soundNotificationsToggle = document.getElementById('sound-notifications');
    const showOnlineStatusToggle = document.getElementById('show-online-status');
    const showReadReceiptsToggle = document.getElementById('show-read-receipts');
    const saveProfileBtn = document.getElementById('save-profile');
    const cancelProfileBtn = document.getElementById('cancel-profile');
    const clearHistoryBtn = document.getElementById('clear-history');
    const deleteAccountBtn = document.getElementById('delete-account');
    const successMessage = document.getElementById('success-message');
    const errorMessage = document.getElementById('error-message');
    
    // Private variables
    let _originalProfile = null;
    
    // Private methods
    function _showSuccess(message) {
        successMessage.textContent = message;
        successMessage.style.display = 'block';
        errorMessage.style.display = 'none';
        
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 5000);
    }
    
    function _showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        successMessage.style.display = 'none';
        
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }
    
    // Public API
    return {
        /**
         * Initialize the settings module
         * 
         * @returns {object} - This module for chaining
         */
        init: function() {
            console.log('Settings module initialized');
            
            // Load user profile
            this.loadUserProfile();
            
            // Attach event listeners
            this.attachEventListeners();
            
            return this;
        },
        
        /**
         * Load the user's profile data from API
         */
        loadUserProfile: function() {
            if (ABDRE.UserService && ABDRE.UserService.isInitialized) {
                ABDRE.UserService.getCurrentProfile()
                    .then(profile => {
                        console.log('User profile loaded:', profile);
                        
                        // Store original profile for cancellation
                        _originalProfile = profile;
                        
                        // Populate form with existing data
                        displayNameInput.value = profile.display_name || '';
                        bioInput.value = profile.bio || '';
                        
                        // Load notification settings if available
                        if (profile.settings) {
                            if (profile.settings.notifications) {
                                const notifications = profile.settings.notifications;
                                emailNotificationsToggle.checked = notifications.email || false;
                                pushNotificationsToggle.checked = notifications.push || true;
                            }
                            
                            if (profile.settings.privacy) {
                                const privacy = profile.settings.privacy;
                                showOnlineStatusToggle.checked = privacy.show_online_status || true;
                                showReadReceiptsToggle.checked = privacy.show_read_receipts || true;
                            }
                        }
                    })
                    .catch(error => {
                        console.error('Error loading user profile:', error);
                        _showError('Failed to load profile. Please refresh the page.');
                    });
            } else {
                console.error('UserService is not available or not initialized');
                _showError('User service not available. Please refresh the page.');
            }
        },
        
        /**
         * Save profile changes
         */
        saveProfile: function() {
            const displayName = displayNameInput.value.trim();
            const bio = bioInput.value.trim();
            
            if (!displayName) {
                _showError('Display name is required.');
                return;
            }
            
            if (ABDRE.UserService && ABDRE.UserService.isInitialized) {
                // Show loading state
                saveProfileBtn.disabled = true;
                saveProfileBtn.textContent = 'Saving...';
                
                ABDRE.UserService.updateProfile({
                    display_name: displayName,
                    bio: bio
                })
                    .then(response => {
                        _showSuccess('Profile updated successfully!');
                        
                        // Store the updated profile
                        _originalProfile = response;
                        
                        // Update local storage user info
                        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
                        userInfo.display_name = displayName;
                        localStorage.setItem('user_info', JSON.stringify(userInfo));
                        
                        // Update the user profile cache in the chat application if it exists
                        if (window.userProfileCache && userInfo.id) {
                            window.userProfileCache[userInfo.id] = {
                                ...(window.userProfileCache[userInfo.id] || {}),
                                user_id: userInfo.id,
                                username: userInfo.username,
                                display_name: displayName
                            };
                            
                            // Dispatch a custom event for other components to detect the change
                            window.dispatchEvent(new CustomEvent('user_profile_updated', {
                                detail: { 
                                    userId: userInfo.id,
                                    display_name: displayName,
                                    bio: bio
                                }
                            }));
                        }
                    })
                    .catch(error => {
                        console.error('Error updating profile:', error);
                        _showError('Failed to update profile. Please try again.');
                    })
                    .finally(() => {
                        // Reset button state
                        saveProfileBtn.disabled = false;
                        saveProfileBtn.textContent = 'Save Changes';
                    });
            } else {
                _showError('User service not available. Please refresh the page.');
            }
        },
        
        /**
         * Cancel profile changes
         */
        cancelProfileChanges: function() {
            // Reset form to original values
            if (_originalProfile) {
                displayNameInput.value = _originalProfile.display_name || '';
                bioInput.value = _originalProfile.bio || '';
            } else {
                // If no original profile, clear form
                displayNameInput.value = '';
                bioInput.value = '';
            }
        },
        
        /**
         * Attach event listeners to DOM elements
         */
        attachEventListeners: function() {
            // Profile form submission
            if (profileForm) {
                profileForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveProfile();
                });
            }
            
            // Cancel button
            if (cancelProfileBtn) {
                cancelProfileBtn.addEventListener('click', () => {
                    this.cancelProfileChanges();
                });
            }
            
            // Clear history button
            if (clearHistoryBtn) {
                clearHistoryBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to clear your chat history? This action cannot be undone.')) {
                        // TODO: Implement clear history functionality when API is available
                        alert('This feature is not yet implemented.');
                    }
                });
            }
            
            // Delete account button
            if (deleteAccountBtn) {
                deleteAccountBtn.addEventListener('click', () => {
                    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                        // TODO: Implement account deletion when API is available
                        alert('This feature is not yet implemented.');
                    }
                });
            }
            
            // Notification settings changes
            const toggles = [
                emailNotificationsToggle,
                pushNotificationsToggle,
                soundNotificationsToggle,
                showOnlineStatusToggle,
                showReadReceiptsToggle
            ];
            
            toggles.forEach(toggle => {
                if (toggle) {
                    toggle.addEventListener('change', () => {
                        // TODO: Save setting changes when API is available
                        console.log(`Setting ${toggle.id} changed to ${toggle.checked}`);
                    });
                }
            });
        }
    };
})();

// Initialize the settings module when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
        // No token found, redirect to login page
        window.location.href = 'login.html';
        return;
    }
    
    // Initialize API client
    if (ABDRE.ApiClient) {
        ABDRE.ApiClient.init({ 
            baseUrl: window.location.hostname === 'localhost' ? 'http://localhost:5000' : '',
            token: authToken
        });
    }
    
    // Initialize services
    if (ABDRE.AuthService && !ABDRE.AuthService.isInitialized) {
        ABDRE.AuthService.init(ABDRE.ApiClient);
    }
    if (ABDRE.UserService && !ABDRE.UserService.isInitialized) {
        ABDRE.UserService.init(ABDRE.ApiClient);
    }
    
    // Initialize settings module
    ABDRE.Settings.init();
}); 