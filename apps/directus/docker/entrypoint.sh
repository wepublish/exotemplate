#!/bin/sh
set -e

echo "Running database migrations..."
npm run database:migrate

echo "Starting Directus..."
npx directus start &
DIRECTUS_PID=$!

if [ "${RUN_SCHEMA_SYNC:-true}" != "false" ]; then
  echo "Waiting for Directus to become healthy..."
  sleep 20
  echo "Directus is up, running schema sync..."
  npm run schema:load
else
  echo "Skip schema sync"
fi

echo "Schema sync done. Keeping Directus in foreground."
wait "$DIRECTUS_PID"