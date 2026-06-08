FROM node:22.22.0-trixie-slim
LABEL org.opencontainers.image.authors="We.Publish Foundation"
# Scheduled Directus Flows (weekly report, etc.) fire in the process's local
# timezone — the `cron` library is given no explicit timezone. Without TZ the
# container runs in UTC, so a `0 7` cron fires at 09:00 CEST. Europe/Zurich makes
# crons fire at Swiss wall-clock time year-round, tracking the CET/CEST switch.
# Node 22 bundles full ICU, so the named zone resolves without an OS tzdata package.
ENV TZ=Europe/Zurich
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
