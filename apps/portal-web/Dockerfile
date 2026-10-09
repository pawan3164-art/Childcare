# Production image for the Next.js portal. NEXT_PUBLIC_API_URL is inlined at
# build time, so it is a build arg, not a runtime env var.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "run", "start"]
