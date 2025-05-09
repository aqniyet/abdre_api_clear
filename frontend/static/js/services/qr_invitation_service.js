/**
 * ABDRE Chat - QR Invitation Service
 * 
 * Handles QR code generation and invitation tracking for the chat application.
 * Provides countdown timer, status polling, and invitation lifecycle management.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Services = window.ABDRE.Services || {};

/**
 * QR Invitation Service
 */
ABDRE.Services.QRInvitation = (function() {
    'use strict';
    
    // Private variables
    let _currentInvitation = null;
    let _countdownInterval = null;
    let _statusPollingInterval = null;
    let _qrCode = null;
    let _pollingEnabled = false;
    let _modal = null;
    let _callbacks = {};
    
    // Constants
    const POLLING_INTERVAL = 5000; // 5 seconds
    const QR_API_ENDPOINT = '/api/chats/qrcode/';
    const INVITATION_API_ENDPOINT = '/api/chats/invitation-status/';
    const STATUS = {
        CREATED: 'created',
        SCANNED: 'scanned',
        ACCEPTED: 'accepted',
        EXPIRED: 'expired',
        CANCELLED: 'cancelled'
    };
    
    // Helper function to format time
    function _formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    // Start countdown timer
    function _startCountdown(expiresInSeconds, elementId) {
        // Clear any existing interval
        if (_countdownInterval) {
            clearInterval(_countdownInterval);
        }
        
        const countdownElement = document.getElementById(elementId);
        if (!countdownElement) return;
        
        let remainingSeconds = expiresInSeconds;
        
        // Update immediately
        countdownElement.textContent = _formatTime(remainingSeconds);
        
        // Set up interval
        _countdownInterval = setInterval(() => {
            remainingSeconds--;
            
            if (remainingSeconds <= 0) {
                clearInterval(_countdownInterval);
                _handleExpiration();
                return;
            }
            
            countdownElement.textContent = _formatTime(remainingSeconds);
            
            // Update status indicator color
            if (remainingSeconds < 60) { // Less than a minute
                const statusIndicator = document.getElementById('qr-status-indicator');
                if (statusIndicator) {
                    statusIndicator.classList.remove('status-active');
                    statusIndicator.classList.add('status-warning');
                }
            }
        }, 1000);
    }
    
    // Start status polling
    function _startStatusPolling(token) {
        // Clear any existing interval
        if (_statusPollingInterval) {
            clearInterval(_statusPollingInterval);
        }
        
        if (!_pollingEnabled) return;
        
        // Initial check
        _checkInvitationStatus(token);
        
        // Set up interval
        _statusPollingInterval = setInterval(() => {
            _checkInvitationStatus(token);
        }, POLLING_INTERVAL);
    }
    
    // Check invitation status
    function _checkInvitationStatus(token) {
        if (!token) return;
        
        fetch(`${INVITATION_API_ENDPOINT}${token}?mark_scanned=true`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to get invitation status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                _updateInvitationStatus(data);
            })
            .catch(error => {
                console.error('Error checking invitation status:', error);
            });
    }
    
    // Update invitation status display
    function _updateInvitationStatus(statusData) {
        if (!statusData) return;
        
        // Update status dots
        const scannedDot = document.getElementById('status-scanned');
        const acceptedDot = document.getElementById('status-accepted');
        
        if (scannedDot && statusData.scanned) {
            scannedDot.classList.add('active');
        }
        
        if (acceptedDot && statusData.status === STATUS.ACCEPTED) {
            acceptedDot.classList.add('active');
            
            // Trigger accepted callback
            if (_callbacks.onAccepted) {
                _callbacks.onAccepted(statusData);
            }
            
            // Stop polling
            _stopPolling();
        }
        
        // Check if expired
        if (statusData.is_expired || statusData.status === STATUS.EXPIRED) {
            _handleExpiration();
        }
        
        // Update _currentInvitation
        _currentInvitation = statusData;
    }
    
    // Handle invitation expiration
    function _handleExpiration() {
        // Update UI
        const qrCode = document.getElementById('qr-code');
        const qrExpired = document.getElementById('qr-expired');
        const statusIndicator = document.getElementById('qr-status-indicator');
        const statusText = document.getElementById('qr-status-text');
        
        if (qrCode) qrCode.style.display = 'none';
        if (qrExpired) qrExpired.style.display = 'block';
        
        if (statusIndicator) {
            statusIndicator.classList.remove('status-active', 'status-warning');
            statusIndicator.classList.add('status-expired');
        }
        
        if (statusText) {
            statusText.textContent = 'Expired';
        }
        
        // Stop polling
        _stopPolling();
        
        // Trigger expired callback
        if (_callbacks.onExpired) {
            _callbacks.onExpired(_currentInvitation);
        }
        
        _currentInvitation = null;
    }
    
    // Stop all polling and intervals
    function _stopPolling() {
        if (_countdownInterval) {
            clearInterval(_countdownInterval);
            _countdownInterval = null;
        }
        
        if (_statusPollingInterval) {
            clearInterval(_statusPollingInterval);
            _statusPollingInterval = null;
        }
        
        _pollingEnabled = false;
    }
    
    // Initialize modal and UI elements
    function _initModal() {
        _modal = document.getElementById('qr-invite-modal');
        if (!_modal) return;
        
        // Close button
        const closeBtn = document.getElementById('qr-invite-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                _hideModal();
            });
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('qr-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                _cancelInvitation();
            });
        }
        
        // Refresh button
        const refreshBtn = document.getElementById('qr-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                _refreshInvitation();
            });
        }
        
        // Generate new QR code button
        const newQrBtn = document.getElementById('qr-generate-new');
        if (newQrBtn) {
            newQrBtn.addEventListener('click', () => {
                _generateNewInvitation();
            });
        }
        
        // Retry button
        const retryBtn = document.getElementById('qr-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                _refreshInvitation();
            });
        }
        
        // Copy buttons
        const copyTokenBtn = document.getElementById('qr-copy-token');
        if (copyTokenBtn) {
            copyTokenBtn.addEventListener('click', () => {
                _copyToClipboard('qr-invitation-token');
            });
        }
        
        const copyUrlBtn = document.getElementById('qr-copy-url');
        if (copyUrlBtn) {
            copyUrlBtn.addEventListener('click', () => {
                _copyToClipboard('qr-invitation-url');
            });
        }
    }
    
    // Copy text to clipboard
    function _copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        element.select();
        document.execCommand('copy');
        
        // Show feedback (could be improved with a tooltip)
        element.classList.add('copied');
        setTimeout(() => {
            element.classList.remove('copied');
        }, 1000);
    }
    
    // Cancel invitation
    function _cancelInvitation() {
        if (!_currentInvitation) return;
        
        // In a real implementation, you would call an API to cancel the invitation
        // For this demo, we'll just clear the UI and stop polling
        
        _stopPolling();
        _hideModal();
        
        // Trigger cancelled callback
        if (_callbacks.onCancelled) {
            _callbacks.onCancelled(_currentInvitation);
        }
        
        _currentInvitation = null;
    }
    
    // Refresh invitation
    function _refreshInvitation() {
        if (!_currentInvitation) return;
        
        // Reset UI
        _resetUI();
        
        // Fetch QR code again
        _fetchQRCode(_currentInvitation.token);
    }
    
    // Generate new invitation
    function _generateNewInvitation() {
        // Reset UI
        _resetUI();
        
        // Generate new invitation
        _generateInvitation();
    }
    
    // Generate invitation via API
    function _generateInvitation() {
        const qrLoading = document.getElementById('qr-loading');
        const qrError = document.getElementById('qr-error');
        
        if (qrLoading) qrLoading.style.display = 'block';
        if (qrError) qrError.style.display = 'none';
        
        fetch('/api/chats/generate-invitation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                for_qr: true,
                expiration_minutes: 15
            })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to generate invitation: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                _currentInvitation = data;
                
                // Fetch QR code
                _fetchQRCode(data.token);
                
                // Start polling for status updates
                _pollingEnabled = true;
                _startStatusPolling(data.token);
            })
            .catch(error => {
                console.error('Error generating invitation:', error);
                
                if (qrLoading) qrLoading.style.display = 'none';
                if (qrError) qrError.style.display = 'block';
                
                // Trigger error callback
                if (_callbacks.onError) {
                    _callbacks.onError({
                        phase: 'generation',
                        error: error.message
                    });
                }
            });
    }
    
    // Fetch QR code from API
    function _fetchQRCode(token) {
        if (!token) return;
        
        const qrLoading = document.getElementById('qr-loading');
        const qrCode = document.getElementById('qr-code');
        const qrError = document.getElementById('qr-error');
        const qrExpired = document.getElementById('qr-expired');
        
        // Show loading
        if (qrLoading) qrLoading.style.display = 'block';
        if (qrCode) qrCode.style.display = 'none';
        if (qrError) qrError.style.display = 'none';
        if (qrExpired) qrExpired.style.display = 'none';
        
        fetch(`${QR_API_ENDPOINT}${token}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to generate QR code: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Hide loading
                if (qrLoading) qrLoading.style.display = 'none';
                
                // Show QR code
                if (qrCode) {
                    qrCode.style.display = 'block';
                    qrCode.innerHTML = `<img src="${data.qr_image}" alt="QR Code">`;
                }
                
                // Update invitation info
                const tokenInput = document.getElementById('qr-invitation-token');
                const urlInput = document.getElementById('qr-invitation-url');
                
                if (tokenInput) tokenInput.value = data.token;
                if (urlInput) urlInput.value = data.invitation_url;
                
                // Start countdown
                if (_currentInvitation && _currentInvitation.expires_in_seconds) {
                    _startCountdown(_currentInvitation.expires_in_seconds, 'qr-countdown');
                }
                
                // Trigger success callback
                if (_callbacks.onGenerated) {
                    _callbacks.onGenerated(data);
                }
            })
            .catch(error => {
                console.error('Error fetching QR code:', error);
                
                // Hide loading
                if (qrLoading) qrLoading.style.display = 'none';
                
                // Show error
                if (qrError) qrError.style.display = 'block';
                
                // Trigger error callback
                if (_callbacks.onError) {
                    _callbacks.onError({
                        phase: 'qrcode',
                        error: error.message
                    });
                }
            });
    }
    
    // Reset UI elements
    function _resetUI() {
        const qrLoading = document.getElementById('qr-loading');
        const qrCode = document.getElementById('qr-code');
        const qrError = document.getElementById('qr-error');
        const qrExpired = document.getElementById('qr-expired');
        const statusIndicator = document.getElementById('qr-status-indicator');
        const statusText = document.getElementById('qr-status-text');
        const scannedDot = document.getElementById('status-scanned');
        const acceptedDot = document.getElementById('status-accepted');
        
        if (qrLoading) qrLoading.style.display = 'block';
        if (qrCode) qrCode.style.display = 'none';
        if (qrError) qrError.style.display = 'none';
        if (qrExpired) qrExpired.style.display = 'none';
        
        if (statusIndicator) {
            statusIndicator.classList.remove('status-warning', 'status-expired');
            statusIndicator.classList.add('status-active');
        }
        
        if (statusText) {
            statusText.textContent = 'Active';
        }
        
        if (scannedDot) scannedDot.classList.remove('active');
        if (acceptedDot) acceptedDot.classList.remove('active');
        
        // Reset countdown display
        const countdownElement = document.getElementById('qr-countdown');
        if (countdownElement) countdownElement.textContent = '15:00';
    }
    
    // Show modal
    function _showModal() {
        if (!_modal) return;
        
        _modal.style.display = 'flex';
        document.body.classList.add('modal-open');
    }
    
    // Hide modal
    function _hideModal() {
        if (!_modal) return;
        
        _modal.style.display = 'none';
        document.body.classList.remove('modal-open');
        
        // Stop polling
        _stopPolling();
    }
    
    // Public API
    return {
        /**
         * Initialize the QR invitation service
         * @param {Object} options - Configuration options
         * @returns {Object} - The service instance
         */
        init: function(options = {}) {
            // Initialize callbacks
            _callbacks = {
                onGenerated: options.onGenerated,
                onScanned: options.onScanned,
                onAccepted: options.onAccepted,
                onExpired: options.onExpired,
                onCancelled: options.onCancelled,
                onError: options.onError
            };
            
            // Initialize modal and UI
            _initModal();
            
            return this;
        },
        
        /**
         * Show QR invitation modal and generate a new invitation
         * @returns {Object} - The service instance
         */
        showQRInvitation: function() {
            _resetUI();
            _showModal();
            _generateInvitation();
            
            return this;
        },
        
        /**
         * Cancel current invitation and close modal
         * @returns {Object} - The service instance
         */
        cancelInvitation: function() {
            _cancelInvitation();
            
            return this;
        },
        
        /**
         * Get current invitation data
         * @returns {Object|null} - Current invitation data or null
         */
        getCurrentInvitation: function() {
            return _currentInvitation;
        }
    };
})(); 