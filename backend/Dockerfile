FROM node:20-alpine

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL git_commit="${GIT_COMMIT}"

WORKDIR /app

ENV NODE_ENV=production
ENV GIT_COMMIT="${GIT_COMMIT}"

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000

CMD ["npm", "start"]
