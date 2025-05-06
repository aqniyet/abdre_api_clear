# ABDRE Chat Invitation System Fix

This fix addresses issues with the QR code invitation system in ABDRE Chat. The main problems were:

1. Invitations were not persisted between service restarts
2. The invitation token storage was not properly accessible across services
3. API endpoint configuration had inconsistencies

## Changes Made

1. **Created Persistent Mock Database**
   - Added a dedicated mock_db.py module with file-based persistence
   - Ensures invitations are saved to disk and survive service restarts

2. **Fixed API Client Configuration**
   - Corrected the invitation endpoints in api-client.js to ensure proper URL formation
   - Verified that API requests use the correct Content-Type headers

3. **Created Test Tools**
   - Added create-test-invitation.py to easily generate test invitations
   - Improved debugging and invitation status verification

## How to Use

1. **Start the services**
   ```
   ./start-all-services.sh
   ```

2. **Generate a test invitation**
   ```
   python3 create-test-invitation.py
   ```
   This will output a URL that you can use to join a chat.

3. **Access the invitation URL**
   You can access it either via:
   - Local URL: http://localhost:5005/join/{token}
   - External IP: http://{your-ip}:5005/join/{token}

## Troubleshooting

If you encounter any issues:

1. Check the logs in the logs/ directory
2. Verify the invitation status using:
   ```
   curl http://localhost:5504/invitation-status/{your-token}
   ```
3. Restart all services:
   ```
   ./stop-all-services.sh
   ./start-all-services.sh
   ```

## How it Works

The invitation system now uses a file-based persistence layer that stores invitation data in `chat_service/data/mock_db.pickle`. This ensures that invitations are not lost when services restart.

When you scan a QR code, it directs you to the `/join/{token}` URL, which then:
1. Checks if the invitation exists and is valid
2. Creates a new chat room
3. Marks the invitation as used
4. Redirects you to the chat room

The fix ensures this flow works reliably across service restarts and when accessing from different devices on your network.
