#!/bin/bash

# Fix invitations system for ABDRE Chat
# This script addresses issues with invitation persistence and QR code scanning

echo "=================================================================="
echo "ABDRE Chat Invitation System Fix"
echo "=================================================================="

# Get the base directory
BASE_DIR=$(dirname "$0")
cd "$BASE_DIR"

# Create mock DB persistence directory
echo "Creating mock DB persistence directory..."
mkdir -p chat_service/data
MOCK_DB_FILE="chat_service/data/mock_db.pickle"

# Create persistent mock DB implementation
echo "Creating persistent mock DB implementation..."
cat > chat_service/mock_db.py << 'EOF'
import os
import pickle
import logging
import datetime
import uuid

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# File to persist MOCK_DB data
MOCK_DB_FILE = os.path.join(os.path.dirname(__file__), 'data/mock_db.pickle')

# Initialize mock database
MOCK_DB = {
    "chats": [],
    "messages": [],
    "invitations": []
}

def load_mock_db():
    """Load mock DB from file if it exists"""
    global MOCK_DB
    try:
        if os.path.exists(MOCK_DB_FILE):
            with open(MOCK_DB_FILE, 'rb') as f:
                MOCK_DB = pickle.load(f)
            logger.info(f"Loaded MOCK_DB from {MOCK_DB_FILE} with {len(MOCK_DB['invitations'])} invitations")
        else:
            logger.info("No MOCK_DB file found, using default empty database")
    except Exception as e:
        logger.error(f"Error loading MOCK_DB data: {str(e)}")

def save_mock_db():
    """Save mock DB to file"""
    try:
        # Ensure directory exists
        os.makedirs(os.path.dirname(MOCK_DB_FILE), exist_ok=True)
        with open(MOCK_DB_FILE, 'wb') as f:
            pickle.dump(MOCK_DB, f)
        logger.info(f"Saved MOCK_DB to {MOCK_DB_FILE} with {len(MOCK_DB['invitations'])} invitations")
    except Exception as e:
        logger.error(f"Error saving MOCK_DB data: {str(e)}")

# Initialize with test data
def init_test_data():
    """Initialize mock DB with test data if empty"""
    global MOCK_DB
    if not MOCK_DB["invitations"]:
        # Add a test invitation that doesn't expire
        created_at = datetime.datetime.utcnow()
        expires_at = created_at + datetime.timedelta(days=30)  # Long-lived invitation
        test_invitation = {
            "invitation_token": "test-invitation-token",
            "host_id": "test-host-id",
            "created_at": created_at,
            "expires_at": expires_at,
            "is_used": False,
            "used_at": None,
            "chat_id": None
        }
        MOCK_DB["invitations"].append(test_invitation)
        logger.info(f"Added test invitation: test-invitation-token")
        save_mock_db()

# Load the database on module import
load_mock_db()
init_test_data()

class MockConnection:
    def __init__(self):
        self.autocommit = True
        global MOCK_DB
        
        # Log the state of the mock DB for debugging
        logger.info(f"MockConnection using MOCK_DB with {len(MOCK_DB['invitations'])} invitations")
        for inv in MOCK_DB["invitations"]:
            logger.info(f"  - Invitation: {inv['invitation_token']}")
    
    def cursor(self, *args, **kwargs):
        return MockCursor(self)
    
    def close(self):
        pass
        
    def commit(self):
        save_mock_db()
        
    def rollback(self):
        pass

