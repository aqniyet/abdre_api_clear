from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json

app = Flask(__name__)
CORS(app)

# Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-key')
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = os.environ.get('REDIS_PORT', '6379')

# Routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "service": "realtime_service"}), 200

@app.route('/connections', methods=['GET'])
def get_connections():
    # This would normally return active connections
    return jsonify({
        "active_connections": 0,
        "message": "Realtime service is operating normally"
    }), 200

@app.route('/subscribe', methods=['POST'])
def subscribe():
    # This would normally add a subscription to a channel
    channel = request.json.get('channel', '')
    return jsonify({
        "success": True,
        "channel": channel,
        "message": f"Subscribed to channel {channel}"
    }), 201

@app.route('/unsubscribe', methods=['POST'])
def unsubscribe():
    # This would normally remove a subscription
    channel = request.json.get('channel', '')
    return jsonify({
        "success": True,
        "channel": channel,
        "message": f"Unsubscribed from channel {channel}"
    }), 200

@app.route('/publish', methods=['POST'])
def publish():
    # This would normally publish a message to a channel
    channel = request.json.get('channel', '')
    message = request.json.get('message', {})
    
    return jsonify({
        "success": True,
        "channel": channel,
        "message": f"Message published to channel {channel}"
    }), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5006, debug=True) 