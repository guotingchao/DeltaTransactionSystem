# 多阶段构建，最小化最终镜像

# 依赖安装（含 devDependencies，用于构建与 Prisma 生成）
FROM node:22-slim AS deps

WORKDIR /app

# 安装基础工具（用于构建阶段的依赖编译）
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 使用 pnpm 并设置镜像源（如无需镜像可移除）
RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./

# 安装全部依赖（确保 prisma CLI 可用）
RUN pnpm install


# 构建阶段：生成 Prisma Client + 构建 NestJS
FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules

# 仅复制 prisma 并先生成 client，避免无关文件变更导致缓存失效
COPY prisma ./prisma
RUN pnpm run prisma:generate

# 复制其余源代码并构建
COPY . .
RUN pnpm build


# 生产依赖裁剪
FROM node:22-slim AS prod-deps

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules

# 为生产依赖生成 Prisma Client（利用现有的 devDependencies）
COPY prisma ./prisma
RUN pnpm run prisma:generate

# 仅保留生产依赖，已生成的 Prisma Client 会被保留
RUN pnpm prune --prod


# 最终运行镜像（最小化体积，无全局 pnpm、无 dev 依赖、无 .env）
FROM node:22-slim AS production

ENV NODE_ENV=production

# 安装 MySQL 客户端工具（包含 mysqldump）
RUN apt-get update && apt-get install -y \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# 创建非 root 用户
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nestjs

WORKDIR /app

# 复制构建产物与生产依赖
COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# 确保可写目录存在（root 权限下创建并赋权）
RUN mkdir -p ./public && chown -R nestjs:nodejs ./public

# 运行端口
EXPOSE 3002

# 切换为非 root 用户运行
USER nestjs

# 使用 node 直接启动，避免在最终镜像安装 pnpm
CMD ["node", "dist/src/main.js"]