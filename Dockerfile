FROM oven/bun:latest
RUN bun add -g pm2
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["pm2-runtime", "ecosystem.config.cjs"]