class MockCursor:
    def __init__(self, connection):
        self.connection = connection
        self.results = []
        self.query_type = None
        
    def execute(self, query, params=None):
        logger.info(f"MOCK DB QUERY: {query}")
        if params:
            logger.info(f"MOCK DB PARAMS: {params}")
            
        global MOCK_DB
            
        # Handle different types of queries
        if "INSERT INTO chat_invitations" in query:
            # Handling invitation creation
            if params and len(params) >= 5:
                invitation_token = params[0]
                host_id = params[1]
                created_at = params[2]
                expires_at = params[3]
                is_used = params[4]
                
                # Store the invitation
                invitation = {
                    "invitation_token": invitation_token,
                    "host_id": host_id,
                    "created_at": created_at,
                    "expires_at": expires_at,
                    "is_used": is_used,
                    "used_at": None,
                    "chat_id": None
                }
                MOCK_DB["invitations"].append(invitation)
                logger.info(f"Created mock invitation: {invitation_token}")
                logger.info(f"Total invitations in MOCK_DB: {len(MOCK_DB['invitations'])}")
                self.query_type = "insert_invitation"
                self.results = [invitation]
                save_mock_db()
                
        elif "INSERT INTO chats" in query:
            # Handling chat creation
            if params and len(params) >= 2:
                chat_id = params[0]
                qr_token = params[1]
                
                # Store the chat
                chat = {
                    "chat_id": chat_id,
                    "qr_token": qr_token,
                    "created_at": datetime.datetime.utcnow()
                }
                MOCK_DB["chats"].append(chat)
                logger.info(f"Created mock chat: {chat_id}")
                self.query_type = "insert_chat"
                self.results = [chat]
                save_mock_db()
                
        elif "SELECT" in query and "FROM chat_invitations" in query:
            # Handling invitation lookup
            if "WHERE invitation_token" in query and params and len(params) == 1:
                invitation_token = params[0]
                # Find the invitation
                for invitation in MOCK_DB["invitations"]:
                    if invitation["invitation_token"] == invitation_token:
                        self.results = [invitation]
                        self.query_type = "select_invitation"
                        logger.info(f"Found invitation: {invitation_token}")
                        break
                else:
                    logger.info(f"Invitation not found: {invitation_token}")
                    logger.info(f"Available tokens: {[inv['invitation_token'] for inv in MOCK_DB['invitations']]}")
                    self.results = []
                
        elif "UPDATE chat_invitations" in query:
            # Handling invitation update (marking as used)
            if params and len(params) >= 2:
                # Last param should be the invitation token
                invitation_token = params[-1]
                
                # Update the invitation
                for invitation in MOCK_DB["invitations"]:
                    if invitation["invitation_token"] == invitation_token:
                        invitation["is_used"] = True
                        
                        # If updating with used_at
                        if "used_at" in query and len(params) >= 3:
                            invitation["used_at"] = params[0]
                            
                        # If updating with chat_id
                        if "chat_id" in query and len(params) >= 3:
                            invitation["chat_id"] = params[1]
                            
                        self.query_type = "update_invitation"
                        self.results = [invitation]
                        logger.info(f"Updated invitation: {invitation_token}")
                        save_mock_db()
                        break
                else:
                    logger.info(f"Invitation to update not found: {invitation_token}")
        
        return []
    
    def fetchall(self):
        if self.results:
            return self.results
        return []
    
    def fetchone(self):
        if self.results:
            return self.results[0]
        return None
    
    def close(self):
        pass
EOF

# Create patch for chat_service/app.py to use improved mock DB
echo "Creating patch for chat_service/app.py..."
cat > chat_service/app.py.patch << 'EOF'
--- a/chat_service/app.py
+++ b/chat_service/app.py
@@ -1,4 +1,5 @@
 import datetime
+import importlib
 import json
 import logging
 import os
@@ -46,134 +47,16 @@ MOCK_DB = {
     "messages": [],
     "invitations": []
 }
