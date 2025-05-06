#!/bin/bash

# Stop existing realtime service
pkill -f "python3 realtime_service/app_fixed" || true

# Create a fixed version of the app with proper indentation
cat > realtime_service/app_fixed_qr.py << 'EOF'
"""
Realtime Service for Abdre Chat
Provides real-time communication capabilities using Socket.IO
Modified for Python 3.12 compatibility
"""

import os
import uuid
import logging
from datetime import datetime
import requests

# Import Flask and related libraries
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms, disconnect

# Import shared modules
import jwt as PyJWT

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get environment variables
IS_DEVELOPMENT = os.environ.get("FLASK_ENV", "development") == "development"

# Configure Socket.IO - Don't use eventlet for Python 3.12 compatibility
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    logger=IS_DEVELOPMENT,
    engineio_logger=IS_DEVELOPMENT,
    ping_timeout=60,
    ping_interval=25,
    async_mode='threading'  # Use threading mode instead of eventlet
)

# Get JWT secret from environment
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-key")
CHAT_SERVICE_URL = os.environ.get("CHAT_SERVICE_URL", "http://localhost:5504")

# User tracking
connected_clients = {}  # sid -> user data
room_participants = {}  # room_id -> set of sids
user_rooms = {}  # user_id -> set of room_ids

# Helper function to verify JWT token
def verify_token(token):
    if not token or token == "guest":
        return None

    try:
        return PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])
    except PyJWT.exceptions.ExpiredSignatureError:
        logger.warning("Token expired")
        return None
    except PyJWT.exceptions.InvalidTokenError:
        logger.warning("Invalid token")
        return None
    except Exception as e:
        logger.error(f"Unexpected error verifying token: {str(e)}")
        return None

# Socket.IO event handlers
@socketio.on("connect")
def handle_connect():
    sid = request.sid
    logger.info(f"Connection attempt from {sid}")
    token = None

    # Enhanced token extraction from multiple sources
    try:
        # 1. Check auth data in Socket.IO handshake
        if hasattr(request, "args") and request.args.get("token"):
            token = request.args.get("token")
            logger.info(f"Token found in request args")
        # 2. Check auth data in Socket.IO headers
        elif hasattr(request, "headers") and request.headers.get("Authorization"):
            auth_header = request.headers.get("Authorization")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
                logger.info(f"Token found in Authorization header")
        # 3. Check query parameters in handshake
        elif hasattr(request, "environ") and "QUERY_STRING" in request.environ:
            qs = request.environ["QUERY_STRING"]
            if "token=" in qs:
                token = qs.split("token=")[1].split("&")[0]
                logger.info(f"Token found in query string")
    except Exception as e:
        logger.error(f"Error extracting token: {str(e)}")

    # Guest connection if no token or token is literally 'guest'
    if not token or token == "guest":
        logger.info(f"No valid token found, allowing connection as guest")
        user_id = f"guest-{sid[:8]}"
        connected_clients[sid] = {
            "user_id": user_id,
            "rooms": [],
            "connected_at": datetime.utcnow().isoformat(),
            "client_info": {
                "ip": (
                    request.remote_addr
                    if hasattr(request, "remote_addr")
                    else "unknown"
                ),
                "transport": (
                    request.environ.get("wsgi.url_scheme", "unknown")
                    if hasattr(request, "environ")
                    else "unknown"
                ),
            },
        }
        return True

    # Verify token and extract user data
    user_data = verify_token(token)
    if not user_data:
        logger.warning(f"Invalid token, allowing connection as guest")
        user_id = f"guest-{sid[:8]}"
        connected_clients[sid] = {
            "user_id": user_id,
            "rooms": [],
            "connected_at": datetime.utcnow().isoformat(),
            "auth_status": "invalid_token",
        }
        return True

    # Successful authentication
    user_id = user_data.get("user_id")
    logger.info(f"User {user_id} connected with session ID {sid}")

    connected_clients[sid] = {
        "user_id": user_id,
        "rooms": [],
        "connected_at": datetime.utcnow().isoformat(),
        "auth_status": "authenticated",
        "client_info": {
            "ip": request.remote_addr if hasattr(request, "remote_addr") else "unknown",
            "transport": (
                request.environ.get("wsgi.url_scheme", "unknown")
                if hasattr(request, "environ")
                else "unknown"
            ),
        },
    }

    # Notify all rooms with active conversations that user is back
    for sid, client in connected_clients.items():
        if client.get("user_id") == user_id and client.get("rooms"):
            for room_id in client.get("rooms", []):
                emit(
                    "user_active", 
                    {"room_id": room_id, "user_id": user_id}, 
                    to=room_id
                )

    return True


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    client = connected_clients.get(sid)
    if client:
        logger.info(f"User {client['user_id']} disconnected")
        try:
            # Notify all rooms that user has left
            for room_id in client["rooms"]:
                emit(
                    "user_away",
                    {"room_id": room_id, "user_id": client["user_id"]},
                    to=room_id,
                )

            # Remove client from tracking
            del connected_clients[sid]
        except Exception as e:
            logger.error(f"Error in disconnect handler: {str(e)}")


