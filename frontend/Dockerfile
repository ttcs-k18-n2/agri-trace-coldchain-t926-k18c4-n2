FROM nginx:1.27-alpine

ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL git_commit="${GIT_COMMIT}"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY styles.css /usr/share/nginx/html/styles.css
COPY app-shell.js /usr/share/nginx/html/app-shell.js
COPY index.html /usr/share/nginx/html/index.html
COPY lots.html /usr/share/nginx/html/lots.html
COPY lot-detail.html /usr/share/nginx/html/lot-detail.html
COPY farms.html /usr/share/nginx/html/farms.html
COPY products.html /usr/share/nginx/html/products.html
COPY harvest.html /usr/share/nginx/html/harvest.html
COPY integrity.html /usr/share/nginx/html/integrity.html

EXPOSE 80
