FROM node:20-alpine

ARG RENDER_GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="${RENDER_GIT_COMMIT}"
LABEL git_commit="${RENDER_GIT_COMMIT}"

WORKDIR /app/backend

ENV NODE_ENV=production
ENV GIT_COMMIT="${RENDER_GIT_COMMIT}"

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
COPY db/migrations /app/db/migrations
COPY frontend /app/frontend

EXPOSE 10000

CMD ["npm", "start"]
