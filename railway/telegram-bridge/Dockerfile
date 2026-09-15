FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git tmux curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bun is required by the official Claude Code channel plugins (Telegram/Discord/iMessage).
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /repo
COPY . .

COPY railway/telegram-bridge/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
