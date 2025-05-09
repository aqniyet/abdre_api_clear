/**
 * Create Chat Popup Enhancer for ABDRE Chat
 * 
 * Handles the popup menu for creating different types of chats directly from the chat list
 */

window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

ABDRE.Enhancers.CreateChatPopup = (function() {
    'use strict';
    
    // Private variables
    let _popup = null;
    let _initialized = false;
    let _newChatButton = null;
    let _closeButton = null;
    let _directChatOption = null;
    let _groupChatOption = null;
    let _qrInviteOption = null;
    
    // Initialize the popup and event listeners
    function _init() {
        if (_initialized) return;
        
        // Get DOM elements
        _popup = document.getElementById('create-chat-popup');
        _newChatButton = document.querySelector('.page-actions .btn-primary');
        _closeButton = document.getElementById('create-popup-close');
        _directChatOption = document.getElementById('option-direct-chat');
        _groupChatOption = document.getElementById('option-group-chat');
        _qrInviteOption = document.getElementById('option-qr-invite');
        
        // If any of the required elements don't exist, abort initialization
        if (!_popup || !_newChatButton) {
            console.warn('CreateChatPopup: Required elements not found');
            return;
        }
        
        // Setup event listeners
        _setupEventListeners();
        
        _initialized = true;
        console.log('Create Chat Popup enhancer initialized');
    }
    
    // Setup event listeners for popup interactions
    function _setupEventListeners() {
        // Show popup when "+ New Chat" button is clicked
        if (_newChatButton) {
            _newChatButton.addEventListener('click', function(e) {
                e.preventDefault();
                _togglePopup();
            });
        }
        
        // Close popup when close button is clicked
        if (_closeButton) {
            _closeButton.addEventListener('click', function() {
                _hidePopup();
            });
        }
        
        // Handle clicks on popup options
        if (_directChatOption) {
            _directChatOption.addEventListener('click', function() {
                window.location.href = '/create#direct';
            });
        }
        
        if (_groupChatOption) {
            _groupChatOption.addEventListener('click', function() {
                window.location.href = '/create#group';
            });
        }
        
        if (_qrInviteOption) {
            _qrInviteOption.addEventListener('click', function() {
                _hidePopup();
                // If QR invitation service is available, show QR modal
                if (ABDRE.Services && ABDRE.Services.QRInvitation) {
                    ABDRE.Services.QRInvitation.showQRInvitation();
                } else {
                    window.location.href = '/create#qr';
                }
            });
        }
        
        // Close popup when clicking outside of it
        document.addEventListener('click', function(e) {
            if (_popup && _popup.classList.contains('active')) {
                // If click is outside the popup and not on the new chat button
                if (!_popup.contains(e.target) && !_newChatButton.contains(e.target)) {
                    _hidePopup();
                }
            }
        });
        
        // Close popup when ESC key is pressed
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && _popup && _popup.classList.contains('active')) {
                _hidePopup();
            }
        });
    }
    
    // Toggle popup visibility
    function _togglePopup() {
        if (_popup) {
            if (_popup.classList.contains('active')) {
                _hidePopup();
            } else {
                _showPopup();
            }
        }
    }
    
    // Show the popup
    function _showPopup() {
        if (_popup) {
            _popup.classList.add('active');
        }
    }
    
    // Hide the popup
    function _hidePopup() {
        if (_popup) {
            _popup.classList.remove('active');
        }
    }
    
    // Public API
    return {
        init: function() {
            _init();
            return this;
        },
        
        showPopup: function() {
            _showPopup();
            return this;
        },
        
        hidePopup: function() {
            _hidePopup();
            return this;
        }
    };
})(); 