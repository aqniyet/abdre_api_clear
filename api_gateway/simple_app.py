"""
Simple Flask application for API Gateway
"""
from flask import Flask, request, jsonify, render_template, send_from_directory, redirect
from flask_cors import CORS
import os
import requests
import json

app = Flask(__name__)
CORS(app)

# Configure service URLs from environment variables
AUTH_SERVICE_URL = os.environ.get('AUTH_SERVICE_URL', 'http://auth_service:5001')
USER_SERVICE_URL = os.environ.get('USER_SERVICE_URL', 'http://user_service:5002')
OAUTH_SERVICE_URL = os.environ.get('OAUTH_SERVICE_URL', 'http://oauth_service:5003')
CHAT_SERVICE_URL = os.environ.get('CHAT_SERVICE_URL', 'http://chat_service:5004')
REALTIME_SERVICE_URL = os.environ.get('REALTIME_SERVICE_URL', 'http://realtime_service:5006')

# Set template and static folder paths
app.template_folder = 'templates'
app.static_folder = 'static'

@app.route('/')
def index():
    """Render the main index page"""
    return render_template('index.html')

@app.route('/login')
def login():
    """Render the login page"""
    return render_template('login.html')

@app.route('/new')
def create_chat():
    """Render the create chat page"""
    return render_template('create.html')

@app.route('/chat/<room_id>')
def chat_room(room_id):
    """Render the chat room page"""
    return render_template('chat.html')

@app.route('/join/<token>')
def join_chat(token):
    """Join a chat with a token and redirect to chat page"""
    # This would verify the token with auth service and redirect to proper chat
    return redirect(f'/chat/{token}')

# API proxy routes
@app.route('/api/auth/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def auth_service_proxy(path):
    """Proxy requests to auth service"""
    return proxy_request(f"{AUTH_SERVICE_URL}/{path}")

@app.route('/api/users/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def user_service_proxy(path):
    """Proxy requests to user service"""
    return proxy_request(f"{USER_SERVICE_URL}/{path}")

@app.route('/api/oauth/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def oauth_service_proxy(path):
    """Proxy requests to oauth service"""
    return proxy_request(f"{OAUTH_SERVICE_URL}/{path}")

@app.route('/api/chats/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def chat_service_proxy(path):
    """Proxy requests to chat service"""
    return proxy_request(f"{CHAT_SERVICE_URL}/{path}")

@app.route('/api/chats', methods=['GET', 'POST', 'PUT', 'DELETE'])
def chat_service_root_proxy():
    """Proxy requests to chat service root"""
    return proxy_request(f"{CHAT_SERVICE_URL}/")

def proxy_request(url):
    """
    Proxy a request to the specified service URL
    """
    resp = requests.request(
        method=request.method,
        url=url,
        headers={key: value for key, value in request.headers if key != 'Host'},
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False
    )
    
    # Create response
    response = jsonify(resp.json()) if resp.content else ""
    response.status_code = resp.status_code
    
    # Add headers
    for key, value in resp.headers.items():
        if key.lower() not in ('content-length', 'connection', 'content-encoding'):
            response.headers[key] = value
            
    return response

@app.route('/health')
def health():
    """Health check endpoint"""
    return {'status': 'healthy'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True) 