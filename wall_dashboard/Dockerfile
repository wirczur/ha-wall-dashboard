# The frontend and server are pre-built into app/dist (see app/package.json "build"),
# so the image only installs the two runtime dependencies (express, ws).
FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data

# FFmpeg: IVR sounds played louder / quieter than the file (go2rtc does not accept filters from the API)
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

COPY app/dist ./dist

EXPOSE 8099 8100
CMD ["node", "dist/server/index.js"]
