/**
 * Dropdown Enhancer for ABDRE Chat
 * Handles dropdown menu functionality
 */

// Make sure ABDRE namespace exists
window.ABDRE = window.ABDRE || {};
window.ABDRE.Enhancers = window.ABDRE.Enhancers || {};

/**
 * Dropdown Enhancer
 * Handles dropdown menu functionality throughout the application
 */
ABDRE.Enhancers.Dropdown = (function() {
    'use strict';

    // Collection of all dropdowns on the page
    let dropdowns = [];
    
    /**
     * Initialize enhancer
     */
    function init() {
        // Find all dropdown toggles
        const toggles = document.querySelectorAll('.dropdown-toggle');
        
        // Setup each dropdown toggle
        toggles.forEach(setupDropdown);
        
        // Add document click handler to close dropdowns when clicking outside
        document.addEventListener('click', handleDocumentClick);
        
        // Add keyboard handler for accessibility
        document.addEventListener('keydown', handleKeyDown);
    }
    
    /**
     * Setup a dropdown toggle element
     * @param {HTMLElement} toggle - The dropdown toggle button
     */
    function setupDropdown(toggle) {
        // Find the dropdown menu this toggle controls
        const dropdown = {
            toggle: toggle,
            menu: document.getElementById(toggle.getAttribute('aria-controls')) || toggle.nextElementSibling,
            isOpen: false
        };
        
        // Only proceed if we found a menu
        if (!dropdown.menu) {
            console.warn('Dropdown menu not found for toggle:', toggle);
            return;
        }
        
        // Add to our collection
        dropdowns.push(dropdown);
        
        // Set initial ARIA attributes
        toggle.setAttribute('aria-expanded', 'false');
        
        // Add click handler
        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown(dropdown);
        });
    }
    
    /**
     * Toggle a dropdown's open state
     * @param {Object} dropdown - The dropdown to toggle
     */
    function toggleDropdown(dropdown) {
        if (dropdown.isOpen) {
            closeDropdown(dropdown);
        } else {
            openDropdown(dropdown);
        }
    }
    
    /**
     * Open a dropdown
     * @param {Object} dropdown - The dropdown to open
     */
    function openDropdown(dropdown) {
        // Close any other open dropdowns
        dropdowns.forEach(function(d) {
            if (d !== dropdown && d.isOpen) {
                closeDropdown(d);
            }
        });
        
        // Show this dropdown
        dropdown.menu.classList.add('show');
        dropdown.toggle.setAttribute('aria-expanded', 'true');
        dropdown.isOpen = true;
        
        // Position the dropdown menu if needed
        positionDropdown(dropdown);
    }
    
    /**
     * Close a dropdown
     * @param {Object} dropdown - The dropdown to close
     */
    function closeDropdown(dropdown) {
        dropdown.menu.classList.remove('show');
        dropdown.toggle.setAttribute('aria-expanded', 'false');
        dropdown.isOpen = false;
    }
    
    /**
     * Close all dropdowns
     */
    function closeAllDropdowns() {
        dropdowns.forEach(function(dropdown) {
            if (dropdown.isOpen) {
                closeDropdown(dropdown);
            }
        });
    }
    
    /**
     * Position a dropdown menu in relation to its toggle
     * @param {Object} dropdown - The dropdown to position
     */
    function positionDropdown(dropdown) {
        // Get toggle position
        const toggleRect = dropdown.toggle.getBoundingClientRect();
        const menuRect = dropdown.menu.getBoundingClientRect();
        
        // Check if the menu would go off the bottom of the viewport
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - toggleRect.bottom;
        
        // If not enough space below, show above
        if (spaceBelow < menuRect.height && toggleRect.top > menuRect.height) {
            dropdown.menu.classList.add('dropdown-menu--up');
        } else {
            dropdown.menu.classList.remove('dropdown-menu--up');
        }
    }
    
    /**
     * Handle clicks outside of dropdowns
     * @param {Event} e - The click event
     */
    function handleDocumentClick(e) {
        // If the click was inside a dropdown, do nothing
        const clickedInsideDropdown = dropdowns.some(function(dropdown) {
            return dropdown.toggle.contains(e.target) || dropdown.menu.contains(e.target);
        });
        
        if (!clickedInsideDropdown) {
            closeAllDropdowns();
        }
    }
    
    /**
     * Handle keyboard events for accessibility
     * @param {KeyboardEvent} e - The keyboard event
     */
    function handleKeyDown(e) {
        // Close dropdowns on ESC key
        if (e.key === 'Escape') {
            closeAllDropdowns();
        }
    }
    
    // Public API
    return {
        init: init
    };
})(); 