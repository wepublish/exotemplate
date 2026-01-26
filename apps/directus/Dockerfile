FROM node:22.22.0-trixie-slim
LABEL org.opencontainers.image.authors="We.Publish Foundation"
WORKDIR /cms
COPY . .
RUN mkdir -p /cms/.cache /cms/node_modules/.directus /.pm2 && \
    chmod -R 777 /cms/.cache /cms/node_modules/.directus /.pm2 && \
    npm uninstall directus-extension-models && \
    npm install && \
    npm run build:extensions && \
    mv docker/entrypoint.sh entrypoint.sh
EXPOSE 8055
CMD ["/bin/sh", "/cms/entrypoint.sh"]
