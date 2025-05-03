from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import uuid
import logging
import datetime
import psycopg2
import psycopg2.extras

app = Flask(__name__)
# Configure CORS
cors_allowed_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*').split(',')
CORS(app, origins=cors_allowed_origins)

# Configuration
DB_HOST = os.environ.get('DB_HOST', 'localhost')
DB_PORT = os.environ.get('DB_PORT', '5432')
DB_NAME = os.environ.get('DB_NAME', 'abdre')
DB_USER = os.environ.get('DB_USER', 'postgres')
DB_PASSWORD = os.environ.get('DB_PASSWORD', 'postgres')
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-key')

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database connection function
def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"Database connection error: {str(e)}")
        return None

# Ensure tables exist
def ensure_tables():
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Could not connect to database to create tables")
            return False
        
        cur = conn.cursor()
        
        # Create chats table if it doesn't exist
        cur.execute("""
        CREATE TABLE IF NOT EXISTS chats (
            chat_id VARCHAR(36) PRIMARY KEY,
            qr_token VARCHAR(36) UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create messages table if it doesn't exist
        cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            message_id VARCHAR(36) PRIMARY KEY,
            chat_id VARCHAR(36) NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            sender_id VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
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
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "chat_service"}), 200

@app.route('/chats', methods=['GET'])
def get_chats():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("SELECT chat_id, qr_token, created_at FROM chats ORDER BY created_at DESC")
        chats = [dict(chat) for chat in cur.fetchall()]
        
        cur.close()
        conn.close()
        
        return jsonify({"chats": chats, "message": "Chat service is operating normally"}), 200
    except Exception as e:
        logger.error(f"Error retrieving chats: {str(e)}")
        return jsonify({"chats": [], "message": "Error retrieving chats"}), 500

@app.route('/chats/<chat_id>', methods=['GET'])
def get_chat(chat_id):
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("SELECT chat_id, qr_token, created_at FROM chats WHERE chat_id = %s", (chat_id,))
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

@app.route('/chats', methods=['POST'])
def create_chat():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
        
        room_id = str(uuid.uuid4())
        qr_token = str(uuid.uuid4())
        
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO chats (chat_id, qr_token) VALUES (%s, %s)",
            (room_id, qr_token)
        )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            "room_id": room_id,
            "qr_token": qr_token,
            "message": "Chat created successfully"
        }), 201
    except Exception as e:
        logger.error(f"Error creating chat: {str(e)}")
        return jsonify({"error": "Error creating chat"}), 500

@app.route('/chats/<chat_id>/messages', methods=['GET', 'OPTIONS'])
def get_chat_messages(chat_id):
    """Get messages for a specific chat room"""
    logger.info(f"GET /chats/{chat_id}/messages - Retrieving messages for chat: {chat_id} (method: {request.method})")
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request args: {dict(request.args)}")
    
    # Handle OPTIONS request explicitly
    if request.method == 'OPTIONS':
        response = app.make_default_options_response()
        logger.info(f"Returning OPTIONS response: {response.status_code}")
        logger.info(f"OPTIONS headers: {dict(response.headers)}")
        return response
    
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("Database connection failed when retrieving messages")
            return jsonify({
                "chat_id": chat_id,
                "messages": [],
                "message": "Database connection failed"
            }), 200  # Return 200 to avoid frontend errors
        
        logger.info("Processing GET request for messages")
        
        # Retrieve messages from database
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("""
            SELECT message_id, chat_id, sender_id, content, created_at 
            FROM messages 
            WHERE chat_id = %s 
            ORDER BY created_at ASC
        """, (chat_id,))
        
        messages = []
        for row in cur.fetchall():
            messages.append({
                "message_id": row["message_id"],
                "room_id": row["chat_id"],
                "sender_id": row["sender_id"],
                "content": row["content"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None
            })
        
        cur.close()
        conn.close()
        
        # Create response
        response_data = {
            "chat_id": chat_id,
            "messages": messages,
            "message": "Messages retrieved successfully"
        }
        logger.info(f"Returning {len(messages)} messages for chat {chat_id}")
        
        return jsonify(response_data), 200
    except Exception as e:
        logger.error(f"Error retrieving messages for chat {chat_id}: {str(e)}")
        return jsonify({
            "chat_id": chat_id,
            "messages": [],
            "message": "Error retrieving messages"
        }), 200  # Return 200 to avoid frontend errors

@app.route('/chats/<chat_id>/messages', methods=['POST'])
def add_message(chat_id):
    """Add a new message to a chat room"""
    logger.info(f"POST /chats/{chat_id}/messages - Adding message to chat: {chat_id}")
    
    try:
        # Get request data
        data = request.get_json()
        logger.info(f"Message data: {data}")
        
        if not data or 'message' not in data or not data['message']:
            return jsonify({
                "error": "Missing message content",
                "message": "Message content is required"
            }), 400
            
        # Get sender_id from request
        sender_id = data.get('sender_id')
        if not sender_id:
            return jsonify({
                "error": "Missing sender_id",
                "message": "Sender ID is required"
            }), 400
        
        # Generate a new message ID - ensure it's unique
        message_id = data.get('message_id', str(uuid.uuid4()))
        content = data.get('message', '')
        
        # Connect to database
        conn = get_db_connection()
        if not conn:
            logger.error("Database connection failed when adding message")
            return jsonify({
                "error": "Database connection failed",
                "message": "Could not store message"
            }), 500
        
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
                        (chat_id, qr_token)
                    )
                    logger.info(f"Created new chat {chat_id} for message")
                except psycopg2.errors.UniqueViolation:
                    # In case of race condition - another request created the chat
                    conn.rollback()
                    logger.info(f"Chat {chat_id} already exists (created by another request)")
            
            # Check if message with this ID already exists (idempotence check)
            cur.execute("SELECT message_id FROM messages WHERE message_id = %s", (message_id,))
            existing_message = cur.fetchone()
            
            if existing_message:
                logger.info(f"Message {message_id} already exists in chat {chat_id}, skipping insertion")
                # Return success despite not inserting - message was already saved
                return jsonify({
                    "message_id": message_id,
                    "chat_id": chat_id, 
                    "content": content,
                    "sender_id": sender_id,
                    "timestamp": datetime.datetime.now().isoformat(),
                    "message": "Message already exists"
                }), 200
            
            # Save message to database
            try:
                cur.execute(
                    "INSERT INTO messages (message_id, chat_id, sender_id, content) VALUES (%s, %s, %s, %s)",
                    (message_id, chat_id, sender_id, content)
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
                    (chat_id, qr_token)
                )
                cur.execute(
                    "INSERT INTO messages (message_id, chat_id, sender_id, content) VALUES (%s, %s, %s, %s)",
                    (message_id, chat_id, sender_id, content)
                )
                conn.commit()
                logger.info(f"Recovered from race condition for message {message_id} in chat {chat_id}")
                
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
        
        return jsonify({
            "message_id": message_id,
            "chat_id": chat_id,
            "content": content,
            "sender_id": sender_id,
            "timestamp": timestamp,
            "message": "Message added successfully"
        }), 201
    except Exception as e:
        logger.error(f"Error adding message to chat {chat_id}: {str(e)}")
        return jsonify({
            "error": "Failed to add message",
            "message": str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5004, debug=True) 