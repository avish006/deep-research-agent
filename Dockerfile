# --- Stage 1: Build the React Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/client

# Install frontend dependencies
COPY client/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY client/ ./
RUN npm run build

# --- Stage 2: Final Production Image ---
FROM python:3.11-slim

# Install Node.js in the Python image
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=3001

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server files
COPY server/ ./server/

# Install server dependencies
WORKDIR /app/server
RUN npm ci --omit=dev
WORKDIR /app

# Copy python source code and outputs dir
COPY main.py .
COPY src/ ./src/
RUN mkdir -p outputs

# Copy the built frontend from Stage 1
COPY --from=frontend-builder /app/client/dist ./client/dist

# Expose the server port
EXPOSE 3001

# Start the Node.js server
CMD ["node", "server/index.js"]
