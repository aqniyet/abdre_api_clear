#!/bin/bash

# Script to fix WebSocket connection issue in ABDRE Chat

echo "Starting WebSocket connection fix..."

# 1. Stop all services
echo "Stopping all running services..."
./stop-all-services.sh

# 2. Check if the realtime service is running correctly
echo "Starting realtime service on port 5506..."
cd "$(dirname "$0")"
BASE_DIR=$(pwd)

# Activate virtual environment
source venv/bin/activate

# Set necessary environment variables
export PYTHONPATH=$BASE_DIR
export JWT_SECRET="dev-secret-key"
export FLASK_ENV=development
export REALTIME_SERVICE_URL="http://localhost:5506"

# Start the realtime service
cd "$BASE_DIR" && PORT=5506 python realtime_service/app.py > logs/realtime_service.log 2>&1 &
REALTIME_PID=$!
echo "Realtime Service started with PID: $REALTIME_PID"
sleep 3

# Verify if it's running
if ps -p $REALTIME_PID > /dev/null; then
  echo "✅ Realtime Service is running correctly"
else
  echo "❌ Realtime Service failed to start"
  exit 1
fi

# 3. Start API Gateway with correct REALTIME_SERVICE_URL
echo "Starting API Gateway on port 5005..."
cd "$BASE_DIR" && \
  REALTIME_SERVICE_URL="http://localhost:5506" \
  python api_gateway/app.py --port=5005 > logs/api_gateway.log 2>&1 &
GATEWAY_PID=$!
echo "API Gateway started with PID: $GATEWAY_PID"
sleep 3

# Verify if it's running
if ps -p $GATEWAY_PID > /dev/null; then
  echo "✅ API Gateway is running correctly"
else
  echo "❌ API Gateway failed to start"
  exit 1
fi

# 4. Test the WebSocket proxy
echo "Testing WebSocket proxy..."
RESPONSE=$(curl -s http://localhost:5005/ws/chat/test?token=test)
if echo "$RESPONSE" | grep -q "connection_url"; then
  echo "✅ WebSocket proxy is working correctly"
else
  echo "❌ WebSocket proxy is not working"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "WebSocket connection fix has been applied successfully!"
echo "You should now be able to connect to the chat application."
echo ""
echo "If you still experience issues, try the following:"
echo "1. Clear your browser cache"
echo "2. Open the browser's developer tools and check for errors"
echo "3. Verify that both the realtime service and API gateway are running"
echo ""
echo "The application is now available at: http://localhost:5005" 