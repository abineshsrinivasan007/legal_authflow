# ---------- Base Image ----------
FROM python:3.11-slim

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    gcc \
    g++ \
    curl \
    git \
    libjpeg-dev \
    zlib1g-dev \
    libopenblas-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --upgrade pip

# Copy dependency file first (for docker caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Collect static files
RUN pip install pymupdf-layout

# Expose Django port
EXPOSE 8000

CMD ["python","manage.py","runserver","0.0.0.0:8000"]
# Start Django using Gunicorn
#CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "3", "legal_backend.wsgi:application"]