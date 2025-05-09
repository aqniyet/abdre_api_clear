/**
 * ABDRE Chat - Invitation Service
 * 
 * Handles generating and accepting chat invitations.
 * Provides QR code generation and invitation link management.
 */

// Ensure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};

// Invitation Service Module
ABDRE.InvitationService = (function() {
    // Constants
    const EVENTS = {
        INVITATION_CREATED: 'invitation:created',
        INVITATION_ACCEPTED: 'invitation:accepted',
        INVITATION_ERROR: 'invitation:error'
    };
    
    // Private variables
    let _baseUrl = '';
    let _apiEndpoint = '/api/invitations';
    
    // Private methods
    function _generateQRCode(invitationUrl, container, options = {}) {
        // Check if QRCode library is available
        if (typeof QRCode === 'undefined') {
            console.error('QRCode library not available');
            container.innerHTML = '<div class="error-message">QR Code generation failed</div>';
            return null;
        }
        
        // Clear container first
        container.innerHTML = '';
        
        // Generate QR code
        const qrOptions = {
            text: invitationUrl,
            width: options.width || 200,
            height: options.height || 200,
            colorDark: options.colorDark || '#000000',
            colorLight: options.colorLight || '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        };
        
        return new QRCode(container, qrOptions);
    }
    
    // Public API
    return {
        init: function(options = {}) {
            _baseUrl = options.baseUrl || window.location.origin;
            
            if (options.apiEndpoint) {
                _apiEndpoint = options.apiEndpoint;
            }
            
            // Load QR code library if not already loaded
            if (typeof QRCode === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
                script.async = true;
                document.head.appendChild(script);
            }
            
            console.log('Invitation service initialized');
            
            return this;
        },
        
        /**
         * Generate an invitation for a chat
         * 
         * @param {string} chatId - The ID of the chat to invite to
         * @param {object} options - Invitation options
         * @returns {Promise} - Resolves with invitation data
         */
        generateInvitation: function(chatId, options = {}) {
            if (!chatId) {
                return Promise.reject(new Error('Chat ID is required'));
            }
            
            const requestData = {
                chat_id: chatId,
                expiration: options.expiration || '7d', // Default 7 days
                max_uses: options.maxUses || 0, // 0 means unlimited
                note: options.note || ''
            };
            
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiService) {
                    reject(new Error('API Service not available'));
                    return;
                }
                
                ABDRE.ApiService.post(_apiEndpoint, requestData)
                    .then(response => {
                        // Publish event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish(EVENTS.INVITATION_CREATED, response);
                        }
                        
                        resolve(response);
                    })
                    .catch(error => {
                        console.error('Error generating invitation:', error);
                        
                        // Publish error event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish(EVENTS.INVITATION_ERROR, {
                                code: 'generation_failed',
                                message: error.message || 'Failed to generate invitation',
                                details: error
                            });
                        }
                        
                        reject(error);
                    });
            });
        },
        
        /**
         * Get the invitation URL for sharing
         * 
         * @param {string} invitationCode - The invitation code
         * @returns {string} - The full invitation URL
         */
        getInvitationUrl: function(invitationCode) {
            return `${_baseUrl}/invite/${invitationCode}`;
        },
        
        /**
         * Generate a QR code for an invitation
         * 
         * @param {string} invitationCode - The invitation code
         * @param {HTMLElement} container - The container element for the QR code
         * @param {object} options - QR code options
         * @returns {object} - The QR code instance
         */
        generateQRCode: function(invitationCode, container, options = {}) {
            if (!invitationCode) {
                console.error('Invitation code is required');
                return null;
            }
            
            if (!container) {
                console.error('Container element is required');
                return null;
            }
            
            const invitationUrl = this.getInvitationUrl(invitationCode);
            return _generateQRCode(invitationUrl, container, options);
        },
        
        /**
         * Accept an invitation to join a chat
         * 
         * @param {string} invitationCode - The invitation code
         * @returns {Promise} - Resolves with the chat data
         */
        acceptInvitation: function(invitationCode) {
            if (!invitationCode) {
                return Promise.reject(new Error('Invitation code is required'));
            }
            
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiService) {
                    reject(new Error('API Service not available'));
                    return;
                }
                
                ABDRE.ApiService.post(`${_apiEndpoint}/${invitationCode}/accept`)
                    .then(response => {
                        // Publish event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish(EVENTS.INVITATION_ACCEPTED, response);
                        }
                        
                        resolve(response);
                    })
                    .catch(error => {
                        console.error('Error accepting invitation:', error);
                        
                        // Publish error event
                        if (ABDRE.EventBus) {
                            ABDRE.EventBus.publish(EVENTS.INVITATION_ERROR, {
                                code: 'accept_failed',
                                message: error.message || 'Failed to accept invitation',
                                details: error
                            });
                        }
                        
                        reject(error);
                    });
            });
        },
        
        /**
         * Get information about an invitation
         * 
         * @param {string} invitationCode - The invitation code
         * @returns {Promise} - Resolves with the invitation data
         */
        getInvitationInfo: function(invitationCode) {
            if (!invitationCode) {
                return Promise.reject(new Error('Invitation code is required'));
            }
            
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiService) {
                    reject(new Error('API Service not available'));
                    return;
                }
                
                ABDRE.ApiService.get(`${_apiEndpoint}/${invitationCode}`)
                    .then(response => {
                        resolve(response);
                    })
                    .catch(error => {
                        console.error('Error getting invitation info:', error);
                        reject(error);
                    });
            });
        },
        
        /**
         * Revoke an invitation
         * 
         * @param {string} invitationCode - The invitation code
         * @returns {Promise} - Resolves when invitation is revoked
         */
        revokeInvitation: function(invitationCode) {
            if (!invitationCode) {
                return Promise.reject(new Error('Invitation code is required'));
            }
            
            return new Promise((resolve, reject) => {
                if (!ABDRE.ApiService) {
                    reject(new Error('API Service not available'));
                    return;
                }
                
                ABDRE.ApiService.delete(`${_apiEndpoint}/${invitationCode}`)
                    .then(response => {
                        resolve(response);
                    })
                    .catch(error => {
                        console.error('Error revoking invitation:', error);
                        reject(error);
                    });
            });
        },
        
        /**
         * Copy invitation link to clipboard
         * 
         * @param {string} invitationCode - The invitation code
         * @returns {Promise} - Resolves when copied
         */
        copyInvitationLink: function(invitationCode) {
            const invitationUrl = this.getInvitationUrl(invitationCode);
            
            return new Promise((resolve, reject) => {
                // Use clipboard API if available
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(invitationUrl)
                        .then(() => resolve(true))
                        .catch(error => {
                            console.error('Failed to copy:', error);
                            reject(error);
                        });
                } else {
                    // Fallback for browsers without clipboard API
                    try {
                        const textArea = document.createElement('textarea');
                        textArea.value = invitationUrl;
                        
                        // Make the textarea out of viewport
                        textArea.style.position = 'fixed';
                        textArea.style.left = '-999999px';
                        textArea.style.top = '-999999px';
                        document.body.appendChild(textArea);
                        
                        textArea.focus();
                        textArea.select();
                        
                        const success = document.execCommand('copy');
                        document.body.removeChild(textArea);
                        
                        if (success) {
                            resolve(true);
                        } else {
                            reject(new Error('Failed to copy using execCommand'));
                        }
                    } catch (error) {
                        console.error('Failed to copy:', error);
                        reject(error);
                    }
                }
            });
        },
        
        // Expose events
        EVENTS: EVENTS
    };
})(); 