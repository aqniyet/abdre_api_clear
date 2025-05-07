import datetime
import importlib
import json
import logging
import os
import uuid

import psycopg2
import psycopg2.extras
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
# Configure CORS
cors_allowed_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
CORS(app, origins=cors_allowed_origins)

# Configuration
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "abdre")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "postgres")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-key")
# Set default expiration time for invitation tokens to 30 minutes (in seconds)
INVITATION_EXPIRY = int(os.environ.get("INVITATION_EXPIRY", "1800"))

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Mock connection for development without DB
# Create a global dictionary to store invitations across requests
MOCK_DB = {
    "chats": [],
    "messages": [],
    "invitations": []
}
logger.info("Imported global MOCK_DB")

# Import the enhanced mock DB implementation with persistence
try:
    # Use importlib to avoid circular import issues
    mock_db_module = importlib.import_module("chat_service.mock_db")
    MockConnection = mock_db_module.MockConnection
    MockCursor = mock_db_module.MockCursor
    logger.info("Using enhanced mock DB implementation with persistence")
except Exception as e:
    logger.error(f"Error importing mock_db module: {str(e)}")
    
    # Define fallback MockConnection and MockCursor classes
    class MockConnection:
        def __init__(self):
            self.autocommit = True
            global MOCK_DB
            logger.info(f"Using fallback MockConnection with {len(MOCK_DB['invitations'])} invitations")
        
        def cursor(self, *args, **kwargs):
            return MockCursor(self)
        
        def close(self):
            pass
            
        def commit(self):
            pass
            
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
                if params and len(params) >= 5:
                    invitation_token = params[0]
                    host_id = params[1]
                    created_at = params[2]
                    expires_at = params[3]
                    is_used = params[4]
                    
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
                    self.results = [invitation]
                    
            elif "SELECT" in query and "FROM chat_invitations" in query:
                if "WHERE invitation_token" in query and params and len(params) == 1:
                    invitation_token = params[0]
                    for invitation in MOCK_DB["invitations"]:
                        if invitation["invitation_token"] == invitation_token:
                            self.results = [invitation]
                            logger.info(f"Found invitation: {invitation_token}")
                            break
                    else:
                        logger.info(f"Invitation not found: {invitation_token}")
                        self.results = []
                    
            elif "UPDATE chat_invitations" in query:
                if params and len(params) >= 2:
                    invitation_token = params[-1]
                    
                    for invitation in MOCK_DB["invitations"]:
                        if invitation["invitation_token"] == invitation_token:
                            invitation["is_used"] = True
                            
                            if "used_at" in query and len(params) >= 3:
                                invitation["used_at"] = params[0]
                                
                            if "chat_id" in query and len(params) >= 3:
                                invitation["chat_id"] = params[1]
                                
                            self.results = [invitation]
                            logger.info(f"Updated invitation: {invitation_token}")
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

