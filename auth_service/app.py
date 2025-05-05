"""
Authentication Service for Abdre microservices platform
"""

import logging
import os
import uuid
import hashlib
from datetime import datetime, timedelta

import jwt
import bcrypt
from flask import Flask, jsonify, request, make_response
from flask_cors import CORS

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Configure CORS
cors_allowed_origins = os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
CORS(app, origins=cors_allowed_origins)

# Configuration
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-key")
TOKEN_EXPIRY = int(os.environ.get("TOKEN_EXPIRY", 3600))  # 1 hour
REFRESH_TOKEN_EXPIRY = int(os.environ.get("REFRESH_TOKEN_EXPIRY", 2592000))  # 30 days
GUEST_TOKEN_EXPIRY = int(os.environ.get("GUEST_TOKEN_EXPIRY", 86400))  # 24 hours

# In-memory storage (replace with database in production)
users = {
    "admin": {
        "username": "admin",
        "password": bcrypt.hashpw("admin123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8'),
        "email": "admin@example.com",
        "role": "admin",
        "user_id": "admin",
        "display_name": "Administrator",
        "created_at": datetime.utcnow().isoformat(),
    },
    "user": {
        "username": "user",
        "password": bcrypt.hashpw("user123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8'),
        "email": "user@example.com",
        "role": "user",
        "user_id": "user",
        "display_name": "Test User",
        "created_at": datetime.utcnow().isoformat(),
    },
}

# Guest users storage
guest_users = {}

# Active sessions tracking
active_sessions = {}


@app.route("/health")
def health_check():
    """Health check endpoint"""
    return jsonify(
        {
            "status": "healthy",
            "service": "auth_service",
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


@app.route("/login", methods=["POST"])
def login():
    """Login endpoint"""
    data = request.get_json()

    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Missing username or password"}), 400

    user = users.get(username)

    if not user:
        return jsonify({"error": "Invalid username or password"}), 401
    
    # Check password using bcrypt
    if not bcrypt.checkpw(password.encode('utf-8'), user["password"].encode('utf-8')):
        return jsonify({"error": "Invalid username or password"}), 401

    # Generate tokens
    access_token = generate_token(user, TOKEN_EXPIRY)
    refresh_token = generate_token(user, REFRESH_TOKEN_EXPIRY, is_refresh=True)
    
    # Track the session
    session_id = str(uuid.uuid4())
    active_sessions[session_id] = {
        "user_id": user["user_id"],
        "created_at": datetime.utcnow().isoformat(),
        "refresh_token": refresh_token,
    }

    return jsonify(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "username": user["username"],
                "email": user["email"],
                "role": user["role"],
                "user_id": user["user_id"],
                "display_name": user.get("display_name", user["username"]),
            },
            "auth_type": "standard",
            "expires_in": TOKEN_EXPIRY,
        }
    )


@app.route("/register", methods=["POST"])
def register():
    """Register endpoint"""
    data = request.get_json()

    username = data.get("username")
    password = data.get("password")
    email = data.get("email")
    display_name = data.get("display_name", username)

    if not username or not password or not email:
        return jsonify({"error": "Missing required fields"}), 400

    if username in users:
        return jsonify({"error": "Username already exists"}), 409

    # Create new user with hashed password
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    user_id = str(uuid.uuid4())
    
    # Create new user
    users[username] = {
        "username": username,
        "password": hashed_password,
        "email": email,
        "role": "user",
        "user_id": user_id,
        "display_name": display_name,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Generate tokens
    access_token = generate_token(users[username], TOKEN_EXPIRY)
    refresh_token = generate_token(
        users[username], REFRESH_TOKEN_EXPIRY, is_refresh=True
    )
    
    # Track the session
    session_id = str(uuid.uuid4())
    active_sessions[session_id] = {
        "user_id": user_id,
        "created_at": datetime.utcnow().isoformat(),
        "refresh_token": refresh_token,
    }

    return (
        jsonify(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": {
                    "username": username,
                    "email": email,
                    "role": "user",
                    "user_id": user_id,
                    "display_name": display_name,
                },
                "auth_type": "standard",
                "expires_in": TOKEN_EXPIRY,
            }
        ),
        201,
    )


@app.route("/refresh", methods=["POST"])
def refresh():
    """Refresh token endpoint"""
    auth_header = request.headers.get("Authorization")
    data = request.get_json() or {}
    
    refresh_token = None
    
    # Get token from Authorization header or request body
    if auth_header and auth_header.startswith("Bearer "):
        refresh_token = auth_header.split(" ")[1]
    elif data.get("refresh_token"):
        refresh_token = data.get("refresh_token")
        
    if not refresh_token:
        return jsonify({"error": "Invalid or missing refresh token"}), 401

    try:
        # Decode token
        payload = jwt.decode(refresh_token, JWT_SECRET, algorithms=["HS256"])

        # Check if it's a refresh token
        if payload.get("type") != "refresh":
            raise jwt.InvalidTokenError("Not a refresh token")

        # Get user data
        username = payload.get("username")
        user_id = payload.get("user_id")
        
        # Handle guest users
        if payload.get("is_guest"):
            guest_id = user_id
            guest_user = guest_users.get(guest_id)
            
            if not guest_user:
                # Create a new guest user if it doesn't exist
                guest_user = {
                    "user_id": guest_id,
                    "username": f"guest_{guest_id[:8]}",
                    "role": "guest",
                    "display_name": guest_user.get("display_name", "Guest User"),
                }
                guest_users[guest_id] = guest_user
                
            # Generate new tokens for guest
            access_token = generate_token(guest_user, GUEST_TOKEN_EXPIRY, is_guest=True)
            new_refresh_token = generate_token(guest_user, REFRESH_TOKEN_EXPIRY, is_refresh=True, is_guest=True)
            
            return jsonify(
                {
                    "access_token": access_token,
                    "refresh_token": new_refresh_token,
                    "user": {
                        "user_id": guest_id,
                        "username": guest_user["username"],
                        "role": "guest",
                        "display_name": guest_user.get("display_name", "Guest User"),
                    },
                    "auth_type": "guest",
                    "expires_in": GUEST_TOKEN_EXPIRY,
                }
            )
        
        # Handle regular users
        user = users.get(username)
        if not user:
            raise jwt.InvalidTokenError("User not found")

        # Generate new tokens
        access_token = generate_token(user, TOKEN_EXPIRY)
        new_refresh_token = generate_token(user, REFRESH_TOKEN_EXPIRY, is_refresh=True)
        
        # Update session with new refresh token
        for session_id, session in active_sessions.items():
            if session.get("refresh_token") == refresh_token:
                active_sessions[session_id]["refresh_token"] = new_refresh_token

        return jsonify(
            {
                "access_token": access_token,
                "refresh_token": new_refresh_token,
                "user": {
                    "username": user["username"],
                    "email": user["email"],
                    "role": user["role"],
                    "user_id": user["user_id"],
                    "display_name": user.get("display_name", user["username"]),
                },
                "auth_type": "standard",
                "expires_in": TOKEN_EXPIRY,
            }
        )

    except jwt.InvalidTokenError as e:
        return jsonify({"error": f"Invalid token: {str(e)}"}), 401


@app.route("/verify", methods=["GET"])
def verify():
    """Verify token endpoint"""
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"valid": False, "error": "Invalid or missing token"}), 401

    token = auth_header.split(" ")[1]

    try:
        # Decode token
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

        # Check token type
        if payload.get("type") == "refresh":
            return jsonify({"valid": True, "token_type": "refresh"})

        user_data = {
            "username": payload.get("username"),
            "email": payload.get("email"),
            "role": payload.get("role"),
            "user_id": payload.get("user_id"),
        }
        
        # Add display name if available
        if payload.get("display_name"):
            user_data["display_name"] = payload.get("display_name")
            
        # Indicate if this is a guest user
        auth_type = "guest" if payload.get("is_guest") else "standard"

        return jsonify(
            {
                "valid": True,
                "token_type": "access",
                "user": user_data,
                "auth_type": auth_type,
            }
        )

    except jwt.ExpiredSignatureError:
        return jsonify({"valid": False, "error": "Token expired"}), 401
    except jwt.InvalidTokenError as e:
        return jsonify({"valid": False, "error": f"Invalid token: {str(e)}"}), 401


