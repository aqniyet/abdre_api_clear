#!/bin/bash

# Check if environment variables are set, otherwise use defaults
export JWT_SECRET=${JWT_SECRET:-dev-secret-key}
export FLASK_ENV=${FLASK_ENV:-development}
export DEBUG=${DEBUG:-true}

# Set rate limiting configuration
export REQUESTS_PER_MINUTE=${REQUESTS_PER_MINUTE:-60}
export BURST_LIMIT=${BURST_LIMIT:-20}

# Set circuit breaker configuration
export CIRCUIT_FAILURE_THRESHOLD=${CIRCUIT_FAILURE_THRESHOLD:-5}
export CIRCUIT_RESET_TIMEOUT=${CIRCUIT_RESET_TIMEOUT:-30}

# Set service URLs
export AUTH_SERVICE_URL=${AUTH_SERVICE_URL:-http://auth_service:5001}
export USER_SERVICE_URL=${USER_SERVICE_URL:-http://user_service:5002}
export OAUTH_SERVICE_URL=${OAUTH_SERVICE_URL:-http://oauth_service:5003}
export CHAT_SERVICE_URL=${CHAT_SERVICE_URL:-http://chat_service:5004}
export REALTIME_SERVICE_URL=${REALTIME_SERVICE_URL:-http://realtime_service:5006}

echo "Starting API Gateway with the following configuration:"
echo "==================================================="
echo "JWT_SECRET: ${JWT_SECRET}"
echo "FLASK_ENV: ${FLASK_ENV}"
echo "DEBUG: ${DEBUG}"
echo "REQUESTS_PER_MINUTE: ${REQUESTS_PER_MINUTE}"
echo "CIRCUIT_FAILURE_THRESHOLD: ${CIRCUIT_FAILURE_THRESHOLD}"
echo "AUTH_SERVICE_URL: ${AUTH_SERVICE_URL}"
echo "USER_SERVICE_URL: ${USER_SERVICE_URL}"
echo "OAUTH_SERVICE_URL: ${OAUTH_SERVICE_URL}"
echo "CHAT_SERVICE_URL: ${CHAT_SERVICE_URL}"
echo "REALTIME_SERVICE_URL: ${REALTIME_SERVICE_URL}"
echo "==================================================="

# Start the application with Gunicorn
exec gunicorn --bind 0.0.0.0:5000 --workers 4 --threads 2 --timeout 60 app:app 