# Ensure tables exist
def ensure_tables():
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Could not connect to database to create tables")
            return False
            
        # Skip table creation for mock connection
        if isinstance(conn, MockConnection):
            logger.info("Using mock connection - skipping table creation")
            return True

        cur = conn.cursor()

        # Create chats table if it doesn't exist
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS chats (
            chat_id VARCHAR(36) PRIMARY KEY,
            qr_token VARCHAR(36) UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
        )

        # Create messages table if it doesn't exist
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS messages (
            message_id VARCHAR(36) PRIMARY KEY,
            chat_id VARCHAR(36) NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            sender_id VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
        )

        # Create chat invitations table if it doesn't exist
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS chat_invitations (
            invitation_token VARCHAR(36) PRIMARY KEY,
            host_id VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            is_used BOOLEAN NOT NULL DEFAULT FALSE,
            used_at TIMESTAMP,
            chat_id VARCHAR(36) REFERENCES chats(chat_id) ON DELETE CASCADE
        )
        """
        )

        conn.commit()
        cur.close()
        conn.close()
        logger.info("Database tables initialized successfully")
        return True
    except Exception as e:
        logger.error(f"Error ensuring tables exist: {str(e)}")
        return False


# Initialize tables on startup
ensure_tables()


# Routes
@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "service": "chat_service"}), 200


@app.route("/chats", methods=["GET"])
def get_chats():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(
            "SELECT chat_id, qr_token, created_at FROM chats ORDER BY created_at DESC"
        )
        chats = [dict(chat) for chat in cur.fetchall()]

        cur.close()
        conn.close()

        return (
            jsonify({"chats": chats, "message": "Chat service is operating normally"}),
            200,
        )
    except Exception as e:
        logger.error(f"Error retrieving chats: {str(e)}")
        return jsonify({"chats": [], "message": "Error retrieving chats"}), 500


@app.route("/chats/<chat_id>", methods=["GET"])
def get_chat(chat_id):
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(
            "SELECT chat_id, qr_token, created_at FROM chats WHERE chat_id = %s",
            (chat_id,),
        )
        chat = cur.fetchone()

        if not chat:
            cur.close()
            conn.close()
            return jsonify({"error": "Chat not found"}), 404

        chat_dict = dict(chat)

        cur.close()
        conn.close()

        return jsonify(chat_dict), 200
    except Exception as e:
        logger.error(f"Error retrieving chat {chat_id}: {str(e)}")
        return jsonify({"error": "Error retrieving chat"}), 500


@app.route("/chats", methods=["POST"])
def create_chat():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        room_id = str(uuid.uuid4())
        qr_token = str(uuid.uuid4())

        cur = conn.cursor()
        cur.execute(
            "INSERT INTO chats (chat_id, qr_token) VALUES (%s, %s)", (room_id, qr_token)
        )

        conn.commit()
        cur.close()
        conn.close()

        return (
            jsonify(
                {
                    "room_id": room_id,
                    "qr_token": qr_token,
                    "message": "Chat created successfully",
                }
            ),
            201,
        )
    except Exception as e:
        logger.error(f"Error creating chat: {str(e)}")
        return jsonify({"error": "Error creating chat"}), 500


@app.route("/chats/<chat_id>/messages", methods=["GET", "OPTIONS"])
def get_chat_messages(chat_id):
    """Get messages for a specific chat room"""
    logger.info(
        f"GET /chats/{chat_id}/messages - Retrieving messages for chat: {chat_id} (method: {request.method})"
    )
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request args: {dict(request.args)}")

    # Handle OPTIONS request explicitly
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        logger.info(f"Returning OPTIONS response: {response.status_code}")
        logger.info(f"OPTIONS headers: {dict(response.headers)}")
        return response

    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Database connection failed when retrieving messages")
            return (
                jsonify(
                    {
                        "chat_id": chat_id,
                        "messages": [],
                        "message": "Database connection failed",
                    }
                ),
                200,
            )  # Return 200 to avoid frontend errors

        logger.info("Processing GET request for messages")

        # Retrieve messages from database
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(
            """
            SELECT message_id, chat_id, sender_id, content, created_at 
            FROM messages 
            WHERE chat_id = %s 
            ORDER BY created_at ASC
        """,
            (chat_id,),
        )

        messages = []
        for row in cur.fetchall():
            messages.append(
                {
                    "message_id": row["message_id"],
                    "room_id": row["chat_id"],
                    "sender_id": row["sender_id"],
                    "content": row["content"],
                    "created_at": (
                        row["created_at"].isoformat() if row["created_at"] else None
                    ),
                }
            )

        cur.close()
        conn.close()

        # Create response
        response_data = {
            "chat_id": chat_id,
            "messages": messages,
            "message": "Messages retrieved successfully",
        }
        logger.info(f"Returning {len(messages)} messages for chat {chat_id}")

        return jsonify(response_data), 200
    except Exception as e:
        logger.error(f"Error retrieving messages for chat {chat_id}: {str(e)}")
        return (
            jsonify(
                {
                    "chat_id": chat_id,
                    "messages": [],
                    "message": "Error retrieving messages",
                }
            ),
            200,
        )  # Return 200 to avoid frontend errors


@app.route("/chats/<chat_id>/messages", methods=["POST"])
def add_message(chat_id):
    """Add a new message to a chat room"""
    logger.info(f"POST /chats/{chat_id}/messages - Adding message to chat: {chat_id}")

    try:
        # Get request data
        data = request.get_json()
        logger.info(f"Message data: {data}")

        if not data or "message" not in data or not data["message"]:
            return (
                jsonify(
                    {
                        "error": "Missing message content",
                        "message": "Message content is required",
                    }
                ),
                400,
            )

        # Get sender_id from request
        sender_id = data.get("sender_id")
        if not sender_id:
            return (
                jsonify(
                    {"error": "Missing sender_id", "message": "Sender ID is required"}
                ),
                400,
            )

        # Generate a new message ID - ensure it's unique
        message_id = data.get("message_id", str(uuid.uuid4()))
        content = data.get("message", "")

        # Connect to database
        conn = get_db_connection()
        if not conn:
            logger.error("Database connection failed when adding message")
            return (
                jsonify(
                    {
                        "error": "Database connection failed",
                        "message": "Could not store message",
                    }
                ),
                500,
            )

        try:
            # Use a transaction to ensure atomicity
            cur = conn.cursor()

            # Check if the chat exists
            cur.execute("SELECT chat_id FROM chats WHERE chat_id = %s", (chat_id,))
            chat = cur.fetchone()

            if not chat:
                # Create the chat if it doesn't exist
                qr_token = str(uuid.uuid4())
                try:
                    cur.execute(
                        "INSERT INTO chats (chat_id, qr_token) VALUES (%s, %s)",
                        (chat_id, qr_token),
                    )
                    logger.info(f"Created new chat {chat_id} for message")
                except psycopg2.errors.UniqueViolation:
                    # In case of race condition - another request created the chat
                    conn.rollback()
                    logger.info(
                        f"Chat {chat_id} already exists (created by another request)"
                    )

            # Check if message with this ID already exists (idempotence check)
            cur.execute(
                "SELECT message_id FROM messages WHERE message_id = %s", (message_id,)
            )
            existing_message = cur.fetchone()

            if existing_message:
                logger.info(
                    f"Message {message_id} already exists in chat {chat_id}, skipping insertion"
                )
                # Return success despite not inserting - message was already saved
                return (
                    jsonify(
                        {
                            "message_id": message_id,
                            "chat_id": chat_id,
                            "content": content,
                            "sender_id": sender_id,
                            "timestamp": datetime.datetime.now().isoformat(),
                            "message": "Message already exists",
                        }
                    ),
                    200,
                )

            # Save message to database
            try:
                cur.execute(
                    "INSERT INTO messages (message_id, chat_id, sender_id, content) VALUES (%s, %s, %s, %s)",
                    (message_id, chat_id, sender_id, content),
                )
                conn.commit()
                logger.info(f"Message {message_id} saved to chat {chat_id}")
            except psycopg2.errors.ForeignKeyViolation:
                # Possible race condition where chat was deleted after our check
                conn.rollback()
                # Try to recreate the chat and insert again
                qr_token = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO chats (chat_id, qr_token) VALUES (%s, %s)",
                    (chat_id, qr_token),
                )
                cur.execute(
                    "INSERT INTO messages (message_id, chat_id, sender_id, content) VALUES (%s, %s, %s, %s)",
                    (message_id, chat_id, sender_id, content),
                )
                conn.commit()
                logger.info(
                    f"Recovered from race condition for message {message_id} in chat {chat_id}"
                )

        except Exception as e:
            # Handle specific database errors
            conn.rollback()
            logger.error(f"Database error saving message: {str(e)}")
            raise
        finally:
            # Make sure to clean up
            cur.close()
            conn.close()

        # Get current timestamp
        timestamp = datetime.datetime.now().isoformat()

        return (
            jsonify(
                {
                    "message_id": message_id,
                    "chat_id": chat_id,
                    "content": content,
                    "sender_id": sender_id,
                    "timestamp": timestamp,
                    "message": "Message added successfully",
                }
            ),
            201,
        )
    except Exception as e:
        logger.error(f"Error adding message to chat {chat_id}: {str(e)}")
        return jsonify({"error": "Failed to add message", "message": str(e)}), 500


# New endpoint for generating chat invitations
@app.route("/generate-invitation", methods=["POST"])
def generate_invitation():
    try:
        # Get the host user ID from the request
        data = request.get_json()
        if not data:
            logger.error("No JSON data in request")
            return jsonify({"error": "Missing request data"}), 400
            
        if "host_id" not in data:
            logger.error("Missing host_id in request data")
            return jsonify({"error": "Host ID is required"}), 400
        
        host_id = data["host_id"]
        logger.info(f"Generating invitation for host: {host_id}")
        
        # Generate a unique invitation token
        invitation_token = str(uuid.uuid4())
        
        # Calculate expiry time (default: 30 minutes from now)
        created_at = datetime.datetime.utcnow()
        expires_at = created_at + datetime.timedelta(seconds=INVITATION_EXPIRY)
        
        conn = get_db_connection()
        if not conn:
            logger.error("Failed to get database connection")
            return jsonify({"error": "Database connection failed"}), 500
        
        try:
            cur = conn.cursor()
            
            # Store the invitation in the database
            cur.execute(
                """
                INSERT INTO chat_invitations 
                (invitation_token, host_id, created_at, expires_at, is_used)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (invitation_token, host_id, created_at, expires_at, False)
            )
            
            conn.commit()
            
            # For mock connections, log more details
            if isinstance(conn, MockConnection):
                logger.info(f"Created mock invitation with token: {invitation_token}, expires at: {expires_at}")
            
            response_data = {
                "invitation_token": invitation_token,
                "host_id": host_id,
                "created_at": created_at.isoformat(),
                "expires_at": expires_at.isoformat(),
                "expiry_seconds": INVITATION_EXPIRY
            }
            
            logger.info(f"Invitation generated successfully: {invitation_token}")
            return jsonify(response_data), 201
            
        except Exception as e:
            logger.error(f"Database error while generating invitation: {str(e)}")
            return jsonify({"error": f"Database error: {str(e)}"}), 500
        finally:
            if cur:
                cur.close()
            if conn:
                conn.close()
        
    except Exception as e:
        logger.error(f"Error generating invitation: {str(e)}")
        return jsonify({"error": f"Error generating invitation: {str(e)}"}), 500


