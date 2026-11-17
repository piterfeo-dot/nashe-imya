FROM node:22-alpine
WORKDIR /app
COPY server.js index.html ./
COPY fonts ./fonts
# Библиотека Telegram: кладём свою копию, если адрес доступен. Без неё приложение тоже работает.
RUN wget -q -T 15 -O tg.js https://telegram.org/js/telegram-web-app.js || rm -f tg.js
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]
