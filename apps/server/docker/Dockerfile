# build context = repo root (ต้องเห็นทั้ง workspace)
FROM oven/bun:1.4.2-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile \
  && cd apps/server && bun run typecheck

# prod deps แยก stage เพื่อไม่ติด devDependencies ติดมาด้วย
FROM oven/bun:1.4.2-alpine AS prod-deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --production --frozen-lockfile

# runtime: bun รัน TS ได้โดยตรง (ไม่ต้องมี tsx/node)
# bun ใช้ isolated layout: deps เป็น symlink เข้า store ที่ node_modules/.bun ของ root
# จึงต้อง copy ทั้ง root node_modules และ apps/server/node_modules
# migration รันอัตโนมัติใน src/index.ts ก่อน listen
FROM oven/bun:1.4.2-alpine
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules node_modules
COPY --from=prod-deps /repo/apps/server/node_modules apps/server/node_modules
COPY --from=prod-deps /repo/apps/server/package.json apps/server/
COPY --from=prod-deps /repo/packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
EXPOSE 3001
CMD ["bun", "apps/server/src/index.ts"]
