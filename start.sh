#!/bin/bash

# ABDRE Chat Application Startup Script

# Set environment variables
export DEBUG=true
export PORT=5000
export FLASK_APP=backend/app.py

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

# Check if requirements are installed
if ! pip freeze | grep -q "flask"; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

# Start the application
echo "Starting ABDRE Chat Application..."
python backend/app.py 