FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY lots.html /usr/share/nginx/html/lots.html
COPY farms.html /usr/share/nginx/html/farms.html

EXPOSE 80
