# Use the official Node.js runtime as the base image
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set the working directory inside the container
WORKDIR /app

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package.json and package-lock.json (if available)
COPY --chown=nodejs:nodejs package*.json ./

# Switch to nodejs user for npm install
USER nodejs

# Install dependencies with retry logic and better error handling
RUN npm ci --only=production --no-audit --no-fund --prefer-offline && \
    npm cache clean --force

# Copy the rest of the application code
COPY --chown=nodejs:nodejs . .

# Expose the port the app runs on
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "app.js"]