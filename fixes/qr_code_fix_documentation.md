# QR Code Invitation Fix

## Issue Description
The ABDRE Chat application was experiencing issues when generating QR codes for chat invitations, particularly in localhost environments. 

### Problem Details
1. The `invitation-manager.js` file was changing API endpoints for localhost environments, causing requests to go to direct paths (e.g., `/generate-invitation`) instead of the correct API gateway paths (e.g., `/api/chats/generate-invitation`).
2. The API gateway was returning 404 errors because it didn't have routes for the direct paths being requested.
3. There were also Content-Type header issues causing 415 Unsupported Media Type errors when making API requests.

### Root Causes
1. **Endpoint Path Issues**: In the `invitation-manager.js` file, there was a conditional statement in the `init()` function that specifically modified endpoint paths for localhost environments:

```javascript
// Update endpoint URLs if needed
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Direct endpoints for local development
    this.config.generateEndpoint = '/generate-invitation';
    this.config.statusEndpoint = '/invitation-status';
    this.config.cleanupEndpoint = '/cleanup-expired-invitations';
}
```

This was causing the frontend to bypass the API gateway routing for these specific endpoints, leading to 404 errors since these direct routes don't exist.

2. **Content-Type Header Issues**: The code was inconsistently setting the 'Content-Type' header for API requests, sometimes relying on auth headers without explicitly setting 'Content-Type: application/json'. This caused 415 Unsupported Media Type errors.

## Solution
The fix includes two main changes:

### 1. Consistent API Gateway Endpoints
Removed the conditional code that was changing the endpoints for localhost environments. Now, all environments (production, staging, and localhost) use the same API gateway endpoints, ensuring consistency.

### 2. Content-Type Header Fixes
Added explicit Content-Type header handling to all API calls to ensure the 'Content-Type: application/json' header is always set correctly, even when auth headers are included.

### Files Modified
1. `frontend/static/js/utils/invitation-manager.js`
2. `api_gateway/static/js/utils/invitation-manager.js`

### Code Changes

1. **Endpoint Path Fix**:
```javascript
// Always use the API gateway endpoints regardless of environment
// The previous code was changing endpoints for localhost, causing 404 errors
```

2. **Content-Type Header Fix**:
```javascript
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

// Use in fetch request
const response = await fetch(this.config.generateEndpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ host_id: userId })
});
```

## Testing
After implementing this fix, QR code invitation generation should work correctly on all environments, including localhost. The system will consistently use the API gateway endpoints with proper headers, which are correctly configured to route requests to the appropriate services.

## Prevention
To prevent similar issues in the future:
1. Be cautious when implementing environment-specific code paths, especially for API endpoints
2. Always explicitly set the correct Content-Type header for API requests
3. Ensure that any environment-specific configurations are thoroughly tested
4. Maintain consistent API routing patterns across all environments when possible
5. Use a centralized API client with consistent header handling 