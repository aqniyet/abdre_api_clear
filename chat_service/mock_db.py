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
            logger.info(f"Loaded MOCK_DB from {MOCK_DB_FILE} with {len(MOCK_DB['invitations'])} invitations and {len(MOCK_DB['chats'])} chats")
            
            # Log all chat IDs for debugging
            chat_ids = [chat['chat_id'] for chat in MOCK_DB['chats']]
            logger.info(f"Available chat IDs: {chat_ids}")
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
        logger.info(f"Saved MOCK_DB to {MOCK_DB_FILE} with {len(MOCK_DB['invitations'])} invitations and {len(MOCK_DB['chats'])} chats")
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
        logger.info(f"MockConnection using MOCK_DB with {len(MOCK_DB['invitations'])} invitations and {len(MOCK_DB['chats'])} chats")
        for inv in MOCK_DB["invitations"]:
            logger.info(f"  - Invitation: {inv['invitation_token']}")
        for chat in MOCK_DB["chats"]:
            logger.info(f"  - Chat: {chat['chat_id']}")
    
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
        
        elif "SELECT" in query and "FROM chats" in query:
            # Handling chat lookup
            if "WHERE chat_id" in query and params and len(params) == 1:
                chat_id = params[0]
                
                # Check if using alias with c.chat_id
                if "c.chat_id" in query:
                    # Query is using a table alias (c), handle it specially
                    logger.info(f"Handling aliased chat query for chat_id: {chat_id}")
                
                # Find the chat
                for chat in MOCK_DB["chats"]:
                    if chat["chat_id"] == chat_id:
                        self.results = [chat]
                        self.query_type = "select_chat"
                        logger.info(f"Found chat: {chat_id}")
                        break
                else:
                    logger.info(f"Chat not found: {chat_id}")
                    logger.info(f"Available chats: {[c['chat_id'] for c in MOCK_DB['chats']]}")
                    self.results = []
                
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
        
        # Special handling for messages
        elif "SELECT" in query and "FROM messages" in query:
            # Just return empty results for messages
            self.results = []
            self.query_type = "select_messages"
            logger.info(f"Handling messages query, returning empty results")
        
        # Handling for other queries (participants, etc.)
        else:
            self.results = []
            logger.info(f"Unsupported query type, returning empty results")
        
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
