#!/bin/bash

# Stop All Abdre Microservices
echo "Stopping all Abdre microservices..."

# Kill all Python processes running app.py
pkill -f "python .*/app.py"

# Check if any processes are still running
if pgrep -f "python .*/app.py" > /dev/null; then
  echo "Some services are still running. Forcing termination..."
  pkill -9 -f "python .*/app.py"
fi

echo "All microservices stopped successfully." 