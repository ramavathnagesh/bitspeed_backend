# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schemas
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/schema.postgresql.prisma ./prisma/schema.postgresql.prisma

# Generate Prisma Client for PostgreSQL (production)
RUN cp prisma/schema.postgresql.prisma prisma/schema.prisma && \
    npx prisma generate

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/package*.json ./

# Copy Prisma schema
COPY prisma ./prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Change ownership
RUN chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]

