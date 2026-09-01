# Build stage
FROM node:22.12.0 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy application source
COPY . .

# Production stage
FROM node:22.12.0-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application files from builder stage
COPY --from=builder /app/src ./src
COPY --from=builder /app/index.js ./

# Expose healthcheck port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