# Endpoint to validate and accept an invitation
@app.route("/accept-invitation/<invitation_token>", methods=["POST"])
def accept_invitation(invitation_token):
    try:
        # Get the guest user ID from the request
        data = request.get_json()
        if not data or "guest_id" not in data:
            return jsonify({"error": "Guest ID is required"}), 400
        
        guest_id = data["guest_id"]
        
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Check if the invitation exists and is valid
        cur.execute(
            """
            SELECT invitation_token, host_id, created_at, expires_at, is_used
            FROM chat_invitations
            WHERE invitation_token = %s
            """,
            (invitation_token,)
        )
        
        invitation = cur.fetchone()
        
        if not invitation:
            cur.close()
            conn.close()
            return jsonify({"error": "Invitation not found"}), 404
        
        invitation_dict = dict(invitation)
        
        # Check if the invitation is expired
        current_time = datetime.datetime.utcnow()
        if current_time > invitation_dict["expires_at"]:
            cur.close()
            conn.close()
            return jsonify({"error": "Invitation has expired"}), 400
        
        # Check if the invitation has already been used
        if invitation_dict["is_used"]:
            cur.close()
            conn.close()
            return jsonify({"error": "Invitation has already been used"}), 400
        
        # Create a new chat room
        room_id = str(uuid.uuid4())
        qr_token = str(uuid.uuid4())
        
        # Insert the new chat
        cur.execute(
            "INSERT INTO chats (chat_id, qr_token) VALUES (%s, %s)",
            (room_id, qr_token)
        )
        
        # Mark the invitation as used and link it to the chat
        cur.execute(
            """
            UPDATE chat_invitations
            SET is_used = TRUE, used_at = %s, chat_id = %s
            WHERE invitation_token = %s
            """,
            (current_time, room_id, invitation_token)
        )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            "chat_id": room_id,
            "host_id": invitation_dict["host_id"],
            "guest_id": guest_id,
            "created_at": current_time.isoformat(),
            "invitation_token": invitation_token,
            "message": "Invitation accepted successfully"
        }), 200
        
    except Exception as e:
        logger.error(f"Error accepting invitation: {str(e)}")
        return jsonify({"error": f"Error accepting invitation: {str(e)}"}), 500


