# build context = repo root (ต้องเห็นทั้ง workspace)
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile \
  && cd apps/web && bun run build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
