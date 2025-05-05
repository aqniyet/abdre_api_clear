"""
User Service for Abdre microservices platform
"""

import logging
import os
from datetime import datetime

import jwt as PyJWT
from flask import Flask, jsonify, request
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

# In-memory user storage (replace with database in production)
users = {
    "admin": {
        "id": "admin",
        "username": "admin",
        "email": "admin@example.com",
        "role": "admin",
        "profile": {
            "full_name": "Admin User",
            "bio": "System administrator",
            "avatar_url": "https://example.com/avatar/admin.jpg",
        },
    },
    "user": {
        "id": "user",
        "username": "user",
        "email": "user@example.com",
        "role": "user",
        "profile": {
            "full_name": "Regular User",
            "bio": "A normal user",
            "avatar_url": "https://example.com/avatar/user.jpg",
        },
    },
}


@app.route("/health")
def health_check():
    """Health check endpoint"""
    return jsonify(
        {
            "status": "healthy",
            "service": "user_service",
            "timestamp": datetime.utcnow().isoformat(),
        }
    )


@app.route("/me", methods=["GET"])
def get_current_user():
    """Get current user info"""
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"error": "Authentication required"}), 401

    token = auth_header.split(" ")[1]

    try:
        # Decode token
        payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])

        # Get user data
        username = payload.get("username")
        user = users.get(username)

        if not user:
            return jsonify({"error": "User not found"}), 404

        return jsonify(user)

    except PyJWT.exceptions.ExpiredSignatureError:
        return jsonify({"error": "Token expired"}), 401
    except PyJWT.exceptions.InvalidTokenError as e:
        return jsonify({"error": f"Invalid token: {str(e)}"}), 401


@app.route("/me", methods=["PUT"])
def update_current_user():
    """Update current user info"""
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"error": "Authentication required"}), 401

    token = auth_header.split(" ")[1]

    try:
        # Decode token
        payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])

        # Get user data
        username = payload.get("username")
        user = users.get(username)

        if not user:
            return jsonify({"error": "User not found"}), 404

        # Update user data
        data = request.get_json()

        if "profile" in data:
            profile_data = data["profile"]

            if "full_name" in profile_data:
                user["profile"]["full_name"] = profile_data["full_name"]

            if "bio" in profile_data:
                user["profile"]["bio"] = profile_data["bio"]

            if "avatar_url" in profile_data:
                user["profile"]["avatar_url"] = profile_data["avatar_url"]

        return jsonify(user)

    except PyJWT.exceptions.ExpiredSignatureError:
        return jsonify({"error": "Token expired"}), 401
    except PyJWT.exceptions.InvalidTokenError as e:
        return jsonify({"error": f"Invalid token: {str(e)}"}), 401


@app.route("/<user_id>", methods=["GET"])
def get_user(user_id):
    """Get user by ID"""
    user = users.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    # Don't return sensitive information
    return jsonify(
        {"id": user["id"], "username": user["username"], "profile": user["profile"]}
    )


@app.route("/search", methods=["GET"])
def search_users():
    """Search users by query"""
    query = request.args.get("q", "").lower()

    results = []

    for user_id, user in users.items():
        if (
            query in user["username"].lower()
            or query in user["profile"]["full_name"].lower()
        ):
            # Don't return sensitive information
            results.append(
                {
                    "id": user["id"],
                    "username": user["username"],
                    "profile": user["profile"],
                }
            )

    return jsonify(results)


def authenticate_user():
    """Authenticate user from JWT token"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header.split(" ")[1]
    try:
        payload = PyJWT.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except PyJWT.exceptions.InvalidTokenError:
        return None
        
def authenticate_admin():
    """Ensure the user is an admin"""
    user = authenticate_user()
    if not user or user.get("role") != "admin":
        return None
    return user


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5002))
    app.run(host="0.0.0.0", port=port)
