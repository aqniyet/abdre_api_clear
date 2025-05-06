/**
 * Chat Invitation Manager
 * Handles creating, tracking, and managing QR code invitations
 */

const InvitationManager = {
    // Configuration
    config: {
        checkInterval: 5000, // Check invitation status every 5 seconds
        countdownInterval: 1000, // Update countdown every 1 second
        apiBase: '/api',
        generateEndpoint: '/api/chats/generate-invitation',
        statusEndpoint: '/api/chats/invitation-status',
        cleanupEndpoint: '/api/chats/cleanup-expired-invitations'
    },

    // Active invitation token
    activeInvitation: null,

    // Timer references
    statusCheckTimer: null,
    countdownTimer: null,

    // Socket connection for real-time updates
    socket: null,

    /**
     * Initialize the invitation manager with a socket connection
     * 
     * @param {Object} socket - Socket.IO connection object
     */
    init: function(socket = null) {
        this.socket = socket;
        this.setupSocketListeners();
        console.log('InvitationManager initialized');
        
        // Always use the API gateway endpoints regardless of environment
        // The previous code was changing endpoints for localhost, causing 404 errors
    },

    /**
     * Set up socket event listeners
     */
    setupSocketListeners: function() {
        if (!this.socket) return;

        // Listen for invitation status updates
        this.socket.on('invitation_status', data => {
            if (data.invitation_token === this.activeInvitation) {
                this.handleStatusUpdate(data);
            }
        });

        // Listen for QR scan notifications
        this.socket.on('qr_scanned_notification', data => {
            if (data.invitation_token === this.activeInvitation) {
                this.handleQrScanned(data);
            }
        });

        // Listen for invitation accepted notifications
        this.socket.on('invitation_accepted', data => {
            if (data.invitation_token === this.activeInvitation) {
                this.handleInvitationAccepted(data);
            }
        });
    },

    /**
     * Generate a new chat invitation
     * 
     * @returns {Promise<Object>} - The invitation data
     */
    generateInvitation: async function() {
        try {
            // Cancel any existing invitation
            await this.cancelActiveInvitation();

            if (!window.AuthHelper) {
                console.warn("Authentication helper not available, proceeding as guest");
            }

            // Get user ID from auth helper
            let userId;
            try {
                if (window.AuthHelper) {
                    const userData = AuthHelper.getUserData();
                    userId = userData ? userData.user_id : null;
                    
                    // If no user ID found, use visitor ID or generate one
                    if (!userId) {
                        userId = AuthHelper.getVisitorId();
                        
                        // If still no ID, try to create a visitor ID
                        if (!userId) {
                            try {
                                const visitorData = await AuthHelper.getOrCreateVisitorId();
                                userId = visitorData.visitor_id;
                            } catch (error) {
                                console.error("Failed to create visitor ID:", error);
                                userId = `guest-${Date.now()}`;
                            }
                        }
                    }
                } else {
                    userId = `guest-${Date.now()}`;
                }
            } catch (error) {
                console.error("Error getting user ID:", error);
                userId = `guest-${Date.now()}`;
            }

            if (!userId) {
                userId = `guest-${Date.now()}`;
                console.warn("Using generated guest ID:", userId);
            }

            // Check if endpoint is available
            if (!this.config.generateEndpoint) {
                throw new Error("Invitation generation endpoint not configured");
            }

            console.log("Generating invitation with user ID:", userId);
            console.log("Using endpoint:", this.config.generateEndpoint);

            // Always ensure Content-Type header is set properly
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add auth headers if available
            if (window.AuthHelper) {
                const authHeaders = AuthHelper.getAuthHeaders();
                Object.keys(authHeaders).forEach(key => {
                    headers[key] = authHeaders[key];
                });
            }

            // Generate a new invitation
            const response = await fetch(this.config.generateEndpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ host_id: userId })
            });

            if (!response.ok) {
                let errorMessage = `Server error (${response.status})`;
                
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
                    // If we can't parse JSON, try to get text
                    try {
                        errorMessage = await response.text() || errorMessage;
                    } catch (e2) {
                        // If all else fails, use status text
                        errorMessage = response.statusText || errorMessage;
                    }
                }
                
                throw new Error(errorMessage);
            }

            const invitationData = await response.json();
            
            if (!invitationData || !invitationData.invitation_token) {
                throw new Error("Invalid invitation data received from server");
            }
            
            console.log("Invitation generated successfully:", invitationData.invitation_token);
            this.activeInvitation = invitationData.invitation_token;

            // Notify through socket if available
            if (this.socket && this.socket.connected) {
                this.socket.emit('invitation_created', {
                    invitation_token: this.activeInvitation
                });
            }

            // Start status checking and countdown
            this.startStatusChecking();
            this.startCountdown(invitationData.expiry_seconds);

            return invitationData;
        } catch (error) {
            console.error('Error generating invitation:', error);
            
            // Set more specific error message for display
            const errorMessage = error.message || 'Could not generate invitation';
            
            // Dispatch error event
            const errorEvent = new CustomEvent('invitationGenerationError', {
                detail: { error: errorMessage }
            });
            document.dispatchEvent(errorEvent);
            
            throw error;
        }
    },

    /**
     * Start checking invitation status periodically
     */
    startStatusChecking: function() {
        // Clear any existing timer
        this.stopStatusChecking();

        // Start new timer
        if (this.activeInvitation) {
            this.statusCheckTimer = setInterval(() => {
                this.checkInvitationStatus();
            }, this.config.checkInterval);

            // Also check immediately
            this.checkInvitationStatus();
        }
    },

    /**
     * Stop checking invitation status
     */
    stopStatusChecking: function() {
        if (this.statusCheckTimer) {
            clearInterval(this.statusCheckTimer);
            this.statusCheckTimer = null;
        }
    },

    /**
     * Check the current invitation status
     */
    checkInvitationStatus: async function() {
        if (!this.activeInvitation) return;

        try {
            // Check via socket if available
            if (this.socket && this.socket.connected) {
                this.socket.emit('check_invitation_status', {
                    invitation_token: this.activeInvitation
                });
                return;
            }

            // Always ensure Content-Type header is set properly
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add auth headers if available
            if (window.AuthHelper) {
                const authHeaders = AuthHelper.getAuthHeaders();
                Object.keys(authHeaders).forEach(key => {
                    headers[key] = authHeaders[key];
                });
            }

            // Otherwise use HTTP API
            const response = await fetch(`${this.config.statusEndpoint}/${this.activeInvitation}`, {
                headers: headers
            });

            if (!response.ok) {
                // If 404, the invitation is no longer valid
                if (response.status === 404) {
                    this.handleInvitationInvalidated();
                    return;
                }

                const errorData = await response.json();
                console.error('Error checking invitation status:', errorData.error);
                return;
            }

            const statusData = await response.json();
            this.handleStatusUpdate(statusData);
        } catch (error) {
            console.error('Error checking invitation status:', error);
        }
    },

    /**
     * Handle invitation status update
     */
    handleStatusUpdate: function(data) {
        // Trigger events based on status
        const status = data.status || 'unknown';
        
        // Get countdown element and update it
        const countdownEl = document.getElementById('invitation-countdown');
        if (countdownEl && data.seconds_remaining) {
            countdownEl.textContent = this.formatTime(data.seconds_remaining);
        }

        // Update visual status indicator
        const statusEl = document.getElementById('invitation-status');
        if (statusEl) {
            let statusText = 'Active';
            let statusClass = 'text-success';
            
            if (status === 'expired') {
                statusText = 'Expired';
                statusClass = 'text-danger';
                this.handleInvitationExpired();
            } else if (status === 'used') {
                statusText = 'Used';
                statusClass = 'text-primary';
                this.handleInvitationAccepted(data);
            }
            
            statusEl.textContent = statusText;
            statusEl.className = `badge ${statusClass}`;
        }

        // Dispatch a custom event with the status
        const event = new CustomEvent('invitationStatusChanged', { 
            detail: { 
                token: this.activeInvitation,
                status: status,
                data: data
            } 
        });
        document.dispatchEvent(event);
    },

    /**
     * Start the invitation countdown timer
     */
    startCountdown: function(seconds) {
        // Clear any existing timer
        this.stopCountdown();

        // Initialize remaining time
        let remainingSeconds = seconds || 1800; // Default to 30 minutes

        // Update countdown every second
        this.countdownTimer = setInterval(() => {
            remainingSeconds--;
            
            // Update countdown display
            const countdownEl = document.getElementById('invitation-countdown');
            if (countdownEl) {
                countdownEl.textContent = this.formatTime(remainingSeconds);
            }

            // Check if expired
            if (remainingSeconds <= 0) {
                this.stopCountdown();
                this.handleInvitationExpired();
            }
        }, this.config.countdownInterval);

        // Immediately update display
        const countdownEl = document.getElementById('invitation-countdown');
        if (countdownEl) {
            countdownEl.textContent = this.formatTime(remainingSeconds);
        }
    },

    /**
     * Stop the countdown timer
     */
    stopCountdown: function() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
    },

    /**
     * Format seconds into mm:ss time string
     */
    formatTime: function(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * Cancel the active invitation
     */
    cancelActiveInvitation: async function() {
        if (!this.activeInvitation) return;

        try {
            // Stop all timers
            this.stopStatusChecking();
            this.stopCountdown();

            // Cancel via socket if available
            if (this.socket && this.socket.connected) {
                this.socket.emit('cancel_invitation', {
                    invitation_token: this.activeInvitation
                });
            }

            // Always ensure Content-Type header is set properly
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add auth headers if available
            if (window.AuthHelper) {
                const authHeaders = AuthHelper.getAuthHeaders();
                Object.keys(authHeaders).forEach(key => {
                    headers[key] = authHeaders[key];
                });
            }

            // Also call cleanup API for certainty
            await fetch(this.config.cleanupEndpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ tokens: [this.activeInvitation] })
            });

            const token = this.activeInvitation;
            this.activeInvitation = null;

            // Dispatch canceled event
            const event = new CustomEvent('invitationCanceled', { 
                detail: { token } 
            });
            document.dispatchEvent(event);

        } catch (error) {
            console.error('Error canceling invitation:', error);
        }
    },

    /**
     * Handle when the invitation has been scanned
     */
    handleQrScanned: function(data) {
        console.log('QR code scanned:', data);
        
        // Update UI to show scan
        const scanStatusEl = document.getElementById('scan-status');
        if (scanStatusEl) {
            scanStatusEl.textContent = 'QR code scanned! Waiting for acceptance...';
            scanStatusEl.className = 'alert alert-info';
            scanStatusEl.style.display = 'block';
        }

        // Dispatch QR scanned event
        const event = new CustomEvent('qrCodeScanned', { 
            detail: { 
                token: this.activeInvitation,
                scanner: data.scanner_id
            } 
        });
        document.dispatchEvent(event);
    },

    /**
     * Handle when the invitation has been accepted
     */
    handleInvitationAccepted: function(data) {
        console.log('Invitation accepted:', data);
        
        // Stop all timers
        this.stopStatusChecking();
        this.stopCountdown();

        // Update UI to show acceptance
        const scanStatusEl = document.getElementById('scan-status');
        if (scanStatusEl) {
            scanStatusEl.textContent = 'Invitation accepted! Redirecting to chat...';
            scanStatusEl.className = 'alert alert-success';
            scanStatusEl.style.display = 'block';
        }

        // Dispatch acceptance event
        const event = new CustomEvent('invitationAccepted', { 
            detail: { 
                token: this.activeInvitation,
                chatId: data.chat_id
            } 
        });
        document.dispatchEvent(event);

        // Redirect to the chat room if chat_id is available
        if (data.chat_id) {
            setTimeout(() => {
                window.location.href = `/chat/${data.chat_id}`;
            }, 2000); // Small delay for user to see success message
        }
    },

    /**
     * Handle when the invitation has expired
     */
    handleInvitationExpired: function() {
        console.log('Invitation expired');
        
        // Stop all timers
        this.stopStatusChecking();
        this.stopCountdown();

        // Update UI to show expiration
        const scanStatusEl = document.getElementById('scan-status');
        if (scanStatusEl) {
            scanStatusEl.textContent = 'Invitation expired. Please generate a new QR code.';
            scanStatusEl.className = 'alert alert-danger';
            scanStatusEl.style.display = 'block';
        }

        // Update QR code display
        const qrCodeEl = document.getElementById('qr-code');
        if (qrCodeEl) {
            // Create expired overlay
            const overlay = document.createElement('div');
            overlay.className = 'expired-overlay';
            overlay.innerHTML = '<span>EXPIRED</span>';
            qrCodeEl.appendChild(overlay);
        }

        // Dispatch expired event
        const event = new CustomEvent('invitationExpired', { 
            detail: { token: this.activeInvitation } 
        });
        document.dispatchEvent(event);

        this.activeInvitation = null;
    },

    /**
     * Handle when the invitation has been invalidated (deleted or non-existent)
     */
    handleInvitationInvalidated: function() {
        console.log('Invitation invalidated');
        
        // Stop all timers
        this.stopStatusChecking();
        this.stopCountdown();

        // Update UI to show invalidation
        const scanStatusEl = document.getElementById('scan-status');
        if (scanStatusEl) {
            scanStatusEl.textContent = 'Invitation is no longer valid. Please generate a new QR code.';
            scanStatusEl.className = 'alert alert-warning';
            scanStatusEl.style.display = 'block';
        }

        // Dispatch invalidated event
        const event = new CustomEvent('invitationInvalidated', { 
            detail: { token: this.activeInvitation } 
        });
        document.dispatchEvent(event);

        this.activeInvitation = null;
    }
};

// Export for use in other modules
window.InvitationManager = InvitationManager; 