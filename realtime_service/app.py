from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
import os
import json
import jwt
import datetime

app = Flask(__name__)

# Configure CORS
cors_allowed_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*').split(',')
CORS(app, origins=cors_allowed_origins)

# Initialize Socket.IO with CORS support
socketio = SocketIO(app, 
                    cors_allowed_origins=cors_allowed_origins,
                    path='/socket.io',
                    async_mode='eventlet',
                    logger=True,
                    engineio_logger=True)

# Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-key')
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = os.environ.get('REDIS_PORT', '6379')

# Connected clients
connected_clients = {}

# Helper function to verify JWT token
def verify_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return None

# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    token = request.args.get('token') or (request.headers.get('Authorization', '').replace('Bearer ', '') if 'Authorization' in request.headers else None)
    
    if not token:
        return False  # Reject connection
    
    user_data = verify_token(token)
    if not user_data:
        return False  # Reject connection
    
    user_id = user_data.get('user_id')
    connected_clients[request.sid] = {
        'user_id': user_id,
        'rooms': []
    }
    
    return True

@socketio.on('disconnect')
def handle_disconnect():
    client = connected_clients.get(request.sid)
    if client:
        # Notify all rooms that user has left
        for room_id in client['rooms']:
            emit('user_away', {
                'room_id': room_id,
                'visitor_id': client['user_id']
            }, to=room_id)
        
        # Remove client from tracking
        del connected_clients[request.sid]

@socketio.on('join')
def handle_join(data):
    client = connected_clients.get(request.sid)
    if not client:
        return
    
    room_id = data.get('room_id')
    visitor_id = data.get('visitor_id')
    
    # Validate that the visitor_id matches the authenticated user or has permission
    if visitor_id != client['user_id']:
        # In production, check if user has permission to impersonate
        return
    
    # Add client to room
    join_room(room_id)
    
    # Track room in client data
    if room_id not in client['rooms']:
        client['rooms'].append(room_id)
    
    # Notify room of user joining
    emit('join', {
        'room_id': room_id,
        'visitor_id': visitor_id
    }, to=room_id)

@socketio.on('message')
def handle_message(data):
    client = connected_clients.get(request.sid)
    if not client:
        return
    
    room_id = data.get('room_id')
    message = data.get('message', '')
    
    # Ensure client is in the room
    if room_id not in client['rooms']:
        return
    
    # Broadcast message to room
    message_data = {
        'room_id': room_id,
        'sender_id': client['user_id'],
        'content': message,
        'timestamp': data.get('timestamp')
    }
    
    emit('message', message_data, to=room_id)

@socketio.on('user_active')
def handle_user_active(data):
    client = connected_clients.get(request.sid)
    if not client:
        return
    
    room_id = data.get('room_id')
    
    # Ensure client is in the room
    if room_id not in client['rooms']:
        return
    
    # Notify room that user is active
    emit('user_active', {
        'room_id': room_id,
        'visitor_id': client['user_id']
    }, to=room_id)

@socketio.on('user_away')
def handle_user_away(data):
    client = connected_clients.get(request.sid)
    if not client:
        return
    
    room_id = data.get('room_id')
    
    # Ensure client is in the room
    if room_id not in client['rooms']:
        return
    
    # Notify room that user is away
    emit('user_away', {
        'room_id': room_id,
        'visitor_id': client['user_id']
    }, to=room_id)

@socketio.on('ping')
def handle_ping(data):
    """Handle ping requests for connection testing"""
    client = connected_clients.get(request.sid)
    if not client:
        return
    
    print(f"Ping received from client {request.sid}, user {client['user_id']}")
    
    # Send a pong response back to the client
    emit('pong', {
        'timestamp': datetime.datetime.utcnow().isoformat(),
        'received_ping': data.get('timestamp', '')
    })

# HTTP Routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "realtime_service"}), 200

@app.route('/connections', methods=['GET'])
def get_connections():
    # Return information about active connections
    return jsonify({
        "active_connections": len(connected_clients),
        "message": "Realtime service is operating normally"
    }), 200

@app.route('/test-broadcast', methods=['POST'])
def test_broadcast():
    """Test endpoint to broadcast a message to all connected clients"""
    data = request.get_json()
    message = data.get('message', 'Test message')
    room = data.get('room')
    
    if room:
        # Broadcast to specific room
        socketio.emit('message', {
            'room_id': room,
            'sender_id': 'system',
            'content': message,
            'timestamp': datetime.datetime.utcnow().isoformat()
        }, to=room)
        return jsonify({"success": True, "message": f"Message broadcast to room {room}"})
    else:
        # Broadcast to all clients
        socketio.emit('message', {
            'sender_id': 'system',
            'content': message,
            'timestamp': datetime.datetime.utcnow().isoformat()
        })
        return jsonify({"success": True, "message": "Message broadcast to all clients"})

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5006, debug=True, allow_unsafe_werkzeug=True) 