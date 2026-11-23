#!/bin/sh
set -eu
# The first deployment has no committed migration history yet; db push creates the initial schema.
npx prisma db push
exec node dist/server.js
