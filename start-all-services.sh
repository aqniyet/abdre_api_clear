#!/bin/bash

# Start All Abdre Microservices Locally
# This script starts all services with the correct environment variables for local development

echo "Starting Abdre Microservices..."
cd "$(dirname "$0")"
BASE_DIR=$(pwd)

# Activate virtual environment
source venv/bin/activate

# Kill any existing processes that might be using our ports
./stop-all-services.sh

# Load network configuration if it exists
if [ -f "network.env" ]; then
    echo "Loading network configuration from network.env"
    source network.env
    echo "External host: $EXTERNAL_HOST"
    echo "CORS allowed origins: $CORS_ALLOWED_ORIGINS"
fi

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

# Configure service URLs to use localhost with new ports
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

# Export network configuration if defined
if [ ! -z "$EXTERNAL_HOST" ]; then
    export EXTERNAL_HOST
fi
if [ ! -z "$CORS_ALLOWED_ORIGINS" ]; then
    export CORS_ALLOWED_ORIGINS
fi

# Ensure logs directory exists
mkdir -p logs

# Function to check if port is in use
is_port_in_use() {
  if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
    return 0  # Port is in use
  else
    return 1  # Port is free
  fi
}

# Start Auth Service
echo "Starting Auth Service on port $AUTH_PORT..."
if is_port_in_use $AUTH_PORT; then
  echo "Warning: Port $AUTH_PORT is already in use. Auth Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$AUTH_PORT \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  python auth_service/app.py > logs/auth_service.log 2>&1 &
AUTH_PID=$!
echo "Auth Service started with PID: $AUTH_PID"
sleep 3

# Start User Service
echo "Starting User Service on port $USER_PORT..."
if is_port_in_use $USER_PORT; then
  echo "Warning: Port $USER_PORT is already in use. User Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$USER_PORT \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  python user_service/app.py > logs/user_service.log 2>&1 &
USER_PID=$!
echo "User Service started with PID: $USER_PID"
sleep 3

# Start Chat Service
echo "Starting Chat Service on port $CHAT_PORT..."
if is_port_in_use $CHAT_PORT; then
  echo "Warning: Port $CHAT_PORT is already in use. Chat Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$CHAT_PORT \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  python chat_service/app.py > logs/chat_service.log 2>&1 &
CHAT_PID=$!
echo "Chat Service started with PID: $CHAT_PID"
sleep 3

# Start Realtime Service (make sure this starts before API Gateway)
echo "Starting Realtime Service on port $REALTIME_PORT..."
if is_port_in_use $REALTIME_PORT; then
  echo "Warning: Port $REALTIME_PORT is already in use. Realtime Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$REALTIME_PORT \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  python realtime_service/app.py > logs/realtime_service.log 2>&1 &
REALTIME_PID=$!
echo "Realtime Service started with PID: $REALTIME_PID"
sleep 5  # Give realtime service more time to initialize

# Verify realtime service is running before starting API Gateway
if ! ps -p $REALTIME_PID > /dev/null; then
  echo "❌ Realtime Service failed to start! Check logs/realtime_service.log for details."
  echo "Attempting to restart..."
  cd "$BASE_DIR" && PORT=$REALTIME_PORT \
    AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
    USER_SERVICE_URL=$USER_SERVICE_URL \
    OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
    CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
    REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
    python realtime_service/app.py > logs/realtime_service.log 2>&1 &
  REALTIME_PID=$!
  echo "Realtime Service restarted with PID: $REALTIME_PID"
  sleep 5
fi

# Start API Gateway (last)
echo "Starting API Gateway on port $API_PORT..."
if is_port_in_use $API_PORT; then
  echo "Warning: Port $API_PORT is already in use. API Gateway may fail to start."
fi
cd "$BASE_DIR" && \
  AUTH_SERVICE_URL=$AUTH_SERVICE_URL \
  USER_SERVICE_URL=$USER_SERVICE_URL \
  OAUTH_SERVICE_URL=$OAUTH_SERVICE_URL \
  CHAT_SERVICE_URL=$CHAT_SERVICE_URL \
  REALTIME_SERVICE_URL=$REALTIME_SERVICE_URL \
  python api_gateway/app.py --port=$API_PORT > logs/api_gateway.log 2>&1 &
GATEWAY_PID=$!
echo "API Gateway started with PID: $GATEWAY_PID"

# Add a delay to let services start up
sleep 3

# Check if services are running
echo "Checking service status..."
echo "-------------------------"

# Define a function to check if a process is running
check_process() {
  if ps -p $1 > /dev/null; then
    echo "✅ $2 is running (PID: $1)"
    return 0
  else
    echo "❌ $2 is not running!"
    return 1
  fi
}

# Check each service
check_process $AUTH_PID "Auth Service" 
check_process $USER_PID "User Service"
check_process $CHAT_PID "Chat Service"
check_process $REALTIME_PID "Realtime Service"
check_process $GATEWAY_PID "API Gateway"

# Test WebSocket proxy if API Gateway is running
if check_process $GATEWAY_PID "API Gateway" && check_process $REALTIME_PID "Realtime Service"; then
  echo ""
  echo "Testing WebSocket proxy..."
  RESPONSE=$(curl -s http://localhost:$API_PORT/ws/chat/test?token=test)
  if echo "$RESPONSE" | grep -q "connection_url"; then
    echo "✅ WebSocket proxy is working correctly"
  else
    echo "❌ WebSocket proxy is not working"
    echo "Response: $RESPONSE"
  fi
fi

echo "-------------------------"
echo "Services started. Access your application at: http://localhost:$API_PORT"
echo ""
echo "View service logs in the logs/ directory"
echo ""
echo "To stop all services, run: ./stop-all-services.sh" 