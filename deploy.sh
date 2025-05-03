#!/bin/bash

# ABDRE Microservices Deployment Script

# Colors for terminal output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== ABDRE Microservices Deployment ===${NC}"
echo "Preparing to deploy all microservices..."

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null || ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker and Docker Compose are required but not installed.${NC}"
    echo "Please install Docker and Docker Compose first."
    exit 1
fi

# Stop any existing services
echo -e "${YELLOW}Stopping any existing containers...${NC}"
docker-compose down

# Rebuild containers with fresh images
echo -e "${YELLOW}Building fresh containers...${NC}"
docker-compose build --no-cache

# Start all services
echo -e "${YELLOW}Starting all services...${NC}"
docker-compose up -d

# Wait for services to initialize
echo -e "${YELLOW}Waiting for services to initialize (30 seconds)...${NC}"
sleep 30

# Check if API Gateway is running
echo -e "${YELLOW}Checking if API Gateway is up...${NC}"
if curl -s http://localhost:5000/health | grep -q "healthy"; then
    echo -e "${GREEN}✅ API Gateway is up and running!${NC}"
else
    echo -e "${RED}❌ API Gateway is not responding correctly.${NC}"
    echo "You may need to check logs with: docker-compose logs api_gateway"
fi

echo -e "${GREEN}Deployment complete!${NC}"
echo "To test all services, run: ./test-connections.sh"
echo "To view logs, run: docker-compose logs -f" 