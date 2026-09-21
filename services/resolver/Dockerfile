# yt-dlp ต้องการ python3 — ติดตั้งแยก layer เพื่อ cache
FROM node:26-alpine
RUN apk add --no-cache python3 py3-pip \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp==2026.8.19
WORKDIR /app
COPY index.js .
EXPOSE 3002
USER node
CMD ["node", "index.js"]
