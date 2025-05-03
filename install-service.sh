#!/bin/bash

# ABDRE Service Installation Script

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== ABDRE Service Installation ===${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: This script must be run as root (with sudo)${NC}"
  exit 1
fi

# Get the current user (not the sudo user)
CURRENT_USER=${SUDO_USER:-$(whoami)}
CURRENT_GROUP=$(id -gn $CURRENT_USER)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing ABDRE service for user: $CURRENT_USER"

# Update the service file with the correct paths and user
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$SCRIPT_DIR|g" "$SCRIPT_DIR/abdre.service"
sed -i "s|ExecStart=.*|ExecStart=$SCRIPT_DIR/deploy.sh|g" "$SCRIPT_DIR/abdre.service"
sed -i "s|User=.*|User=$CURRENT_USER|g" "$SCRIPT_DIR/abdre.service"
sed -i "s|Group=.*|Group=$CURRENT_GROUP|g" "$SCRIPT_DIR/abdre.service"

# Make scripts executable
chmod +x "$SCRIPT_DIR/deploy.sh"
chmod +x "$SCRIPT_DIR/test-connections.sh"

# Copy service file to systemd directory
cp "$SCRIPT_DIR/abdre.service" /etc/systemd/system/

# Reload systemd daemon
systemctl daemon-reload

echo -e "${GREEN}ABDRE service has been installed!${NC}"
echo ""
echo "You can control the service with these commands:"
echo "  - sudo systemctl start abdre    # Start the service"
echo "  - sudo systemctl stop abdre     # Stop the service"
echo "  - sudo systemctl status abdre   # Check service status"
echo ""
echo "To enable automatic startup on boot:"
echo "  - sudo systemctl enable abdre"
echo ""
echo "To run tests after starting the service:"
echo "  - $SCRIPT_DIR/test-connections.sh" 