# Endpoint to check invitation status
@app.route("/invitation-status/<invitation_token>", methods=["GET"])
def check_invitation_status(invitation_token):
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Check invitation status
        cur.execute(
            """
            SELECT invitation_token, host_id, created_at, expires_at, is_used, used_at, chat_id
            FROM chat_invitations
            WHERE invitation_token = %s
            """,
            (invitation_token,)
        )
        
        invitation = cur.fetchone()
        
        if not invitation:
            cur.close()
            conn.close()
            return jsonify({"error": "Invitation not found"}), 404
        
        invitation_dict = dict(invitation)
        
        # Convert datetime objects to strings for JSON serialization
        invitation_dict["created_at"] = invitation_dict["created_at"].isoformat()
        invitation_dict["expires_at"] = invitation_dict["expires_at"].isoformat()
        if invitation_dict["used_at"]:
            invitation_dict["used_at"] = invitation_dict["used_at"].isoformat()
        
        # Add status information
        current_time = datetime.datetime.utcnow()
        is_expired = current_time > invitation["expires_at"]
        
        invitation_dict["status"] = "expired" if is_expired else "used" if invitation["is_used"] else "valid"
        invitation_dict["seconds_remaining"] = max(0, int((invitation["expires_at"] - current_time).total_seconds())) if not is_expired else 0
        
        cur.close()
        conn.close()
        
        return jsonify(invitation_dict), 200
        
    except Exception as e:
        logger.error(f"Error checking invitation status: {str(e)}")
        return jsonify({"error": "Error checking invitation status"}), 500


