FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# This image is an operations example. Install or mount the Codex CLI/auth config
# according to your deployment policy before running it against real repositories.
CMD ["npm", "run", "start:runner"]
