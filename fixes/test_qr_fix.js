/**
 * Test script to verify the QR code invitation fix
 * Run this in the browser console to confirm the correct endpoint URLs are being used
 * and that Content-Type headers are properly set
 */

(function() {
  console.log('=== QR Code Fix Verification Test ===');
  
  // Check if InvitationManager exists
  if (!window.InvitationManager) {
    console.error('❌ InvitationManager not found in window object');
    return;
  }
  
  console.log('✅ InvitationManager found');
  
  // Check endpoint configurations
  const endpoints = {
    generate: InvitationManager.config.generateEndpoint,
    status: InvitationManager.config.statusEndpoint,
    cleanup: InvitationManager.config.cleanupEndpoint
  };
  
  console.log('Current endpoint configurations:');
  console.log(endpoints);
  
  // Verify endpoints have the correct format
  const correctFormat = {
    generate: '/api/chats/generate-invitation',
    status: '/api/chats/invitation-status',
    cleanup: '/api/chats/cleanup-expired-invitations'
  };
  
  let allCorrect = true;
  
  Object.keys(correctFormat).forEach(key => {
    const isCorrect = endpoints[key] === correctFormat[key];
    console.log(`${key} endpoint: ${isCorrect ? '✅ Correct' : '❌ Incorrect'} - ${endpoints[key]}`);
    if (!isCorrect) {
      allCorrect = false;
    }
  });
  
  // Test init function to ensure it doesn't modify endpoints
  console.log('Testing init function...');
  const originalEndpoints = {...endpoints};
  
  // Reinitialize the manager
  InvitationManager.init();
  
  // Check if endpoints were modified
  const endpointsUnchanged = 
    InvitationManager.config.generateEndpoint === originalEndpoints.generate &&
    InvitationManager.config.statusEndpoint === originalEndpoints.status &&
    InvitationManager.config.cleanupEndpoint === originalEndpoints.cleanup;
  
  console.log(`Init function test: ${endpointsUnchanged ? '✅ Endpoints unchanged' : '❌ Endpoints were modified'}`);
  
  // Test header handling
  console.log('Testing header handling...');
  
  // Mock window.AuthHelper for testing if it doesn't exist
  const originalAuthHelper = window.AuthHelper;
  if (!window.AuthHelper) {
    window.AuthHelper = {
      getAuthHeaders: function() {
        return { 'Authorization': 'Bearer test-token' };
      }
    };
    console.log('Created mock AuthHelper for testing');
  }
  
  // Generate headers with the InvitationManager's header creation code
  const headersTest = function() {
    // Create a fetch spy to capture the headers
    const originalFetch = window.fetch;
    let capturedHeaders = null;
    
    window.fetch = function(url, options) {
      capturedHeaders = options.headers;
      console.log('Captured headers:', capturedHeaders);
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({error: 'Test error'})
      });
    };
    
    // Try to generate an invitation to trigger the fetch with headers
    InvitationManager.generateInvitation().catch(e => {
      // Ignore the error, we're just testing headers
    });
    
    // Restore original fetch
    window.fetch = originalFetch;
    
    // Check if Content-Type is set correctly
    const hasContentType = capturedHeaders && 
      (capturedHeaders['Content-Type'] === 'application/json' || 
       capturedHeaders.get && capturedHeaders.get('Content-Type') === 'application/json');
    
    return hasContentType;
  };
  
  const headersCorrect = headersTest();
  console.log(`Header handling test: ${headersCorrect ? '✅ Content-Type header is set correctly' : '❌ Content-Type header is missing or incorrect'}`);
  
  // Restore original AuthHelper if we created a mock
  if (!originalAuthHelper) {
    window.AuthHelper = originalAuthHelper;
  }
  
  // Overall test result
  if (allCorrect && endpointsUnchanged && headersCorrect) {
    console.log('✅ VERIFICATION PASSED: QR code fix is working correctly!');
  } else {
    console.log('❌ VERIFICATION FAILED: Issues found with QR code fix');
  }
})(); 