import datetime
import json
import logging
import os
import time
import uuid

import eventlet
import jwt as PyJWT
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Use eventlet worker for better WebSocket performance
eventlet.monkey_patch()

app = Flask(__name__)

# Configure CORS properly with broader settings for WebSockets
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
)

# Get CORS allowed origins from environment or default to '*'
cors_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
if cors_origins != "*":
    # Convert comma-separated string to list
    cors_allowed_origins = cors_origins.split(",")
    logger.info(f"CORS allowed origins: {cors_allowed_origins}")
else:
    cors_allowed_origins = "*"
    logger.info("CORS allowed origins: all origins (*)")

# Initialize Socket.IO with proper configuration
socketio = SocketIO(
    app,
    cors_allowed_origins=cors_allowed_origins,
    path="/socket.io",
    async_mode="eventlet",
    logger=True,
    engineio_logger=True,
    ping_timeout=60,  # Increase ping timeout for better connection stability
    ping_interval=25,  # More frequent pings to detect disconnects faster
    max_http_buffer_size=10 * 1024 * 1024,  # 10MB buffer for larger messages
    allow_upgrades=True,  # Allow transport upgrades (e.g., polling to WebSocket)
    http_compression=True,  # Enable HTTP compression for efficiency
    always_connect=True,  # Always allow initial connection
    manage_session=False,  # Don't use Flask sessions
)

# Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-key")
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = os.environ.get("REDIS_PORT", "6379")
CHAT_SERVICE_URL = os.environ.get("CHAT_SERVICE_URL", "http://chat_service:5004")

