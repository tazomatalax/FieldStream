FROM node:20-alpine
WORKDIR /app

# Install openssl for Prisma
RUN apk add --no-cache openssl

# Copy package files and prisma schema
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install all dependencies (including devDependencies for prisma generate)
RUN npm ci || npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src

EXPOSE 3001

# Run migrations and start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