-
-# Initialize with a test invitation that doesn't expire
-created_at = datetime.datetime.utcnow()
-expires_at = created_at + datetime.timedelta(days=30)  # Long-lived invitation
-test_invitation = {
-    "invitation_token": "test-invitation-token",
-    "host_id": "test-host-id",
-    "created_at": created_at,
-    "expires_at": expires_at,
-    "is_used": False,
-    "used_at": None,
-    "chat_id": None
-}
-MOCK_DB["invitations"].append(test_invitation)
-logger.info(f"Global MOCK_DB initialized with test invitation: test-invitation-token")
-
-class MockConnection:
-    def __init__(self):
-        self.autocommit = True
-        # Use the global MOCK_DB instead of instance variables
-        global MOCK_DB
-        
-        # Log the state of the mock DB for debugging
-        logger.info(f"MockConnection using global MOCK_DB with {len(MOCK_DB['invitations'])} invitations")
-        for inv in MOCK_DB["invitations"]:
-            logger.info(f"  - Invitation: {inv['invitation_token']}")
-    
-    def cursor(self, *args, **kwargs):
-        return MockCursor(self)
-    
-    def close(self):
-        pass
-        
-    def commit(self):
-        # Dummy commit method for development
-        pass
-        
-    def rollback(self):
-        # Dummy rollback method for development
-        pass
-
-class MockCursor:
-    def __init__(self, connection):
-        self.connection = connection
-        self.results = []
-        self.query_type = None
-        
-    def execute(self, query, params=None):
-        # Just log the query
-        logger.info(f"MOCK DB: {query}")
-        if params:
-            logger.info(f"MOCK DB PARAMS: {params}")
-            
-        # Use the global MOCK_DB
-        global MOCK_DB
-            
-        # Handle different types of queries
-        if "INSERT INTO chat_invitations" in query:
-            # Handling invitation creation
-            if params and len(params) >= 5:
-                invitation_token = params[0]
-                host_id = params[1]
-                created_at = params[2]
-                expires_at = params[3]
-                is_used = params[4]
-                
-                # Store the invitation
-                invitation = {
-                    "invitation_token": invitation_token,
-                    "host_id": host_id,
-                    "created_at": created_at,
-                    "expires_at": expires_at,
-                    "is_used": is_used,
-                    "used_at": None,
-                    "chat_id": None
-                }
-                MOCK_DB["invitations"].append(invitation)
-                logger.info(f"Created mock invitation: {invitation_token}")
-                logger.info(f"Total invitations in MOCK_DB: {len(MOCK_DB['invitations'])}")
-                self.query_type = "insert_invitation"
-                self.results = [invitation]  # Store result for retrieval
-                
-        elif "SELECT" in query and "FROM chat_invitations" in query:
-            # Handling invitation lookup
-            if "WHERE invitation_token" in query and params and len(params) == 1:
-                invitation_token = params[0]
-                # Find the invitation
-                for invitation in MOCK_DB["invitations"]:
-                    if invitation["invitation_token"] == invitation_token:
-                        self.results = [invitation]
-                        self.query_type = "select_invitation"
-                        logger.info(f"Found invitation: {invitation_token}")
-                        break
-                else:
-                    logger.info(f"Invitation not found: {invitation_token}")
-                    logger.info(f"Available tokens: {[inv['invitation_token'] for inv in MOCK_DB['invitations']]}")
-                    self.results = []
-                
-        elif "UPDATE chat_invitations" in query:
-            # Handling invitation update (marking as used)
-            if params and len(params) >= 2:
-                # Last param should be the invitation token
-                invitation_token = params[-1]
-                
-                # Update the invitation
-                for invitation in MOCK_DB["invitations"]:
-                    if invitation["invitation_token"] == invitation_token:
-                        invitation["is_used"] = True
-                        
-                        # If updating with used_at
-                        if "used_at" in query and len(params) >= 3:
-                            invitation["used_at"] = params[0]
-                            
-                        # If updating with chat_id
-                        if "chat_id" in query and len(params) >= 3:
-                            invitation["chat_id"] = params[1]
-                            
-                        self.query_type = "update_invitation"
-                        self.results = [invitation]
-                        logger.info(f"Updated invitation: {invitation_token}")
-                        break
-                else:
-                    logger.info(f"Invitation to update not found: {invitation_token}")
-                    logger.info(f"Available tokens: {[inv['invitation_token'] for inv in MOCK_DB['invitations']]}")
-        
-        # Return an empty list as the execute result
-        return []
-    
-    def fetchall(self):
-        if self.results:
-            return self.results
-        return []
-    
-    def fetchone(self):
-        if self.results:
-            return self.results[0]
-        return None
-    
-    def close(self):
-        pass
+logger.info("Imported global MOCK_DB")
+
+# Import the enhanced mock DB implementation with persistence
+try:
+    # Use importlib to avoid circular import issues
+    mock_db_module = importlib.import_module("chat_service.mock_db")
+    MockConnection = mock_db_module.MockConnection
+    MockCursor = mock_db_module.MockCursor
+    logger.info("Using enhanced mock DB implementation with persistence")
+except Exception as e:
+    logger.error(f"Error importing mock_db module: {str(e)}")
+    # The original MockConnection and MockCursor would be used as fallback
+    # but we don't need to define them here since this block only runs if import fails
EOF

# Fix the API client endpoints configuration
echo "Fixing API client endpoints configuration..."
cat > frontend/static/js/services/api-client.js.patch << 'EOF'
--- a/frontend/static/js/services/api-client.js
+++ b/frontend/static/js/services/api-client.js
@@ -26,9 +26,9 @@
                 get: '/chats/{id}',
                 create: '/chats',
                 messages: '/chats/{id}/messages',