# Connected clients
connected_clients = {}


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
        # 4. Check Socket.IO auth object
        elif hasattr(request, "namespace") and hasattr(request.namespace, "server"):
            server = request.namespace.server
            if hasattr(server, "auth") and server.auth and sid in server.auth:
                token_data = server.auth[sid]
                if isinstance(token_data, dict) and "token" in token_data:
                    token = token_data["token"]
                    logger.info(f"Token found in socket.io auth object")
        # 5. Try to get from cookies
        elif hasattr(request, "cookies") and "access_token" in request.cookies:
            token = request.cookies.get("access_token")
            logger.info(f"Token found in cookies")
    except Exception as e:
        logger.error(f"Error extracting token: {str(e)}")

    # Guest connection if no token or token is literally 'guest'
    if not token or token == "guest":
        logger.info(f"No valid token found, allowing connection as guest")
        user_id = f"guest-{sid[:8]}"
        connected_clients[sid] = {
            "user_id": user_id,
            "rooms": [],
            "connected_at": datetime.datetime.utcnow().isoformat(),
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
            "connected_at": datetime.datetime.utcnow().isoformat(),
            "auth_status": "invalid_token",
        }
        return True

    # Successful authentication
    user_id = user_data.get("user_id")
    logger.info(f"User {user_id} connected with session ID {sid}")

    connected_clients[sid] = {
        "user_id": user_id,
        "rooms": [],
        "connected_at": datetime.datetime.utcnow().isoformat(),
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
                    {"room_id": room_id, "visitor_id": client["user_id"]},
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
        room_id = data.get("room_id")
        visitor_id = data.get("visitor_id")

        if not room_id:
            logger.error(f"JOIN ERROR - No room_id provided in join request")
            emit("error", {"message": "room_id is required"}, to=sid)
            return

        logger.info(
            f"JOIN REQUEST - User {visitor_id or client['user_id']} joining room {room_id}"
        )

        # More lenient ID validation - allow if supplied ID is None/empty or matches authenticated ID
        if (
            visitor_id
            and visitor_id != client["user_id"]
            and not client["user_id"].startswith("guest-")
        ):
            logger.warning(
                f"JOIN WARNING - User ID mismatch: expected {client['user_id']}, got {visitor_id}"
            )
            # Allow join anyway in development mode
            if os.environ.get("FLASK_ENV") == "development":
                logger.warning(
                    f"JOIN WARNING - Allowing despite ID mismatch (development mode)"
                )
            else:
                emit("error", {"message": "User ID mismatch"}, to=sid)
                return

        # Add client to room
        join_room(room_id)

        # Track room in client data
        if room_id not in client["rooms"]:
            client["rooms"].append(room_id)

        logger.info(f"JOIN SUCCESS - User {client['user_id']} joined room {room_id}")

        # Notify room of user joining
        emit("join", {"room_id": room_id, "visitor_id": client["user_id"]}, to=room_id)

        # Confirm to the client
        emit("joined", {"room_id": room_id, "status": "success"}, to=sid)
    except Exception as e:
        logger.error(f"Error in join handler: {str(e)}")
        emit("error", {"message": "Internal server error"}, to=sid)


@socketio.on("message")
def handle_message(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"No client found for SID {sid}")
        emit("error", {"message": "No client session found"}, to=sid)
        return

    try:
        room_id = data.get("room_id")
        message = data.get("message", "")
        message_id = data.get("message_id", str(uuid.uuid4()))

        if not room_id:
            logger.error(f"No room_id provided in message")
            emit("error", {"message": "room_id is required"}, to=sid)
            return

        if not message:
            logger.error(f"No message content provided")
            emit("error", {"message": "message content is required"}, to=sid)
            return

        logger.info(
            f"MESSAGE RECEIVED - Room: {room_id}, User: {client['user_id']}, Content: {message[:30]}..."
        )

        # Ensure client is in the room
        if room_id not in client["rooms"]:
            logger.warning(f"Client {sid} ({client['user_id']}) not in room {room_id}")
            # Join the room automatically if not already in it
            logger.info(f"Auto-joining client to room {room_id}")
            join_room(room_id)
            client["rooms"].append(room_id)

        # Create message data with timestamp - ensure UTC with Z suffix for ISO format
        created_at = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

        # Broadcast message to room
        message_data = {
            "room_id": room_id,
            "sender_id": client["user_id"],
            "content": message,
            "created_at": created_at,
            "message_id": message_id,
        }

        # First, store message in database to ensure persistence
        try:
            # Prepare data for chat service
            chat_service_data = {
                "message": message,
                "sender_id": client["user_id"],
                "message_id": message_id,
            }

            logger.info(
                f"Storing message in database: room={room_id}, message_id={message_id}"
            )

            # Use retry logic for database storage
            max_retries = 3
            retry_count = 0
            success = False

            while retry_count < max_retries and not success:
                try:
                    # Send request to chat service
                    response = requests.post(
                        f"{CHAT_SERVICE_URL}/chats/{room_id}/messages",
                        json=chat_service_data,
                        headers={"Content-Type": "application/json"},
                        timeout=5,  # 5 second timeout
                    )

                    if response.status_code in (200, 201):
                        logger.info(
                            f"STORAGE SUCCESS - Message stored in database: room={room_id}, message_id={message_id}"
                        )
                        success = True
                    else:
                        logger.error(
                            f"STORAGE ERROR - Failed to store message in database. Status: {response.status_code}"
                        )
                        retry_count += 1
                        # Exponential backoff
                        time.sleep(0.5 * retry_count)
                except requests.RequestException as e:
                    logger.error(
                        f"STORAGE ERROR - Error storing message in database: {str(e)}"
                    )
                    retry_count += 1
                    # Exponential backoff
                    time.sleep(0.5 * retry_count)

            if not success:
                logger.error(
                    f"CRITICAL - Failed to store message after {max_retries} retries: room={room_id}"
                )
                # We'll still emit the message to connected clients
                # but it won't be in the database for new connections
        except Exception as e:
            logger.error(f"STORAGE ERROR - Unexpected error storing message: {str(e)}")

        # Then, broadcast to all clients in the room
        try:
            # Regular emit to room
            emit("message", message_data, to=room_id)

            # Also broadcast to make extra sure
            socketio.emit("message", message_data, to=room_id)

            logger.info(f"BROADCAST SUCCESS - Message broadcast to room {room_id}")

            # Debugging: list connected clients in room
            room_clients = [
                cid for cid, cli in connected_clients.items() if room_id in cli["rooms"]
            ]
            logger.info(
                f"ROOM CLIENTS: Room {room_id} has {len(room_clients)} connected clients"
            )

            # Send acknowledgment to sender
            emit(
                "message_ack",
                {
                    "message_id": message_id,
                    "status": "delivered",
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                },
                to=sid,
            )

        except Exception as e:
            logger.error(f"BROADCAST ERROR - Error broadcasting message: {str(e)}")
            emit("error", {"message": "Failed to broadcast message"}, to=sid)
    except Exception as e:
        logger.error(f"Error in message handler: {str(e)}")
        emit("error", {"message": "Internal server error"}, to=sid)


@socketio.on("user_active")
def handle_user_active(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"USER_ACTIVE ERROR - No client found for SID {sid}")
        return

    try:
        room_id = data.get("room_id")
        if not room_id:
            logger.error(f"USER_ACTIVE ERROR - No room_id provided")
            return

        # Ensure client is in the room
        if room_id not in client["rooms"]:
            logger.warning(f"Client {sid} not in room {room_id}, auto-joining")
            join_room(room_id)
            client["rooms"].append(room_id)

        # Notify room that user is active
        emit(
            "user_active",
            {"room_id": room_id, "visitor_id": client["user_id"]},
            to=room_id,
        )

        logger.info(
            f"USER_ACTIVE - User {client['user_id']} is active in room {room_id}"
        )
    except Exception as e:
        logger.error(f"Error in user_active handler: {str(e)}")


@socketio.on("user_away")
def handle_user_away(data):
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"USER_AWAY ERROR - No client found for SID {sid}")
        return

    try:
        room_id = data.get("room_id")
        if not room_id:
            logger.error(f"USER_AWAY ERROR - No room_id provided")
            return

        # Ensure client is in the room
        if room_id not in client["rooms"]:
            logger.warning(f"Client {sid} not in room {room_id} for user_away event")
            return

        # Notify room that user is away
        emit(
            "user_away",
            {"room_id": room_id, "visitor_id": client["user_id"]},
            to=room_id,
        )

        logger.info(f"USER_AWAY - User {client['user_id']} is away in room {room_id}")
    except Exception as e:
        logger.error(f"Error in user_away handler: {str(e)}")


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
            datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
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


