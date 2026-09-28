# Bouwt de React-frontend en de Node-backend in één image. De app draait als
# één service op Fly.io: Express serveert zowel de API (/api/*) als de
# gebouwde frontend (alle overige routes), zodat er geen aparte CORS/hosting
# nodig is voor een klein team van ~8 gebruikers.

FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist

# /data is de plek waar het Fly.io-volume gekoppeld wordt: database en
# geüploade foto's overleven daardoor een herstart of nieuwe deploy.
RUN mkdir -p /data/uploads
ENV DB_PATH=/data/data.sqlite
ENV UPLOADS_DIR=/data/uploads
ENV PORT=4000

EXPOSE 4000
CMD ["node", "src/index.js"]
