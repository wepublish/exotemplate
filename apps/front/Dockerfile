# Build stage
FROM node:22.22.0-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:22.22.0-trixie-slim AS runtime
LABEL maintainer="Seccom Ltd"
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000
COPY --from=build /app/.output ./.output
CMD ["node", "./.output/server/index.mjs"]
