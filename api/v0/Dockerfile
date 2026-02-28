FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
