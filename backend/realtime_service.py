"""
ABDRE Chat Realtime Service
Provides WebSocket/Socket.IO server for real-time communication
"""

import os
import sys
import logging
import json
import uuid
import time
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import jwt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_key_for_development_only')

# JWT Secret key - should match the one in auth_middleware
JWT_SECRET = 'your-secret-key-here'  # In production, use env var

# Initialize Socket.IO
socketio = SocketIO(
    app, 
    cors_allowed_origins="*", 
    json=json,
    async_mode='threading',
    path='/socket.io'
)

# Active client connections
active_clients = {}

# Map of username to socket ID
user_sockets = {}

# Map of chat rooms and their participants
chat_rooms = {}

# Status map: user_id -> status
user_status = {}

@app.route('/health')
def health_check():
    """Health check endpoint for the realtime service"""
    return {'status': 'healthy', 'service': 'realtime'}

@app.route('/socket.io-test')
def socket_io_test():
    return jsonify({
        "status": "success",
        "message": "Socket.IO server is running",
        "mode": socketio.async_mode
    })

@app.route('/logs/client-error', methods=['POST'])
def log_client_error():
    """Endpoint to log client-side errors"""
    try:
        error_data = request.json
        logger.error(f"Client Error: {json.dumps(error_data)}")
        return jsonify({"status": "success", "message": "Error logged"})
    except Exception as e:
        logger.error(f"Error logging client error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/logs/file-log', methods=['POST'])
def log_client_file():
    """Endpoint to log client-side file logs"""
    try:
        log_data = request.json
        logger.info(f"Client Log: {json.dumps(log_data)}")
        return jsonify({"status": "success", "message": "Log recorded"})
    except Exception as e:
        logger.error(f"Error recording file log: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

def authenticate_token(token):
    """
    Authenticate JWT token and return user info
    
    Args:
        token (str): JWT token
        
    Returns:
        dict: User info from token or None if invalid
    """
    if not token:
        return None
    
    # For testing/debugging, accept "guest" token
    if token == 'guest':
        return {
            'user_id': f'guest_{str(uuid.uuid4())}',
            'username': 'Guest',
            'is_guest': True
        }
        
    try:
        # Remove Bearer prefix if present
        if token.startswith('Bearer '):
            token = token[7:]
            
        # Decode token
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        
        # Guest token handling
        if payload.get('is_guest', False):
            return {
                'visitor_id': payload.get('visitor_id'),
                'is_guest': True,
                'user_id': 'guest_' + payload.get('visitor_id', str(uuid.uuid4())),
                'username': 'Guest'
            }
            
        # Regular user token
        return {
            'user_id': payload.get('user_id'),
            'username': payload.get('username'),
            'is_authenticated': True
        }
        
    except jwt.ExpiredSignatureError:
        logger.error('Token expired')
        return None
    except jwt.InvalidTokenError as e:
        logger.error(f'Invalid token: {str(e)}')
        return None
    except Exception as e:
        logger.error(f'Token authentication error: {str(e)}')
        return None

@socketio.on('connect')
def handle_connect():
    client_id = str(uuid.uuid4())
    active_clients[client_id] = {
        'sid': request.sid,
        'authenticated': False,
        'user_id': None,
        'connected_at': time.time(),
        'rooms': []
    }
    
    logger.info(f"Client connected: {request.sid}, total clients: {len(active_clients)}")
    
    # Send welcome message
    emit('connection_status', {
        'status': 'connected',
        'client_id': client_id, 
        'server_time': time.time(),
        'active_connections': len(active_clients),
        'server_load': 'normal'
    })

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    client_id = request.sid
    
    if client_id in active_clients:
        client = active_clients[client_id]
        user_id = client.get('user_id')
        
        # Remove from user socket mapping
        if user_id in user_sockets and user_sockets[user_id] == client_id:
            del user_sockets[user_id]
        
        # Leave all rooms and notify other participants
        rooms = list(client.get('rooms', set()))
        for room in rooms:
            if room in chat_rooms and user_id in chat_rooms[room]:
                chat_rooms[room].remove(user_id)
                
                # Notify others in room
                emit('user_offline', {
                    'user_id': user_id,
                    'username': client.get('username'),
                    'timestamp': time.time()
                }, room=room)
        
        # Set user status to offline
        user_status[user_id] = 'offline'
        
        # Remove from active clients
        del active_clients[client_id]
        
        logger.info(f'Client disconnected: {client_id}')

@socketio.on('join')
def handle_join(data):
    """
    Handle room join
    
    Args:
        data (dict): Data containing room ID
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        logger.warning(f'Unauthorized join attempt: {client_id}')
        emit('error', {'message': 'Unauthorized'})
        return
    
    # Get room info
    room_id = data.get('room')
    if not room_id:
        emit('error', {'message': 'Room ID required'})
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Join room
    join_room(room_id)
    
    # Add to client's rooms
    client['rooms'].add(room_id)
    
    # Add to chat room participants
    if room_id not in chat_rooms:
        chat_rooms[room_id] = set()
    chat_rooms[room_id].add(user_id)
    
    logger.info(f'Client {client_id} joined room {room_id}')
    
    # Notify client
    emit('join_success', {
        'room': room_id,
        'user_id': user_id
    })
    
    # Notify others in room
    emit('user_joined', {
        'user_id': user_id,
        'username': client.get('username'),
        'timestamp': time.time()
    }, room=room_id, include_self=False)

@socketio.on('leave')
def handle_leave(data):
    """
    Handle room leave
    
    Args:
        data (dict): Data containing room ID
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        logger.warning(f'Unauthorized leave attempt: {client_id}')
        return
    
    # Get room info
    room_id = data.get('room')
    if not room_id:
        emit('error', {'message': 'Room ID required'})
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Leave room
    leave_room(room_id)
    
    # Remove from client's rooms
    if room_id in client['rooms']:
        client['rooms'].remove(room_id)
    
    # Remove from chat room participants
    if room_id in chat_rooms and user_id in chat_rooms[room_id]:
        chat_rooms[room_id].remove(user_id)
    
    logger.info(f'Client {client_id} left room {room_id}')
    
    # Notify others in room
    emit('user_left', {
        'user_id': user_id,
        'timestamp': time.time()
    }, room=room_id)

@socketio.on('chat_message')
def handle_message(data):
    """
    Handle chat message
    
    Args:
        data (dict): Message data
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        emit('error', {'message': 'Unauthorized'})
        return
    
    # Get message info
    room_id = data.get('room')
    content = data.get('content')
    
    if not room_id or not content:
        emit('error', {'message': 'Room ID and content required'})
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Validate user is in the room
    if room_id not in client.get('rooms', set()):
        emit('error', {'message': 'You are not in this room'})
        return
    
    # Create message object
    message_id = f"msg_{str(uuid.uuid4())}"
    message = {
        'id': message_id,
        'room': room_id,
        'sender': user_id,
        'sender_name': client.get('username'),
        'content': content,
        'timestamp': time.time()
    }
    
    # Send to room
    emit('chat_message', message, room=room_id)
    
    # Send unread count update to all recipients except sender
    if room_id in chat_rooms:
        for recipient_id in chat_rooms[room_id]:
            # Skip sender
            if recipient_id == user_id:
                continue
                
            # Get recipient socket
            if recipient_id in user_sockets:
                recipient_socket = user_sockets[recipient_id]
                
                # Send unread count update
                emit('unread_count_update', {
                    'count': 1,  # Increment by 1
                    'increment': True,  # Signal this is an increment
                    'chats': {
                        room_id: {
                            'count': 1,
                            'increment': True,
                            'last_message': {
                                'id': message_id,
                                'sender': user_id,
                                'content': content,
                                'timestamp': time.time()
                            }
                        }
                    }
                }, room=recipient_socket)
    
    logger.info(f'Message sent in room {room_id} by {user_id}')
    
    # Acknowledge receipt to sender
    emit('message_sent', {
        'success': True,
        'message_id': message_id,
        'timestamp': time.time()
    })

@socketio.on('typing')
def handle_typing(data):
    """
    Handle typing indicator
    
    Args:
        data (dict): Typing indicator data
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        return
    
    # Get info
    room_id = data.get('room')
    is_typing = data.get('typing', True)
    
    if not room_id:
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Send to room except sender
    emit('typing', {
        'user_id': user_id,
        'typing': is_typing,
        'timestamp': time.time()
    }, room=room_id, include_self=False)

@socketio.on('read_receipt')
def handle_read_receipt(data):
    """
    Handle read receipt
    
    Args:
        data (dict): Read receipt data
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        return
    
    # Get info
    room_id = data.get('room')
    message_ids = data.get('message_ids', [])
    
    if not room_id:
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Validate user is in the room
    if room_id not in client.get('rooms', set()):
        return
    
    # Send read receipt to everyone in the room
    emit('read_receipt', {
        'user_id': user_id,
        'room': room_id,
        'message_ids': message_ids,
        'timestamp': time.time()
    }, room=room_id)
    
    # Also update unread count for this user
    # In a real system, this would decrease the counts
    emit('unread_count_update', {
        'count': 0,  # Cleared for this room
        'chat': {
            room_id: {
                'count': 0,
                'last_read_at': time.time()
            }
        }
    }, room=client_id)

@socketio.on('unread_count')
def handle_unread_count():
    """
    Send unread message count to requesting user
    This can be called when client connects to get initial counts
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # In a real implementation, this would query a database
    # For this demo, we'll send a random count
    # This simulates the initial count when a user connects
    
    # Generate sample data for rooms the user is in
    unread_data = {}
    total_count = 0
    
    for room in client.get('rooms', set()):
        # Random count between 0-3 for demo
        count = min(int(time.time() % 4), 3)
        if count > 0:
            unread_data[room] = {
                'count': count,
                'last_message_at': time.time() - (count * 60)  # Older with more messages
            }
            total_count += count
    
    # Send to the client
    emit('unread_count_update', {
        'count': total_count,
        'chats': unread_data,
        'updated_at': time.time()
    }, room=client_id)

@socketio.on('user_status')
def handle_user_status(data):
    """
    Handle user status update
    
    Args:
        data (dict): Status data
    """
    client_id = request.sid
    
    if client_id not in active_clients:
        return
    
    # Get info
    status = data.get('status')
    
    if not status:
        return
    
    client = active_clients[client_id]
    user_id = client.get('user_id')
    
    # Update status
    user_status[user_id] = status
    
    # Send to all rooms the user is in
    for room in client.get('rooms', set()):
        emit('user_status', {
            'user_id': user_id,
            'status': status,
            'timestamp': time.time()
        }, room=room)

@socketio.on('ping')
def handle_ping(data):
    """
    Handle ping from client
    
    Args:
        data (dict): Ping data
    """
    # Return a pong with the current timestamp
    emit('pong', {
        'timestamp': time.time(),
        'server_time': time.time(),
        'client_time': data.get('timestamp')
    })

@socketio.on('error')
def handle_error(data):
    """
    Handle error from client
    
    Args:
        data (dict): Error data
    """
    client_id = request.sid
    logger.error(f'Error from client {client_id}: {data}')

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    logger.info(f'Starting ABDRE Chat Realtime Service on {host}:{port}, debug={debug}')
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True) 