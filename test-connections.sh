#!/bin/bash

# Function to test a service
test_service() {
  local service_name=$1
  local port=$2
  local health_endpoint=${3:-'/health'}
  
  echo "Testing $service_name at port $port..."
  
  response=$(curl -s -w "\n%{http_code}" http://localhost:$port$health_endpoint)
  status_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status_code" -eq 200 ]; then
    echo "✅ $service_name is healthy!"
    echo "$body" | grep -q "healthy" && echo "   Service reports as healthy."
  else
    echo "❌ $service_name is not responding correctly. Status code: $status_code"
    echo "$body"
  fi
  echo ""
}

# Function to test WebSocket connection
test_websocket() {
  echo "Testing WebSocket connection to realtime service..."
  
  # We use curl to the special test endpoint
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"message":"Test message from test script"}' \
    http://localhost:5000/api/ws-test)
  
  if echo "$response" | grep -q "success"; then
    echo "✅ WebSocket test API is working"
    echo "$response"
  else
    echo "❌ WebSocket test API failed"
    echo "$response"
  fi
  echo ""
}

# Function to test authentication
test_auth() {
  echo "Testing authentication..."
  
  # Try to login with default credentials
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' \
    http://localhost:5000/api/auth/login)
  
  if echo "$response" | grep -q "access_token"; then
    echo "✅ Authentication is working!"
    token=$(echo "$response" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    echo "   Token received: ${token:0:20}..."
  else
    echo "❌ Authentication failed"
    echo "$response"
  fi
  echo ""
}

# Main test sequence
echo "=== ABDRE Microservices Test ==="
echo "Running health checks for all services..."
echo ""

test_service "API Gateway" 5000
test_service "Auth Service" 5001
test_service "User Service" 5002
test_service "OAuth Service" 5003
test_service "Chat Service" 5004
test_service "Realtime Service" 5006

test_auth
test_websocket

echo "=== Test Complete ===" 