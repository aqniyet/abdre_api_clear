/**
 * Invitation QR Code Debugger
 * 
 * Run this in the browser console to diagnose invitation and QR code issues
 */

(function() {
    console.log('=== Invitation Debug Utility ===');
    
    // Check if required objects exist
    if (!window.ApiClient) {
        console.error('❌ ApiClient not found in window object');
    } else {
        console.log('✅ ApiClient found');
        
        // Check invitation endpoints configuration
        console.log('Checking invitation endpoint configuration:');
        console.log('  Generate endpoint:', ApiClient.config.endpoints.chats.invitation.generate);
        console.log('  Status endpoint:', ApiClient.config.endpoints.chats.invitation.status);
        console.log('  Accept endpoint:', ApiClient.config.endpoints.chats.invitation.accept);
    }
    
    if (!window.InvitationManager) {
        console.error('❌ InvitationManager not found in window object');
    } else {
        console.log('✅ InvitationManager found');
        
        // Check InvitationManager configuration
        console.log('Checking InvitationManager configuration:');
        console.log('  Generate endpoint:', InvitationManager.config.generateEndpoint);
        console.log('  Status endpoint:', InvitationManager.config.statusEndpoint);
        console.log('  Cleanup endpoint:', InvitationManager.config.cleanupEndpoint);
    }
    
    if (!window.QRCodeGenerator) {
        console.error('❌ QRCodeGenerator not found in window object');
    } else {
        console.log('✅ QRCodeGenerator found');
        
        // Test invitation URL generation
        const testToken = 'test-token-123';
        const invitationUrl = QRCodeGenerator.createInvitationURL(testToken);
        console.log(`Test invitation URL for token '${testToken}': ${invitationUrl}`);
    }
    
    // Function to test invitation generation
    window.testInvitationGeneration = async function() {
        try {
            console.log('Generating test invitation...');
            const response = await ApiClient.createChatInvitation();
            console.log('Invitation generated successfully:', response);
            
            // Test URL generation
            if (response.invitation_token) {
                const invitationUrl = QRCodeGenerator.createInvitationURL(response.invitation_token);
                console.log(`Invitation URL: ${invitationUrl}`);
                
                // Test direct fetch to check status
                const statusUrl = `/api/chats/invitation-status/${response.invitation_token}`;
                console.log(`Checking status directly from: ${statusUrl}`);
                
                const statusResponse = await fetch(statusUrl);
                const statusData = await statusResponse.json();
                console.log('Status response:', statusData);
            }
            
            return response;
        } catch (error) {
            console.error('Error generating test invitation:', error);
            throw error;
        }
    };
    
    // Function to test a specific token
    window.checkInvitationToken = async function(token) {
        if (!token) {
            console.error('No token provided');
            return;
        }
        
        try {
            console.log(`Checking invitation token: ${token}`);
            
            // Test direct fetch to check status
            const statusUrl = `/api/chats/invitation-status/${token}`;
            console.log(`Checking status from: ${statusUrl}`);
            
            const statusResponse = await fetch(statusUrl);
            const statusData = await statusResponse.json();
            console.log('Status response:', statusData);
            
            // Generate URL and check
            const invitationUrl = QRCodeGenerator.createInvitationURL(token);
            console.log(`Invitation URL: ${invitationUrl}`);
            
            return statusData;
        } catch (error) {
            console.error('Error checking invitation token:', error);
            throw error;
        }
    };
    
    console.log('Debug utility loaded. Use these functions:');
    console.log('- testInvitationGeneration() - Generate a test invitation');
    console.log('- checkInvitationToken(token) - Check a specific invitation token');
})(); 