# Cleanup job for expired invitations
@app.route("/cleanup-expired-invitations", methods=["POST"])
def cleanup_expired_invitations():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        cur = conn.cursor()
        
        # Delete expired and unused invitations
        current_time = datetime.datetime.utcnow()
        cur.execute(
            """
            DELETE FROM chat_invitations
            WHERE expires_at < %s AND is_used = FALSE
            RETURNING invitation_token
            """,
            (current_time,)
        )
        
        deleted_tokens = [row[0] for row in cur.fetchall()]
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            "message": f"Cleaned up {len(deleted_tokens)} expired invitations",
            "deleted_tokens": deleted_tokens
        }), 200
        
    except Exception as e:
        logger.error(f"Error cleaning up expired invitations: {str(e)}")
        return jsonify({"error": "Error cleaning up expired invitations"}), 500


def create_tables(conn):
    """Create database tables if they don't exist"""
    # Skip table creation for mock connection
    if isinstance(conn, MockConnection):
        logger.info("Skipping table creation for mock connection")
        return
        
    # Create tables using normal connection
    with conn.cursor() as cursor:
        # Create chats table
        cursor.execute(
            """
        CREATE TABLE IF NOT EXISTS chats (
            chat_id VARCHAR(36) PRIMARY KEY,
            qr_token VARCHAR(36) UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
        )

        # Create messages table if it doesn't exist
        cursor.execute(
            """
        CREATE TABLE IF NOT EXISTS messages (
            message_id VARCHAR(36) PRIMARY KEY,
            chat_id VARCHAR(36) NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            sender_id VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
        )

        # Create chat invitations table if it doesn't exist
        cursor.execute(
            """
        CREATE TABLE IF NOT EXISTS chat_invitations (
            invitation_token VARCHAR(36) PRIMARY KEY,
            host_id VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            is_used BOOLEAN NOT NULL DEFAULT FALSE,
            used_at TIMESTAMP,
            chat_id VARCHAR(36) REFERENCES chats(chat_id) ON DELETE CASCADE
        )
        """
        )

        conn.commit()


@app.route("/my-chats", methods=["GET"])
def get_my_chats():
    """Get chats for the current user"""
    user_id = request.headers.get("X-User-ID")
    
    if not user_id or user_id == "guest":
        logger.error("No valid user ID provided in X-User-ID header")
        return jsonify({"error": "Authentication required", "message": "Please login to view your conversations"}), 401
    
    logger.info(f"Getting chats for user: {user_id}")
    
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Database connection failed when retrieving user chats")
            return jsonify([]), 200  # Return empty list instead of error for better UX
        
        # Query to get chats where the user is a participant
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Check if participants table exists
        try:
            # First try to get chats from participants table
            cur.execute("""
                SELECT c.chat_id, c.created_at, c.title,
                       (
                           SELECT content 
                           FROM messages 
                           WHERE chat_id = c.chat_id 
                           ORDER BY created_at DESC 
                           LIMIT 1
                       ) as last_message,
                       (
                           SELECT created_at 
                           FROM messages 
                           WHERE chat_id = c.chat_id 
                           ORDER BY created_at DESC 
                           LIMIT 1
                       ) as last_activity,
                       (
                           SELECT COUNT(*) 
                           FROM messages 
                           WHERE chat_id = c.chat_id
                       ) as message_count,
                       (
                           SELECT COUNT(*) 
                           FROM participants 
                           WHERE chat_id = c.chat_id
                       ) as participant_count,
                       (
                           SELECT encrypted 
                           FROM chats 
                           WHERE chat_id = c.chat_id
                       ) as encrypted
                FROM chats c
                JOIN participants p ON c.chat_id = p.chat_id
                WHERE p.user_id = %s
                ORDER BY last_activity DESC NULLS LAST
            """, (user_id,))
        except (psycopg2.errors.UndefinedTable, psycopg2.errors.UndefinedColumn) as e:
            # If participants table doesn't exist or column is missing, fall back to using messages
            logger.warning(f"Participants table issue: {str(e)}, using messages to determine user's chats")
            conn.rollback()  # Clear the error state
            
            # Get chats where the user has sent messages
            cur.execute("""
                SELECT DISTINCT 
                       c.chat_id, 
                       c.created_at,
                       COALESCE(c.title, 'Chat ' || substring(c.chat_id, 1, 8)) as title,
                       (
                           SELECT content 
                           FROM messages 
                           WHERE chat_id = c.chat_id 
                           ORDER BY created_at DESC 
                           LIMIT 1
                       ) as last_message,
                       (
                           SELECT created_at 
                           FROM messages 
                           WHERE chat_id = c.chat_id 
                           ORDER BY created_at DESC 
                           LIMIT 1
                       ) as last_message_time,
                       (
                           SELECT COUNT(*) 
                           FROM messages 
                           WHERE chat_id = c.chat_id
                       ) as message_count,
                       (
                           SELECT COUNT(DISTINCT sender_id) 
                           FROM messages 
                           WHERE chat_id = c.chat_id
                       ) as participant_count
                FROM chats c
                JOIN messages m ON c.chat_id = m.chat_id
                WHERE m.sender_id = %s
                   OR c.chat_id IN (
                      SELECT DISTINCT chat_id 
                      FROM messages 
                      WHERE chat_id IN (
                         SELECT chat_id 
                         FROM messages 
                         WHERE sender_id = %s
                      )
                   )
                GROUP BY c.chat_id
                ORDER BY MAX(m.created_at) DESC
            """, (user_id, user_id))
        
        user_chats = []
        for row in cur.fetchall():
            try:
                # Format the dates safely
                if row.get('last_activity') and isinstance(row['last_activity'], datetime.datetime):
                    last_activity = row['last_activity'].isoformat()
                elif row.get('last_message_time') and isinstance(row['last_message_time'], datetime.datetime):
                    last_activity = row['last_message_time'].isoformat()
                else:
                    last_activity = None
                    
                if row.get('created_at') and isinstance(row['created_at'], datetime.datetime):
                    created_at = row['created_at'].isoformat()
                else:
                    created_at = None
                
                # Get recipient information
                recipient_name = None
                recipient_status = "offline"
                recipient_avatar = None
                
                try:
                    # Try to get the recipient (other participant) info
                    if row.get('chat_id'):
                        # Query the messages to identify a user other than current user
                        get_recipient_sql = """
                            SELECT DISTINCT sender_id 
                            FROM messages 
                            WHERE chat_id = %s AND sender_id != %s 
                            LIMIT 1
                        """
                        cur.execute(get_recipient_sql, (row['chat_id'], user_id))
                        recipient_row = cur.fetchone()
                        
                        if recipient_row and recipient_row['sender_id']:
                            recipient_name = recipient_row['sender_id']
                            # In a real implementation, you would query user info service
                except Exception as recipient_err:
                    logger.error(f"Error getting recipient info: {str(recipient_err)}")
                
                # Create a standard chat object with all the expected fields
                chat_data = {
                    "id": row["chat_id"],
                    "title": row.get("title", f"Chat {row['chat_id'].split('-')[0]}"),
                    "last_message": row.get("last_message"),
                    "last_message_time": last_activity,
                    "message_count": row.get("message_count", 0),
                    "created_at": created_at,
                    "participant_count": row.get("participant_count", 2),
                    "encrypted": row.get("encrypted", False),
                    "recipient_name": recipient_name,
                    "recipient_status": recipient_status,
                    "recipient_avatar": recipient_avatar
                }
                
                user_chats.append(chat_data)
            except Exception as inner_e:
                # Log but continue processing other chats
                logger.error(f"Error formatting chat {row.get('chat_id')}: {str(inner_e)}")
        
        cur.close()
        conn.close()
        
        logger.info(f"Returning {len(user_chats)} chats for user {user_id}")
        return jsonify(user_chats), 200
        
    except Exception as e:
        logger.error(f"Error retrieving chats for user {user_id}: {str(e)}")
        return jsonify([]), 200  # Return empty list instead of error for better UX


# Database connection function
def get_db_connection():
    if os.environ.get("MOCK_DB", "false").lower() == "true":
        # For development, return mock connection
        logger.warning("Using mock database connection")
        return MockConnection()
    
    try:
        conn = psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        conn.autocommit = True
        logger.info("Database connection established")
        
        # Create tables if they don't exist
        try:
            create_tables(conn)
            logger.info("Database tables created or already exist")
        except Exception as e:
            logger.error(f"Could not create tables: {str(e)}")
        return conn
    except Exception as e:
        logger.error(f"Database connection error: {str(e)}")
        logger.error("Could not connect to database to create tables")
        if os.environ.get("FLASK_ENV") == "development":
            logger.warning("Running in development mode without database connection")
            return MockConnection()
        return None


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5004)), debug=False)
