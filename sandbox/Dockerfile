# Blast Door sandbox image. Pinned by digest. Every browser task and every repro test
# runs in a fresh container from this image, as a non-root user, with no secrets.
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Only Chromium is used. Drop the other engines to shrink the attack surface and the image.
RUN rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-* \
 && npm uninstall -g yarn >/dev/null 2>&1 || true

WORKDIR /opt/runner
COPY runner/package.json runner/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY runner/*.mjs ./
RUN chmod -R a-w /opt/runner

USER pwuser
ENTRYPOINT ["node", "/opt/runner/runner.mjs"]
