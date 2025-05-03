FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    curl \
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

# Create the directory structure needed
RUN mkdir -p /app/api_gateway/static/js/utils \
    && mkdir -p /app/api_gateway/static/js/services \
    && mkdir -p /app/api_gateway/static/js/components \
    && mkdir -p /app/api_gateway/static/js/modules

# Set working directory to service directory
WORKDIR /app/api_gateway

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Make startup script executable
RUN chmod +x start.sh

# Use startup script
CMD ["./start.sh"] 