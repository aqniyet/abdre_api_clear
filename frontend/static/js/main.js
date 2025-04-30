// ABDRE Microservices - Main JavaScript

// Check for authentication
function checkAuth() {
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    
    if (!accessToken) {
        return false;
    }
    
    // Check if token has expired and refresh if needed
    if (refreshToken) {
        try {
            // Decode the JWT to check expiration
            const payload = JSON.parse(atob(accessToken.split('.')[1]));
            const expiry = new Date(payload.exp * 1000);
            
            if (expiry < new Date()) {
                refreshAccessToken(refreshToken);
            }
        } catch (e) {
            console.error('Error checking token:', e);
        }
    }
    
    return true;
}

// Refresh access token
async function refreshAccessToken(refreshToken) {
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        
        const data = await response.json();
        
        if (data.access_token) {
            localStorage.setItem('access_token', data.access_token);
            return true;
        } else {
            // Clear tokens if refresh failed
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            return false;
        }
    } catch (error) {
        console.error('Error refreshing token:', error);
        return false;
    }
}

// Logout function
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    window.location.href = '/';
}

// Format date utility
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

// Copy text to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            // Show success message
            const messageElement = document.createElement('div');
            messageElement.textContent = 'Copied to clipboard!';
            messageElement.style.position = 'fixed';
            messageElement.style.bottom = '20px';
            messageElement.style.left = '50%';
            messageElement.style.transform = 'translateX(-50%)';
            messageElement.style.backgroundColor = '#4CAF50';
            messageElement.style.color = 'white';
            messageElement.style.padding = '10px 20px';
            messageElement.style.borderRadius = '4px';
            messageElement.style.zIndex = '1000';
            
            document.body.appendChild(messageElement);
            
            // Remove after 2 seconds
            setTimeout(() => {
                document.body.removeChild(messageElement);
            }, 2000);
        })
        .catch(err => {
            console.error('Could not copy text: ', err);
        });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Add logout button functionality if present
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', logout);
    }
}); 