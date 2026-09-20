# build context = repo root (ต้องเห็นทั้ง workspace)
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @musicplayer/web build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
