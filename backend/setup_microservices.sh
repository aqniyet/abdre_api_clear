#!/bin/bash
# ABDRE Chat - Microservices Setup Script

# Ensure we're in the correct directory
cd "$(dirname "$0")" || exit 1

echo "Setting up ABDRE Chat microservices..."

# Create data directories if they don't exist
mkdir -p microservices/auth_service/data

# Check if virtual environment exists
if [ ! -d "../venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv ../venv
fi

# Activate virtual environment
source ../venv/bin/activate

# Install dependencies
echo "Installing API Gateway dependencies..."
pip install -r api_gateway/requirements.txt

echo "Installing Auth Service dependencies..."
pip install -r microservices/auth_service/requirements.txt

echo "Setup complete. You can now run the microservices using:"
echo "python run_microservices.py" 