@socketio.on("join")
def handle_join(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"JOIN ERROR - No client found for SID {sid}")
        return

    try:
        # Support room_id, chat_id and room parameters
        room_id = data.get("room_id") or data.get("chat_id") or data.get("room")
        visitor_id = data.get("visitor_id")

        if not room_id:
            logger.error(f"JOIN ERROR - No room_id provided in join request: {data}")
            emit("error", {"message": "room_id is required"}, to=sid)
            return

        logger.info(
            f"JOIN REQUEST - User {visitor_id or client['user_id']} joining room {room_id}"
        )

        # Add client to room
        join_room(room_id)

        # Track room in client data
        if room_id not in client["rooms"]:
            client["rooms"].append(room_id)

        # Notify other clients in the room that this user has joined
        emit(
            "user_joined",
            {"user_id": client["user_id"], "room_id": room_id},
            to=room_id,
            include_self=False
        )

        # Notify the client that they successfully joined
        emit(
            "join_success",
            {
                "room_id": room_id,
                "server_time": datetime.utcnow().isoformat(),
            },
            to=sid,
        )
        
        # Send user active status for this user to the room
        emit(
            "user_active",
            {"room_id": room_id, "user_id": client["user_id"]},
            to=room_id
        )
        
    except Exception as e:
        logger.error(f"Error in join handler: {str(e)}")
        emit("error", {"message": f"Error joining room: {str(e)}"}, to=sid)


@socketio.on("message")
def handle_message(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"MESSAGE ERROR - No client found for SID {sid}")
        emit("error", {"message": "Not connected"}, to=sid)
        return

    try:
        room_id = data.get("room_id")
        content = data.get("content")
        message_id = data.get("message_id", str(uuid.uuid4()))
        message_type = data.get("message_type", "text")

        if not room_id:
            logger.error("No room_id provided in message")
            emit("error", {"message": "room_id is required"}, to=sid)
            return

        if not content:
            logger.error("No content provided in message")
            emit("error", {"message": "content is required"}, to=sid)
            return

        if room_id not in client["rooms"]:
            logger.warning(f"Client trying to send message to room {room_id} which they haven't joined")
            emit("error", {"message": "You must join the room first"}, to=sid)
            return

        # Create message object
        timestamp = datetime.utcnow().isoformat()
        message_data = {
            "message_id": message_id,
            "room_id": room_id,
            "sender_id": client["user_id"],
            "content": content,
            "message_type": message_type,
            "timestamp": timestamp,
            "status": "sent"
        }

        # Broadcast message to room
        emit("message", message_data, to=room_id)

        # Send delivery confirmation to sender
        emit(
            "message_status",
            {
                "client_message_id": message_id,
                "room_id": room_id,
                "status": "delivered",
                "timestamp": datetime.utcnow().isoformat()
            },
            to=sid
        )

    except Exception as e:
        logger.error(f"Error in message handler: {str(e)}")
        # Send error back to sender
        emit(
            "error", 
            {
                "message": f"Error processing message: {str(e)}",
                "message_id": data.get("message_id")
            }, 
            to=sid
        )


@socketio.on("typing")
def handle_typing(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"TYPING ERROR - No client found for SID {sid}")
        return

    try:
        room_id = data.get("room_id")
        is_typing = data.get("typing", True)
        
        if not room_id:
            logger.error("No room_id provided in typing event")
            return
            
        if room_id not in client["rooms"]:
            logger.warning(f"Client not in room {room_id}")
            return
        
        # Broadcast typing status to room
        emit(
            "typing",
            {
                "room_id": room_id,
                "user_id": client["user_id"],
                "typing": is_typing,
                "timestamp": datetime.utcnow().isoformat()
            },
            to=room_id,
            include_self=False
        )
    except Exception as e:
        logger.error(f"Error in typing handler: {str(e)}")


@socketio.on("ping")
def handle_ping(data):
    """Handle ping requests for connection testing"""
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"PING ERROR - No client found for SID {sid}")
        return

    try:
        logger.info(f"Ping received from client {sid}, user {client['user_id']}")

        # Get the client's timestamp
        client_timestamp = data.get("timestamp", "")

        # Create UTC timestamp with Z suffix
        server_time = (
            datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        )

        # Send a pong response back to the client with original timestamp
        emit(
            "pong",
            {
                "timestamp": server_time,
                "received_ping": client_timestamp,
                "server_received_at": server_time,
            },
        )
    except Exception as e:
        logger.error(f"Error in ping handler: {str(e)}")


