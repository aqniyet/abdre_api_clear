/**
 * QR Code Generator Utility
 * Provides methods for generating QR codes using the QRCode.js library
 */

// Ensure QRCode library is loaded
console.log('QR Code Generator initializing...');

// QR Code generator object - explicitly attach to window
window.QRCodeGenerator = {
    /**
     * Check if QRCode library is available
     * @returns {boolean} - Whether the library is loaded
     */
    isLibraryLoaded() {
        const isLoaded = typeof QRCode !== 'undefined';
        console.log('QRCode library loaded:', isLoaded);
        return isLoaded;
    },

    /**
     * Create invitation URL from token
     * @param {string} token - The invitation token
     * @returns {string} - The full invitation URL
     */
    createInvitationURL(token) {
        // Use current hostname for the invitation URL
        const baseUrl = window.location.origin;
        const url = `${baseUrl}/join/${token}`;
        console.log('Created invitation URL:', url);
        return url;
    },

    /**
     * Generate a QR code
     * @param {string} elementId - The ID of the element to put the QR code in
     * @param {string} url - The URL to encode in the QR code
     * @param {Object} options - Additional options for QR code generation
     * @returns {boolean} - Success status
     */
    generateQR(elementId, url, options = {}) {
        console.log(`Generating QR code in element ${elementId} for URL: ${url}`);
        
        // Verify library is available
        if (!this.isLibraryLoaded()) {
            console.error('QR code generation failed: Library not loaded');
            
            // Show an error message in the element
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = `
                    <div class="alert alert-danger">
                        QR code generation library not available. Please refresh the page and try again.
                    </div>
                `;
            }
            return false;
        }

        try {
            // Clear any existing content
            const element = document.getElementById(elementId);
            if (!element) {
                console.error(`Element with ID ${elementId} not found`);
                return false;
            }
            
            // Default options
            const defaultOptions = {
                width: 256,
                height: 256,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            };

            // Merge with user options
            const mergedOptions = {...defaultOptions, ...options};
            
            // Generate the QR code
            new QRCode(element, {
                text: url,
                width: mergedOptions.width,
                height: mergedOptions.height,
                colorDark: mergedOptions.colorDark,
                colorLight: mergedOptions.colorLight,
                correctLevel: mergedOptions.correctLevel
            });
            
            console.log('QR code generated successfully');
            return true;
        } catch (error) {
            console.error('Error generating QR code:', error);
            
            // Show an error message in the element
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = `
                    <div class="alert alert-danger">
                        Failed to generate QR code. Please try again.
                    </div>
                `;
            }
            return false;
        }
    }
};

// Log that the QRCodeGenerator is fully loaded
console.log('QRCodeGenerator initialized and ready');

// Add a test function
window.testQRGenerator = function() {
    if (window.QRCodeGenerator && window.QRCodeGenerator.isLibraryLoaded()) {
        console.log('QRCodeGenerator is available and library is loaded');
        return true;
    } else {
        console.error('QRCodeGenerator test failed');
        return false;
    }
}; 