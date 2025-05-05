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

# Use different port ranges
AUTH_PORT=5501
USER_PORT=5502
OAUTH_PORT=5503
CHAT_PORT=5504
API_PORT=5505
REALTIME_PORT=5506

# Set common environment variables
export PYTHONPATH=$BASE_DIR
export JWT_SECRET="dev-secret-key"
export FLASK_ENV=development

# Configure service URLs to use localhost with new ports
export AUTH_SERVICE_URL="http://localhost:5001"
export USER_SERVICE_URL="http://localhost:5002"
export OAUTH_SERVICE_URL="http://localhost:5003" 
export CHAT_SERVICE_URL="http://localhost:5004"
export REALTIME_SERVICE_URL="http://localhost:5006"

# Use mock DB for development
export MOCK_DB="true"

# Set template and static folders
export TEMPLATE_FOLDER="$BASE_DIR/frontend/templates"
export STATIC_FOLDER="$BASE_DIR/frontend/static"

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
cd "$BASE_DIR" && PORT=$AUTH_PORT python auth_service/app.py > logs/auth_service.log 2>&1 &
AUTH_PID=$!
echo "Auth Service started with PID: $AUTH_PID"
sleep 3

# Start User Service
echo "Starting User Service on port $USER_PORT..."
if is_port_in_use $USER_PORT; then
  echo "Warning: Port $USER_PORT is already in use. User Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$USER_PORT python user_service/app.py > logs/user_service.log 2>&1 &
USER_PID=$!
echo "User Service started with PID: $USER_PID"
sleep 3

# Start Chat Service
echo "Starting Chat Service on port $CHAT_PORT..."
if is_port_in_use $CHAT_PORT; then
  echo "Warning: Port $CHAT_PORT is already in use. Chat Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$CHAT_PORT python chat_service/app.py > logs/chat_service.log 2>&1 &
CHAT_PID=$!
echo "Chat Service started with PID: $CHAT_PID"
sleep 3

# Start Realtime Service
echo "Starting Realtime Service on port $REALTIME_PORT..."
if is_port_in_use $REALTIME_PORT; then
  echo "Warning: Port $REALTIME_PORT is already in use. Realtime Service may fail to start."
fi
cd "$BASE_DIR" && PORT=$REALTIME_PORT python realtime_service/app.py > logs/realtime_service.log 2>&1 &
REALTIME_PID=$!
echo "Realtime Service started with PID: $REALTIME_PID"
sleep 3

# Start API Gateway (last)
echo "Starting API Gateway on port $API_PORT..."
if is_port_in_use $API_PORT; then
  echo "Warning: Port $API_PORT is already in use. API Gateway may fail to start."
fi
cd "$BASE_DIR" && \
  AUTH_SERVICE_URL=http://localhost:$AUTH_PORT \
  USER_SERVICE_URL=http://localhost:$USER_PORT \
  OAUTH_SERVICE_URL=http://localhost:$OAUTH_PORT \
  CHAT_SERVICE_URL=http://localhost:$CHAT_PORT \
  REALTIME_SERVICE_URL=http://localhost:$REALTIME_PORT \
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

echo "-------------------------"
echo "Services started. Access your application at: http://localhost:5505"
echo ""
echo "View service logs in the logs/ directory"
echo ""
echo "To stop all services, run: ./stop-all-services.sh" 