@app.route("/get-or-create-visitor-id", methods=["GET", "POST"])
def get_or_create_visitor_id():
    """Generate or return a visitor ID for guest users"""
    data = request.get_json() or {}
    existing_id = data.get("visitor_id")
    
    if existing_id and existing_id in guest_users:
        guest_id = existing_id
        guest_user = guest_users[guest_id]
    else:
        # Generate a new visitor ID
        guest_id = str(uuid.uuid4())
        display_name = data.get("display_name", "Guest User")
        
        guest_user = {
            "user_id": guest_id,
            "username": f"guest_{guest_id[:8]}",
            "role": "guest",
            "display_name": display_name,
            "created_at": datetime.utcnow().isoformat(),
        }
        guest_users[guest_id] = guest_user
    
    # Generate tokens for the guest
    access_token = generate_token(guest_user, GUEST_TOKEN_EXPIRY, is_guest=True)
    refresh_token = generate_token(guest_user, REFRESH_TOKEN_EXPIRY, is_refresh=True, is_guest=True)
    
    return jsonify({
        "visitor_id": guest_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "user_id": guest_id,
            "username": guest_user["username"],
            "role": "guest",
            "display_name": guest_user["display_name"],
        },
        "auth_type": "guest",
        "expires_in": GUEST_TOKEN_EXPIRY,
    })


