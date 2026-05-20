FROM node:24-alpine

# Set working directory
WORKDIR /app

# Install system dependencies needed for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create non-root user for security
#RUN addgroup -g 1001 -S nodejs
#RUN adduser -S nextjs -u 1001

# Change ownership of the app directory
#RUN chown -R nextjs:nodejs /app
#USER nextjs

# Expose port
EXPOSE 5000

# Health check
#HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#  CMD curl -f http://localhost:5000/api/dashboard/health || exit 1

# Start the application
CMD ["npm", "run", "dev"]