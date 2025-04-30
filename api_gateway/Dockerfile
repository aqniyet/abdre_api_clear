FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy base requirements first
COPY shared/requirements-base.txt ./requirements-base.txt
RUN pip install --no-cache-dir -r requirements-base.txt

# Copy service-specific requirements and install
COPY api_gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code and shared modules
COPY api_gateway /app/api_gateway
COPY frontend/templates /app/api_gateway/templates
COPY frontend/static /app/api_gateway/static
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/api_gateway

# Make startup script executable
RUN chmod +x start.sh

# Expose port
EXPOSE 5000

# Use startup script
CMD ["./start.sh"] 