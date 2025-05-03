from flask import Flask, request, jsonify, redirect, url_for
from flask_cors import CORS
import os
import json

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

# Google OAuth configuration
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')

# Routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "oauth_service"}), 200

@app.route('/google/auth', methods=['GET'])
def google_auth():
    # This would normally redirect to Google OAuth page
    return jsonify({"message": "Google OAuth authorization endpoint working"}), 200

@app.route('/google/callback', methods=['GET'])
def google_callback():
    # This would normally handle the Google OAuth callback
    return jsonify({"message": "Google OAuth callback endpoint working", "token": "sample-token"}), 200

@app.route('/providers', methods=['GET'])
def get_providers():
    # Return the list of available OAuth providers
    providers = [
        {"id": "google", "name": "Google", "enabled": bool(GOOGLE_CLIENT_ID)}
    ]
    return jsonify({"providers": providers}), 200

@app.route('/verify', methods=['POST'])
def verify_token():
    # This would normally verify an OAuth token
    return jsonify({"valid": True, "user_id": "sample-user-id"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True) 