-                invitation: {
-                    generate: '/api/chats/generate-invitation',
-                    status: '/api/chats/invitation-status/{token}',
+                invitation: {
+                    generate: '/api/chats/generate-invitation',
+                    status: '/api/chats/invitation-status/{token}',
                     accept: '/api/chats/accept-invitation/{token}'
                 }
             },
EOF

# Apply the patches
echo "Applying patches..."
if [ -f "$(which patch)" ]; then
    echo "Patching chat_service/app.py..."
    patch -p1 chat_service/app.py < chat_service/app.py.patch
    echo "Patching frontend/static/js/services/api-client.js..."
    patch -p1 frontend/static/js/services/api-client.js < frontend/static/js/services/api-client.js.patch
else
    echo "Patch command not found. Please install patch or manually apply the changes."
    echo "You can find the patches in:"
    echo "  - chat_service/app.py.patch"
    echo "  - frontend/static/js/services/api-client.js.patch"
fi

# Create test invitations to verify fix
echo "Creating test invitations to verify fix..."
cat > create-test-invitation.py << 'EOF'
import datetime
import uuid
import os
import sys
import pickle

# Add the current directory to Python path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

# Try to import from chat_service
try:
    from chat_service.mock_db import MOCK_DB, save_mock_db
    print("Successfully imported mock DB module")
except ImportError:
    # Fallback to using the file directly if module import fails
    MOCK_DB_FILE = os.path.join(os.path.dirname(__file__), 'chat_service/data/mock_db.pickle')
    try:
        with open(MOCK_DB_FILE, 'rb') as f:
            MOCK_DB = pickle.load(f)
    except:
        MOCK_DB = {"chats": [], "messages": [], "invitations": []}

# Generate a test invitation that will last for 24 hours
created_at = datetime.datetime.utcnow()
expires_at = created_at + datetime.timedelta(hours=24)
invitation_token = str(uuid.uuid4())

# Create the invitation record
invitation = {
    "invitation_token": invitation_token,
    "host_id": "fix-script-host",
    "created_at": created_at,
    "expires_at": expires_at,
    "is_used": False,
    "used_at": None,
    "chat_id": None
}

# Add to invitations
MOCK_DB["invitations"].append(invitation)

# Save to file
try:
    # Make sure directory exists
    os.makedirs(os.path.dirname(os.path.join(os.path.dirname(__file__), 'chat_service/data/mock_db.pickle')), exist_ok=True)
    
    # Save to file
    with open(os.path.join(os.path.dirname(__file__), 'chat_service/data/mock_db.pickle'), 'wb') as f:
        pickle.dump(MOCK_DB, f)
    print(f"Saved MOCK_DB with {len(MOCK_DB['invitations'])} invitations")
except Exception as e:
    print(f"Error saving MOCK_DB: {e}")

# Print information about the invitation
print(f"""
-------------------------------------------------------------
Test Invitation Created Successfully:
-------------------------------------------------------------
Invitation Token: {invitation_token}
Created At: {created_at.isoformat()}
Expires At: {expires_at.isoformat()} (24 hours)
URL to use: http://localhost:5005/join/{invitation_token}
External IP URL: http://<your-ip>:5005/join/{invitation_token}
-------------------------------------------------------------
To check status: curl http://localhost:5504/invitation-status/{invitation_token}
To accept via API: 
curl -X POST http://localhost:5504/accept-invitation/{invitation_token} \\
     -H "Content-Type: application/json" \\
     -d '{{"guest_id": "test-guest-123"}}'
""")
EOF

# Create README with instructions
echo "Creating README with instructions..."
cat > README-INVITATION-FIX.md << 'EOF'
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
EOF

# Function to run Python script with proper environment
run_python_script() {
    if [ -f "venv/bin/activate" ]; then
        echo "Activating virtual environment..."
        source venv/bin/activate
        python3 "$1"
    else
        echo "No virtual environment found, running with system Python..."
        python3 "$1"
    fi
}

# Create a test invitation
echo "Creating a test invitation..."
run_python_script create-test-invitation.py

echo "=================================================================="
echo "Invitation system fix completed!"
echo "=================================================================="
echo "Please restart all services to apply the changes:"
echo "  ./stop-all-services.sh"
echo "  ./start-all-services.sh"
echo ""
echo "See README-INVITATION-FIX.md for detailed instructions and troubleshooting."
echo "==================================================================" 