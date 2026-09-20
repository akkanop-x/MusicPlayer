# build context = repo root (ต้องเห็นทั้ง workspace)
FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @musicplayer/server typecheck \
  && pnpm deploy --filter=@musicplayer/server --prod /out

# runtime: ได้ package เดียว + prod node_modules (tsx อยู่ใน dependencies เพื่อรัน TS ตรง ๆ)
# migration รันอัตโนมัติใน src/index.ts ก่อน listen
FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "src/index.ts"]
