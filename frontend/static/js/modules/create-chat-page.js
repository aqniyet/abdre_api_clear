/**
 * Create Chat Page
 * Handles QR code generation and invitation management
 */

document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization to ensure all dependencies are loaded first
    setTimeout(() => {
        initCreateChatPage();
    }, 500);
    
    function initCreateChatPage() {
        // Initialize variables
        let activeInvitationToken = null;
        let invitationListener = null;
        
        // Initialize UI elements
        const generateNewBtn = document.getElementById('generate-new-btn');
        const backBtn = document.getElementById('back-btn');
        const copyLinkBtn = document.getElementById('copy-link-btn');
        const invitationLinkInput = document.getElementById('invitation-link');
        const copyStatusText = document.getElementById('copy-status');
        
        // Set up button event listeners
        generateNewBtn.addEventListener('click', generateNewInvitation);
        backBtn.addEventListener('click', () => window.location.href = '/my-chats');
        copyLinkBtn.addEventListener('click', copyInvitationLink);
        
        // Listen for invitation events
        document.addEventListener('invitationStatusChanged', handleStatusChange);
        document.addEventListener('qrCodeScanned', handleQrScanned);
        document.addEventListener('invitationAccepted', handleInvitationAccepted);
        document.addEventListener('invitationExpired', handleInvitationExpired);
        document.addEventListener('invitationCanceled', handleInvitationCanceled);
        
        // Generate initial invitation
        generateNewInvitation();
        
        /**
         * Generate a new chat invitation
         */
        async function generateNewInvitation() {
            try {
                // Update UI to loading state
                const qrCodeEl = document.getElementById('qr-code');
                qrCodeEl.innerHTML = `
                    <div class="qr-loading">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p class="mt-2">Generating QR code...</p>
                    </div>
                `;
                
                // Reset status elements
                const scanStatusEl = document.getElementById('scan-status');
                scanStatusEl.style.display = 'none';
                
                const statusEl = document.getElementById('invitation-status');
                statusEl.textContent = 'Generating...';
                statusEl.className = 'badge bg-info';
                
                // Cleanup any existing invitation
                if (activeInvitationToken) {
                    cleanupExistingInvitation();
                }
                
                // Check if QRCodeGenerator is available
                if (typeof QRCodeGenerator === 'undefined') {
                    throw new Error('QR code generator library not available');
                }
                
                // Generate the invitation using the ChatService
                const invitation = await ChatService.createInvitation();
                
                // Support both token field names for backward compatibility
                activeInvitationToken = invitation.invitation_token || invitation.token;
                
                if (!activeInvitationToken) {
                    throw new Error('No invitation token received from server');
                }
                
                // Create the invitation URL
                const invitationUrl = QRCodeGenerator.createInvitationURL(activeInvitationToken);
                
                // Display the URL in the input field
                invitationLinkInput.value = invitationUrl;
                
                // Generate QR code
                qrCodeEl.innerHTML = ''; // Clear loading state
                const qrCodeGenerated = QRCodeGenerator.generateQR('qr-code', invitationUrl, {
                    width: 256,
                    height: 256
                });
                
                if (!qrCodeGenerated) {
                    throw new Error('Failed to generate QR code');
                }
                
                // Update status
                statusEl.textContent = 'Active';
                statusEl.className = 'badge bg-success';
                
                scanStatusEl.textContent = 'Waiting for someone to scan the QR code...';
                scanStatusEl.className = 'alert alert-info';
                scanStatusEl.style.display = 'block';
                
                console.log('Generated invitation:', invitation);
                
                // Set up listeners for invitation updates
                setupInvitationListeners(activeInvitationToken);
                
                // Start countdown timer
                startCountdown(invitation.expiry_seconds || 1800);
                
            } catch (error) {
                console.error('Error generating invitation:', error);
                
                // Show error in UI
                const qrCodeEl = document.getElementById('qr-code');
                qrCodeEl.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Failed to generate QR code: ${error.message || 'Unknown error'}
                    </div>
                `;
                
                const statusEl = document.getElementById('invitation-status');
                statusEl.textContent = 'Error';
                statusEl.className = 'badge bg-danger';
            }
        }
        
        /**
         * Set up listeners for invitation status updates
         */
        function setupInvitationListeners(token) {
            // Clean up any existing listeners
            if (invitationListener && invitationListener.unsubscribe) {
                invitationListener.unsubscribe();
            }
            
            if (!token) {
                console.error('Cannot set up listeners: Invalid or missing invitation token');
                return;
            }
            
            // Set up new listeners
            invitationListener = ChatService.listenForInvitationUpdates(
                token,
                handleInvitationStatusUpdate,
                handleInvitationAcceptedUpdate,
                handleQrScannedUpdate
            );
            
            // Initial status check
            checkInvitationStatus(token);
        }
        
        /**
         * Check invitation status
         */
        async function checkInvitationStatus(token) {
            try {
                if (!token) {
                    console.error('Cannot check invitation status: Invalid or missing token');
                    return;
                }
                
                const status = await ChatService.checkInvitationStatus(token);
                updateStatusUI(status);
            } catch (error) {
                console.error('Error checking invitation status:', error);
            }
        }
        
        /**
         * Handle invitation status update from socket
         */
        function handleInvitationStatusUpdate(data) {
            console.log('Invitation status update:', data);
            updateStatusUI(data);
            
            // Dispatch custom event
            const event = new CustomEvent('invitationStatusChanged', { 
                detail: { 
                    token: activeInvitationToken,
                    status: data.status,
                    data: data
                } 
            });
            document.dispatchEvent(event);
        }
        
        /**
         * Handle QR code scanned notification from socket
         */
        function handleQrScannedUpdate(data) {
            console.log('QR code scanned notification:', data);
            
            // Update UI to show scan
            const scanStatusEl = document.getElementById('scan-status');
            if (scanStatusEl) {
                scanStatusEl.textContent = 'QR code scanned! Waiting for acceptance...';
                scanStatusEl.className = 'alert alert-info';
                scanStatusEl.style.display = 'block';
            }
            
            // Dispatch custom event
            const event = new CustomEvent('qrCodeScanned', { 
                detail: { 
                    token: activeInvitationToken,
                    scanner: data.scanner_id
                } 
            });
            document.dispatchEvent(event);
        }
        
        /**
         * Handle invitation accepted notification from socket
         */
        function handleInvitationAcceptedUpdate(data) {
            console.log('Invitation accepted notification:', data);
            
            // Update UI to show acceptance
            const scanStatusEl = document.getElementById('scan-status');
            if (scanStatusEl) {
                scanStatusEl.textContent = 'Invitation accepted! Redirecting to chat...';
                scanStatusEl.className = 'alert alert-success';
                scanStatusEl.style.display = 'block';
            }
            
            // Dispatch custom event
            const event = new CustomEvent('invitationAccepted', { 
                detail: { 
                    token: activeInvitationToken,
                    chatId: data.chat_id
                } 
            });
            document.dispatchEvent(event);
            
            // Redirect to the chat room
            if (data.chat_id) {
                setTimeout(() => {
                    window.location.href = `/chat/${data.chat_id}`;
                }, 2000);
            }
        }
        
        /**
         * Update the UI based on invitation status
         */
        function updateStatusUI(data) {
            // Get countdown element and update it
            const countdownEl = document.getElementById('invitation-countdown');
            if (countdownEl && data.seconds_remaining) {
                countdownEl.textContent = formatTime(data.seconds_remaining);
            }
            
            // Update visual status indicator
            const statusEl = document.getElementById('invitation-status');
            if (statusEl) {
                let statusText = 'Active';
                let statusClass = 'text-success';
                
                if (data.status === 'expired') {
                    statusText = 'Expired';
                    statusClass = 'text-danger';
                    handleInvitationExpired({ detail: { token: activeInvitationToken } });
                } else if (data.status === 'used') {
                    statusText = 'Used';
                    statusClass = 'text-primary';
                    
                    if (data.chat_id) {
                        handleInvitationAccepted({ 
                            detail: { 
                                token: activeInvitationToken,
                                chatId: data.chat_id
                            }
                        });
                    }
                }
                
                statusEl.textContent = statusText;
                statusEl.className = `badge ${statusClass}`;
            }
        }
        
        /**
         * Start countdown timer
         */
        let countdownTimer = null;
        function startCountdown(seconds) {
            // Clear any existing timer
            if (countdownTimer) {
                clearInterval(countdownTimer);
            }
            
            // Initialize remaining time
            let remainingSeconds = seconds || 1800; // Default to 30 minutes
            
            // Update countdown every second
            countdownTimer = setInterval(() => {
                remainingSeconds--;
                
                // Update countdown display
                const countdownEl = document.getElementById('invitation-countdown');
                if (countdownEl) {
                    countdownEl.textContent = formatTime(remainingSeconds);
                }
                
                // Check if expired
                if (remainingSeconds <= 0) {
                    clearInterval(countdownTimer);
                    
                    // Dispatch event for expired invitation
                    const event = new CustomEvent('invitationExpired', { 
                        detail: { token: activeInvitationToken } 
                    });
                    document.dispatchEvent(event);
                }
            }, 1000);
            
            // Immediately update display
            const countdownEl = document.getElementById('invitation-countdown');
            if (countdownEl) {
                countdownEl.textContent = formatTime(remainingSeconds);
            }
        }
        
        /**
         * Format seconds into mm:ss time string
         */
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        /**
         * Clean up existing invitation
         */
        function cleanupExistingInvitation() {
            // Stop countdown timer
            if (countdownTimer) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
            
            // Clean up listeners
            if (invitationListener && invitationListener.unsubscribe) {
                invitationListener.unsubscribe();
                invitationListener = null;
            }
            
            activeInvitationToken = null;
        }
        
        /**
         * Copy the invitation link to clipboard
         */
        function copyInvitationLink() {
            if (!invitationLinkInput.value) return;
            
            try {
                // Select the text
                invitationLinkInput.select();
                invitationLinkInput.setSelectionRange(0, 99999);
                
                // Copy to clipboard
                document.execCommand('copy');
                
                // Show success message
                copyStatusText.textContent = 'Link copied to clipboard!';
                copyStatusText.className = 'form-text text-success';
                
                // Clear message after 2 seconds
                setTimeout(() => {
                    copyStatusText.textContent = '';
                }, 2000);
                
            } catch (error) {
                console.error('Error copying link:', error);
                copyStatusText.textContent = 'Failed to copy link: ' + error.message;
                copyStatusText.className = 'form-text text-danger';
            }
        }
        
        /**
         * Handle invitation status change
         */
        function handleStatusChange(event) {
            console.log('Invitation status changed:', event.detail);
            // UI updates are handled in updateStatusUI
        }
        
        /**
         * Handle QR code scanned event
         */
        function handleQrScanned(event) {
            console.log('QR code scanned:', event.detail);
            // UI updates are handled in handleQrScannedUpdate
        }
        
        /**
         * Handle invitation accepted event
         */
        function handleInvitationAccepted(event) {
            console.log('Invitation accepted:', event.detail);
            
            // Redirect to the new chat room
            const chatId = event.detail.chatId;
            if (chatId) {
                // Small delay to show the success message
                setTimeout(() => {
                    window.location.href = `/chat/${chatId}`;
                }, 2000);
            }
        }
        
        /**
         * Handle invitation expired event
         */
        function handleInvitationExpired(event) {
            console.log('Invitation expired:', event.detail);
            
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
                // Create expired overlay if it doesn't exist
                if (!qrCodeEl.querySelector('.expired-overlay')) {
                    const overlay = document.createElement('div');
                    overlay.className = 'expired-overlay';
                    overlay.innerHTML = '<span>EXPIRED</span>';
                    qrCodeEl.appendChild(overlay);
                }
            }
        }
        
        /**
         * Handle invitation canceled event
         */
        function handleInvitationCanceled(event) {
            console.log('Invitation canceled:', event.detail);
            // No specific UI updates needed
        }
        
        /**
         * Clean up when leaving the page
         */
        window.addEventListener('beforeunload', () => {
            cleanupExistingInvitation();
        });
    }
}); 