@socketio.on("qr_scanned")
def handle_qr_scanned(data):
    """Handle notification that a QR code was scanned"""
    sid = request.sid
    client = connected_clients.get(sid)
    
    if not client:
        logger.warning(f"Unknown client session {sid} for qr_scanned event")
        return
    
    invitation_token = data.get("invitation_token")
    user_id = client["user_id"]
    
    if not invitation_token:
        logger.warning(f"Missing invitation_token in qr_scanned event from {user_id}")
        return
    
    logger.info(f"QR code scanned by {user_id} for invitation {invitation_token}")
    logger.info(f"QR scan data received: {data}")
    
    # Notify relevant parties about the scan
    try:
        # Find the host to notify them immediately
        host_id = data.get("host_id")
        chat_id = data.get("chat_id")
        
        # If host_id is not provided in data, try to find it
        if not host_id:
            try:
                # Try to get invitation details from the data
                host_id = data.get("created_by")
            except Exception as e:
                logger.warning(f"Could not determine host_id: {str(e)}")
                
        # Log detailed information for debugging
        logger.info(f"QR SCAN DETAILS - Token: {invitation_token}, Scanner: {user_id}, Host: {host_id}, Chat: {chat_id}")
                
        # Notify all connected clients with this host_id
        if host_id:
            notification_sent = False
            for connected_sid, connected_client in connected_clients.items():
                if connected_client.get("user_id") == host_id:
                    # Send the notification to the host with redirection info
                    emit("qr_scanned_notification", {
                        "invitation_token": invitation_token,
                        "scanner_id": user_id,
                        "chat_id": chat_id,
                        "timestamp": datetime.utcnow().isoformat(),
                        # Add redirect info to trigger automatic redirection
                        "should_redirect": True,
                        "redirect_to": f"/chat/{chat_id}" if chat_id else None
                    }, room=connected_sid)
                    
                    logger.info(f"Sent QR scan notification to host {host_id} (sid: {connected_sid}) with redirection info")
                    notification_sent = True
                    
                    # Also send a direct message to ensure the client processes it
                    emit("direct_message", {
                        "type": "qr_scan_redirect",
                        "chat_id": chat_id,
                        "message": "QR code was scanned. Redirecting to chat..."
                    }, room=connected_sid)
                    
                    logger.info(f"Sent direct redirect message to host {host_id}")
            
            if not notification_sent:
                logger.warning(f"Host {host_id} not currently connected, could not notify about QR scan")
        
        # Acknowledge the event to the scanner
        emit("qr_scanned_ack", {
            "success": True,
            "invitation_token": invitation_token,
            "message": "QR scan recorded successfully"
        })
        
    except Exception as e:
        logger.error(f"Error processing QR scan: {str(e)}")
        emit("qr_scanned_ack", {
            "success": False,
            "error": f"Error processing QR scan: {str(e)}"
        })


# Error handling for unexpected events
@socketio.on_error()
def error_handler(e):
    logger.error(f"SocketIO error: {str(e)}")
    emit("error", {"message": "An error occurred"})


@socketio.on_error_default
def default_error_handler(e):
    logger.error(f"SocketIO default error: {str(e)}")


# HTTP Routes
@app.route("/health", methods=["GET"])
def health_check():
    return (
        jsonify(
            {
                "status": "healthy",
                "service": "realtime_service",
                "connections": len(connected_clients),
            }
        ),
        200,
    )


@app.route("/connections", methods=["GET"])
def get_connections():
    # Return information about active connections
    return (
        jsonify(
            {
                "active_connections": len(connected_clients),
                "message": "Realtime service is operating normally",
            }
        ),
        200,
    )


if __name__ == "__main__":
    # Use threading mode
    logger.info("Starting realtime service on port 5506")
    socketio.run(
        app,
        host="0.0.0.0",
        port=5506,
        debug=False,
        allow_unsafe_werkzeug=True
    )
EOF

# Set environment variables
export EXTERNAL_HOST="192.168.60.242"
export FLASK_ENV="development"
export PYTHONPATH="/home/aqniyet/abdre_api"
export TEMPLATE_FOLDER="/home/aqniyet/abdre_api/frontend/templates"
export STATIC_FOLDER="/home/aqniyet/abdre_api/frontend/static"
export AUTH_SERVICE_URL="http://localhost:5501"
export USER_SERVICE_URL="http://localhost:5502"
export OAUTH_SERVICE_URL="http://localhost:5503"
export CHAT_SERVICE_URL="http://localhost:5504"
export REALTIME_SERVICE_URL="http://192.168.60.242:5506"
export JWT_SECRET="dev-secret-key"

# Activate virtual environment
source venv/bin/activate

# Run the fixed realtime service
echo "Starting fixed realtime service with QR handler on 0.0.0.0:5506..."
python3 realtime_service/app_fixed_qr.py > realtime_service_qr.log 2>&1 &
REALTIME_PID=$!
echo "Fixed realtime service started with PID: $REALTIME_PID" 