@socketio.on("subscribe")
def handle_subscribe(data):
    """Handle direct socket.io room subscription"""
    sid = request.sid
    client = connected_clients.get(sid)
    if not client:
        logger.error(f"SUBSCRIBE ERROR - No client found for SID {sid}")
        emit("error", {"message": "No client session found"}, to=sid)
        return

    try:
        room = data.get("room")
        if not room:
            logger.error(f"SUBSCRIBE ERROR - No room specified")
            emit("error", {"message": "room parameter is required"}, to=sid)
            return

        logger.info(f"SUBSCRIBE - User {client['user_id']} subscribing to room {room}")

        # Join the Socket.IO room
        join_room(room)

        # Track room in client data if not already there
        if room not in client["rooms"]:
            client["rooms"].append(room)

        logger.info(
            f"SUBSCRIBE SUCCESS - User {client['user_id']} subscribed to room {room}"
        )

        # Send confirmation
        emit("subscribed", {"room": room, "status": "success"}, to=sid)
    except Exception as e:
        logger.error(f"Error in subscribe handler: {str(e)}")
        emit("error", {"message": "Internal server error"}, to=sid)


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


@app.route("/test-broadcast", methods=["POST"])
def test_broadcast():
    """Test endpoint to broadcast a message to all connected clients
    This is a public test endpoint that does not require authentication
    """
    # For the test endpoint, we don't need to verify the token
    data = request.get_json()
    message = data.get("message", "Test message")
    room = data.get("room")

    logger.info(f"Test broadcast received: {message}")

    # Create UTC timestamp with Z suffix
    created_at = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    if room:
        # Broadcast to specific room
        socketio.emit(
            "message",
            {
                "room_id": room,
                "sender_id": "system",
                "content": message,
                "created_at": created_at,
            },
            to=room,
        )
        return jsonify(
            {"success": True, "message": f"Message broadcast to room {room}"}
        )
    else:
        # Broadcast to all clients
        socketio.emit(
            "broadcast",
            {"sender_id": "system", "content": message, "created_at": created_at},
        )
        return jsonify({"success": True, "message": "Message broadcast to all clients"})


