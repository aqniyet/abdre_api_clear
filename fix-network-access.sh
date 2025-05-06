#!/bin/bash

# Script to fix network access issues for the ABDRE Chat application

echo "Starting network access fix..."

# 1. Stop all services
echo "Stopping all running services..."
./stop-all-services.sh

# Get the current IP address
IP_ADDRESS=$(hostname -I | awk '{print $1}')
echo "System IP address: $IP_ADDRESS"

# 2. Create a configuration file for network settings
echo "Creating network configuration..."
cat > network.env << EOF
# Network configuration for ABDRE Chat
# Generated on $(date)

# Local network IP address
EXTERNAL_HOST=$IP_ADDRESS

# For CORS configuration
CORS_ALLOWED_ORIGINS=http://localhost:5005,http://$IP_ADDRESS:5005,*
EOF

echo "Network configuration file created: network.env"

# 3. Update the start-all-services.sh script to use these settings
echo "Updating start script with network configuration..."

cd "$(dirname "$0")"
BASE_DIR=$(pwd)

# Activate virtual environment
source venv/bin/activate

# Set the environment variables
source network.env

# Use different port ranges
AUTH_PORT=5501
USER_PORT=5502
OAUTH_PORT=5503
CHAT_PORT=5504
API_PORT=5005
REALTIME_PORT=5506

# Set common environment variables
export PYTHONPATH=$BASE_DIR
export JWT_SECRET="dev-secret-key"
export FLASK_ENV=development
export EXTERNAL_HOST=$EXTERNAL_HOST
export CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS

# Configure service URLs
export AUTH_SERVICE_URL="http://localhost:$AUTH_PORT"
export USER_SERVICE_URL="http://localhost:$USER_PORT"
export OAUTH_SERVICE_URL="http://localhost:$OAUTH_PORT" 
export CHAT_SERVICE_URL="http://localhost:$CHAT_PORT"
export REALTIME_SERVICE_URL="http://localhost:$REALTIME_PORT"

# Use mock DB for development
export MOCK_DB="true"

# Set template and static folders
export TEMPLATE_FOLDER="$BASE_DIR/frontend/templates"
export STATIC_FOLDER="$BASE_DIR/frontend/static"

# Ensure logs directory exists
mkdir -p logs

# 4. Start the realtime service with proper network config
echo "Starting Realtime Service on port $REALTIME_PORT..."
cd "$BASE_DIR" && PORT=$REALTIME_PORT \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS \
  EXTERNAL_HOST=$EXTERNAL_HOST \
  python realtime_service/app.py > logs/realtime_service.log 2>&1 &
REALTIME_PID=$!
echo "Realtime Service started with PID: $REALTIME_PID"
sleep 5  

# 5. Start API Gateway with the network configuration
echo "Starting API Gateway on port $API_PORT..."
cd "$BASE_DIR" && \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS \
  EXTERNAL_HOST=$EXTERNAL_HOST \
  python api_gateway/app.py --port=$API_PORT > logs/api_gateway.log 2>&1 &
GATEWAY_PID=$!
echo "API Gateway started with PID: $GATEWAY_PID"
sleep 3

# 6. Test the WebSocket proxy using the IP address
echo "Testing WebSocket proxy with IP address..."
RESPONSE=$(curl -s http://$IP_ADDRESS:$API_PORT/ws/chat/test?token=test)
if echo "$RESPONSE" | grep -q "connection_url"; then
  echo "✅ WebSocket proxy is accessible from IP address $IP_ADDRESS"
else
  echo "❌ WebSocket proxy is NOT accessible from IP address"
  echo "Response: $RESPONSE"
fi

echo "Network access fix applied successfully!"
echo ""
echo "Your application should now be accessible at:"
echo "- http://localhost:5005"
echo "- http://$IP_ADDRESS:5005 (from other devices on your network)"
echo ""
echo "If you still experience issues, you may need to:"
echo "1. Check your firewall settings to ensure ports 5005 and 5506 are accessible"
echo "2. Modify your browser settings to allow WebSocket connections to your IP"
echo "3. Clear your browser cache and try with a new private/incognito window"
echo ""
echo "Both services are now running. Use './stop-all-services.sh' to stop them when done testing." 