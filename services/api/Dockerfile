# Production image for the NestJS API. Debian slim (not alpine): sharp and
# Prisma ship glibc binaries. Dev dependencies are kept so the same image can
# run `prisma migrate deploy` and the bucket-init script as one-shot jobs.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
