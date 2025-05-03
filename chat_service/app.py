from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import uuid

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

# Routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "chat_service"}), 200

@app.route('/chats', methods=['GET'])
def get_chats():
    # This would normally query a database for all chats
    return jsonify({"chats": [], "message": "Chat service is operating normally"}), 200

@app.route('/chats/<chat_id>', methods=['GET'])
def get_chat(chat_id):
    # This would normally query a database for a specific chat
    return jsonify({"chat_id": chat_id, "messages": [], "message": "Chat retrieval successful"}), 200

@app.route('/chats', methods=['POST'])
def create_chat():
    # This would normally create a new chat in the database
    room_id = str(uuid.uuid4())
    qr_token = str(uuid.uuid4())
    
    return jsonify({
        "room_id": room_id,
        "qr_token": qr_token,
        "message": "Chat created successfully"
    }), 201

@app.route('/chats/<chat_id>/messages', methods=['GET'])
def get_chat_messages(chat_id):
    # This would normally query a database for chat messages
    # For now, return empty messages array
    return jsonify({
        "chat_id": chat_id,
        "messages": [],
        "message": "Messages retrieved successfully"
    }), 200

@app.route('/chats/<chat_id>/messages', methods=['POST'])
def add_message(chat_id):
    # This would normally add a message to a chat in the database
    return jsonify({"message_id": "new-message-id", "chat_id": chat_id, "message": "Message added successfully"}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5004, debug=True) 