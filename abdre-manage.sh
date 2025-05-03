#!/bin/bash

# ABDRE Management Script

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Define the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to print help
print_help() {
  echo -e "${YELLOW}ABDRE Management Script${NC}"
  echo
  echo "Usage: $0 COMMAND"
  echo
  echo "Commands:"
  echo "  start           Start all services"
  echo "  stop            Stop all services"
  echo "  restart         Restart all services"
  echo "  status          Check status of all services"
  echo "  logs [service]  View logs (optional: specify service name)"
  echo "  test            Run connection tests"
  echo "  backup          Backup the database"
  echo "  install         Install as systemd service (requires sudo)"
  echo "  help            Show this help message"
  echo
}

# Function to start services
start_services() {
  echo -e "${BLUE}Starting ABDRE services...${NC}"
  $SCRIPT_DIR/deploy.sh
}

# Function to stop services
stop_services() {
  echo -e "${BLUE}Stopping ABDRE services...${NC}"
  docker-compose down
  echo -e "${GREEN}Services stopped${NC}"
}

# Function to restart services
restart_services() {
  echo -e "${BLUE}Restarting ABDRE services...${NC}"
  docker-compose down
  $SCRIPT_DIR/deploy.sh
}

# Function to check status
check_status() {
  echo -e "${BLUE}Checking ABDRE services status...${NC}"
  docker-compose ps
  
  echo -e "\n${BLUE}API Gateway Health:${NC}"
  curl -s http://localhost:5000/health | python3 -m json.tool || echo -e "${RED}API Gateway not responding${NC}"
}

# Function to view logs
view_logs() {
  if [ -z "$1" ]; then
    echo -e "${BLUE}Showing logs for all services...${NC}"
    docker-compose logs --tail=100
  else
    echo -e "${BLUE}Showing logs for $1...${NC}"
    docker-compose logs --tail=100 "$1"
  fi
}

# Function to run tests
run_tests() {
  echo -e "${BLUE}Running ABDRE connection tests...${NC}"
  $SCRIPT_DIR/test-connections.sh
}

# Function to backup database
backup_database() {
  BACKUP_DIR="$SCRIPT_DIR/backups"
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="$BACKUP_DIR/abdre_backup_$TIMESTAMP.sql"
  
  # Create backup directory if it doesn't exist
  mkdir -p "$BACKUP_DIR"
  
  echo -e "${BLUE}Backing up database to $BACKUP_FILE...${NC}"
  docker-compose exec -T postgres pg_dump -U postgres abdre > "$BACKUP_FILE"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup completed successfully!${NC}"
    echo "Backup file: $BACKUP_FILE"
  else
    echo -e "${RED}Backup failed!${NC}"
    rm -f "$BACKUP_FILE"
  fi
}

# Function to install service
install_service() {
  echo -e "${BLUE}Installing ABDRE as a system service...${NC}"
  sudo $SCRIPT_DIR/install-service.sh
}

# Main script execution
case "$1" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    restart_services
    ;;
  status)
    check_status
    ;;
  logs)
    view_logs "$2"
    ;;
  test)
    run_tests
    ;;
  backup)
    backup_database
    ;;
  install)
    install_service
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo -e "${RED}Error: Unknown command '$1'${NC}"
    print_help
    exit 1
    ;;
esac

exit 0 