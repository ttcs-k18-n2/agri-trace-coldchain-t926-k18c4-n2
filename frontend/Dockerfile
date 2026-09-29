FROM nginx:1.27-alpine

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL git_commit="${GIT_COMMIT}"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY lots.html /usr/share/nginx/html/lots.html
COPY farms.html /usr/share/nginx/html/farms.html

EXPOSE 80
