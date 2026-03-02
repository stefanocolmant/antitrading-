# Use official Node.js 20 slim image
FROM node:20-slim

WORKDIR /app

# Copy only dependency files first (layer cache optimization)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY webhooks.js ./
COPY .env.example ./.env.example

# Railway sets PORT automatically via environment variable
ENV PORT=3000

EXPOSE 3000

CMD ["node", "webhooks.js"]