@app.route("/api/notify", methods=["POST"])
def notify_user():
    """Send a notification to a specific user"""
    try:
        data = request.get_json()
        
        if not data or "recipient_id" not in data or "event" not in data:
            return jsonify({
                "error": "Missing recipient_id or event in request"
            }), 400
        
        recipient_id = data["recipient_id"]
        event_name = data["event"]
        event_data = data.get("data", {})
        
        # Find all connections for this user
        recipients = []
        for sid, client in connected_clients.items():
            if client.get("user_id") == recipient_id:
                recipients.append(sid)
        
        if not recipients:
            logger.warning(f"No connected clients found for user {recipient_id}")
            return jsonify({
                "success": False,
                "message": "No connected clients for this user"
            }), 404
        
        # Send the event to all connections for this user
        for sid in recipients:
            socketio.emit(event_name, event_data, room=sid)
            logger.info(f"Sent {event_name} event to {recipient_id} (sid: {sid})")
        
        return jsonify({
            "success": True,
            "recipients": len(recipients),
            "message": f"Notification sent to {len(recipients)} connections"
        }), 200
        
    except Exception as e:
        logger.error(f"Error in notify_user: {str(e)}")
        return jsonify({
            "error": f"Failed to send notification: {str(e)}"
        }), 500

@app.route("/api/broadcast", methods=["POST"])
def broadcast_event():
    """Broadcast an event to all connected clients or to a specific room"""
    try:
        data = request.get_json()
        
        if not data or "event" not in data:
            return jsonify({
                "error": "Missing event in request"
            }), 400
        
        event_name = data["event"]
        event_data = data.get("data", {})
        room = data.get("room_id")
        
        if room:
            # Send to specific room
            socketio.emit(event_name, event_data, room=room)
            logger.info(f"Broadcast {event_name} event to room {room}")
            return jsonify({
                "success": True,
                "message": f"Event broadcast to room {room}"
            }), 200
        else:
            # Send to all connected clients
            socketio.emit(event_name, event_data)
            logger.info(f"Broadcast {event_name} event to all clients")
            return jsonify({
                "success": True,
                "message": f"Event broadcast to all clients"
            }), 200
        
    except Exception as e:
        logger.error(f"Error in broadcast_event: {str(e)}")
        return jsonify({
            "error": f"Failed to broadcast event: {str(e)}"
        }), 500

# Socket.IO event handlers for invitation flow
@socketio.on("invitation_created")
def handle_invitation_created(data):
    """Notify that an invitation has been created"""
    sid = request.sid
    client = connected_clients.get(sid)
    
    if not client:
        logger.warning(f"Unknown client session {sid} for invitation_created event")
        return
    
    host_id = client["user_id"]
    invitation_token = data.get("invitation_token")
    
    if not invitation_token:
        logger.warning(f"Missing invitation_token in invitation_created event from {host_id}")
        return
    
    logger.info(f"User {host_id} created invitation {invitation_token}")
    
    # Acknowledge the event
    emit("invitation_created_ack", {
        "success": True,
        "invitation_token": invitation_token,
        "host_id": host_id
    })
    
    # Store the invitation token in the client data
    client["active_invitation"] = invitation_token

