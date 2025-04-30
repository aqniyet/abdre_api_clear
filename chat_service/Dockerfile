FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy base requirements first
COPY shared/requirements-base.txt ./requirements-base.txt
RUN pip install --no-cache-dir -r requirements-base.txt

# Copy service-specific requirements and install
COPY chat_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code and shared modules
COPY chat_service /app/chat_service
COPY shared /app/shared

# Set working directory to service directory
WORKDIR /app/chat_service

ENV PYTHONPATH=/app

# Expose port
EXPOSE 5004

# Run the app with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5004", "app:app"] 