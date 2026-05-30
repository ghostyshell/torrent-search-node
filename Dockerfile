# Use the official Node.js runtime as the base image
FROM node:22-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set the working directory inside the container
WORKDIR /app

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory to nodejs user before copying files
RUN chown -R nodejs:nodejs /app

# Copy package.json and package-lock.json with correct ownership
COPY --chown=nodejs:nodejs package*.json ./

# Switch to nodejs user before installing dependencies
USER nodejs

# Install dependencies as nodejs user
RUN npm ci --only=production --no-audit --no-fund --prefer-offline && \
    npm cache clean --force

# Copy the rest of the application code with correct ownership
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