@socketio.on("check_invitation_status")
def handle_check_invitation(data):
    """Check and return the status of an invitation"""
    sid = request.sid
    client = connected_clients.get(sid)
    
    if not client:
        logger.warning(f"Unknown client session {sid} for check_invitation_status event")
        return
    
    invitation_token = data.get("invitation_token")
    
    if not invitation_token:
        logger.warning(f"Missing invitation_token in check_invitation_status event")
        emit("invitation_status", {
            "success": False,
            "error": "Missing invitation token"
        })
        return
    
    # Query the chat service for invitation status
    try:
        response = requests.get(
            f"{CHAT_SERVICE_URL}/invitation-status/{invitation_token}",
            timeout=5
        )
        
        if response.status_code == 200:
            status_data = response.json()
            emit("invitation_status", {
                "success": True,
                "invitation_token": invitation_token,
                "status": status_data.get("status"),
                "seconds_remaining": status_data.get("seconds_remaining", 0),
                "is_used": status_data.get("is_used", False),
                "chat_id": status_data.get("chat_id")
            })
        else:
            error_data = response.json()
            emit("invitation_status", {
                "success": False,
                "error": error_data.get("error", "Failed to check invitation status")
            })
    
    except Exception as e:
        logger.error(f"Error checking invitation status: {str(e)}")
        emit("invitation_status", {
            "success": False,
            "error": f"Error checking invitation status: {str(e)}"
        })

@socketio.on("cancel_invitation")
def handle_cancel_invitation(data):
    """Handle a user canceling their invitation"""
    sid = request.sid
    client = connected_clients.get(sid)
    
    if not client:
        logger.warning(f"Unknown client session {sid} for cancel_invitation event")
        return
    
    invitation_token = data.get("invitation_token")
    
    if not invitation_token:
        logger.warning(f"Missing invitation_token in cancel_invitation event")
        emit("cancel_invitation_result", {
            "success": False,
            "error": "Missing invitation token"
        })
        return
    
    # Query the chat service to invalidate the invitation
    try:
        # For now, we'll use the cleanup endpoint with a specific token
        # In a production app, you'd want a dedicated cancel endpoint
        response = requests.post(
            f"{CHAT_SERVICE_URL}/cleanup-expired-invitations",
            json={"tokens": [invitation_token]},
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        
        if "active_invitation" in client and client["active_invitation"] == invitation_token:
            del client["active_invitation"]
        
        emit("cancel_invitation_result", {
            "success": True,
            "invitation_token": invitation_token,
            "message": "Invitation cancelled successfully"
        })
    
    except Exception as e:
        logger.error(f"Error canceling invitation: {str(e)}")
        emit("cancel_invitation_result", {
            "success": False,
            "error": f"Error canceling invitation: {str(e)}"
        })

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
    
    # Notify relevant parties about the scan
    # Note: This is just a notification that a scan happened,
    # not the actual acceptance which happens through the HTTP API
    try:
        # Get invitation details to find the host
        response = requests.get(
            f"{CHAT_SERVICE_URL}/invitation-status/{invitation_token}",
            timeout=5
        )
        
        if response.status_code == 200:
            invitation_data = response.json()
            host_id = invitation_data.get("host_id")
            
            if host_id:
                # Notify the host that their QR was scanned
                for host_sid, host_client in connected_clients.items():
                    if host_client.get("user_id") == host_id:
                        emit("qr_scanned_notification", {
                            "invitation_token": invitation_token,
                            "scanner_id": user_id
                        }, room=host_sid)
            
            # Acknowledge the event
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


if __name__ == "__main__":
    # Use eventlet WSGI server
    logger.info("Starting realtime service on port 5006")
    socketio.run(
        app,
        host="0.0.0.0",
        port=5006,
        debug=False,
    )
