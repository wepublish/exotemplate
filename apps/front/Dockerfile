FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build-Marke: NEXT_PUBLIC_* muss WAEHREND `next build` gesetzt sein, damit der
# Wert in das Client-Bundle eingebacken wird. Wird von scripts/deploy-front.sh
# als --build-arg BUILD_SHA=<commit> uebergeben; ohne Angabe bleibt es "dev".
ARG BUILD_SHA=dev
ENV NEXT_PUBLIC_BUILD_SHA=$BUILD_SHA
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm","start"]
