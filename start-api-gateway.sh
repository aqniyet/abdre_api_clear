#!/bin/bash
# Script to start the API Gateway with the virtual environment

# Activate virtual environment
source venv/bin/activate

# Add current directory to Python path
export PYTHONPATH="$PYTHONPATH:$(pwd)"

# Set explicit template folder and static folder
export TEMPLATE_FOLDER="$(pwd)/frontend/templates"
export STATIC_FOLDER="$(pwd)/frontend/static"

# Print debugging information
echo "Python path: $PYTHONPATH"
echo "Template folder: $TEMPLATE_FOLDER"
echo "Static folder: $STATIC_FOLDER"
echo "Current directory: $(pwd)"

# Run the API Gateway on port 5005 to avoid conflicts
python3 api_gateway/app.py --port 5005

# This script can be run with: ./start-api-gateway.sh 