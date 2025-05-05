#!/bin/bash
# Realtime Service Deployment Script

# Stop on errors
set -e

echo "=== ABDRE Realtime Service Deployment ==="
echo "This script will build and deploy the realtime service"

# Build environment variables
export JWT_SECRET=${JWT_SECRET:-"dev-secret-key"}
export FLASK_ENV=${FLASK_ENV:-"development"}
export CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-"*"}
export CHAT_SERVICE_URL=${CHAT_SERVICE_URL:-"http://chat_service:5004"}
export REDIS_HOST=${REDIS_HOST:-"localhost"}
export REDIS_PORT=${REDIS_PORT:-"6379"}

# Display configuration
echo "Configuration:"
echo "  FLASK_ENV: $FLASK_ENV"
echo "  CORS_ALLOWED_ORIGINS: $CORS_ALLOWED_ORIGINS"
echo "  CHAT_SERVICE_URL: $CHAT_SERVICE_URL"
echo "  REDIS_HOST: $REDIS_HOST"
echo "  REDIS_PORT: $REDIS_PORT"

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Check if Redis is available
if command -v redis-cli &> /dev/null; then
    echo "Testing Redis connection..."
    if redis-cli -h $REDIS_HOST -p $REDIS_PORT ping | grep -q "PONG"; then
        echo "✅ Redis connection successful"
    else
        echo "⚠️ Redis connection failed, but continuing anyway..."
    fi
else
    echo "⚠️ redis-cli not found, skipping Redis connection test"
fi

# Run a quick self-test to verify configuration
echo "Running self-test..."
python -c "
import jwt
import flask
import flask_socketio
import eventlet

print('✅ Python imports successful')

# Verify JWT token creation/verification
secret = '$JWT_SECRET'
token = jwt.encode({'user_id': 'test'}, secret, algorithm='HS256')
decoded = jwt.decode(token, secret, algorithms=['HS256'])
assert decoded['user_id'] == 'test'
print('✅ JWT verification successful')

# Verify Eventlet
assert eventlet.version_info >= (0, 30)
print('✅ Eventlet version compatible')

# Verify Flask-SocketIO
assert hasattr(flask_socketio, 'SocketIO')
print('✅ All dependencies verified')
"

# Make test client executable
chmod +x test_client.py

echo "✅ Deployment preparation completed successfully"
echo ""
echo "To start the service, run:"
echo "  python app.py"
echo ""
echo "To test the WebSocket connectivity, run:"
echo "  ./test_client.py --interactive" 