@app.route("/set-user-name", methods=["POST"])
def set_user_name():
    """Update the display name of a user"""
    auth_header = request.headers.get("Authorization")
    data = request.get_json()
    
    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"error": "Authentication required"}), 401
    
    if not data or not data.get("display_name"):
        return jsonify({"error": "Display name is required"}), 400
    
    token = auth_header.split(" ")[1]
    
    try:
        # Decode token
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        username = payload.get("username")
        is_guest = payload.get("is_guest", False)
        
        # Update the name based on user type
        if is_guest:
            if user_id in guest_users:
                guest_users[user_id]["display_name"] = data["display_name"]
                # Generate updated token with new display name
                updated_user = guest_users[user_id]
            else:
                return jsonify({"error": "Guest user not found"}), 404
        else:
            if username in users:
                users[username]["display_name"] = data["display_name"]
                # Generate updated token with new display name
                updated_user = users[username]
            else:
                return jsonify({"error": "User not found"}), 404
        
        # Generate new token with updated display name
        new_token = generate_token(
            updated_user, 
            GUEST_TOKEN_EXPIRY if is_guest else TOKEN_EXPIRY,
            is_guest=is_guest
        )
        
        return jsonify({
            "success": True,
            "access_token": new_token,
            "user": {
                "user_id": user_id,
                "username": updated_user["username"],
                "display_name": updated_user["display_name"],
                "role": updated_user["role"],
            }
        })
    
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expired"}), 401
    except jwt.InvalidTokenError as e:
        return jsonify({"error": f"Invalid token: {str(e)}"}), 401


@app.route("/logout", methods=["POST"])
def logout():
    """Logout endpoint - invalidate refresh tokens"""
    auth_header = request.headers.get("Authorization")
    
    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"success": True}), 200  # No token to invalidate
    
    token = auth_header.split(" ")[1]
    
    try:
        # Decode token
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("user_id")
        
        # Remove sessions for this user
        sessions_to_remove = []
        for session_id, session in active_sessions.items():
            if session.get("user_id") == user_id:
                sessions_to_remove.append(session_id)
                
        for session_id in sessions_to_remove:
            active_sessions.pop(session_id, None)
            
        return jsonify({"success": True})
    
    except jwt.ExpiredSignatureError:
        return jsonify({"success": True})  # Expired token is already invalid
    except jwt.InvalidTokenError:
        return jsonify({"success": True})  # Invalid token is already unusable


def generate_token(user, expiry, is_refresh=False, is_guest=False):
    """Generate a JWT token"""
    now = datetime.utcnow()

    payload = {
        "user_id": user["user_id"],
        "username": user["username"],
        "email": user.get("email"),
        "role": user.get("role", "guest"),
        "display_name": user.get("display_name", user["username"]),
        "type": "refresh" if is_refresh else "access",
        "is_guest": is_guest,
        "iat": now,
        "exp": now + timedelta(seconds=expiry),
    }

    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)
