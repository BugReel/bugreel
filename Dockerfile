FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY server/ ./server/
COPY dashboard/ ./dashboard/

EXPOSE 3500

VOLUME /app/data

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
