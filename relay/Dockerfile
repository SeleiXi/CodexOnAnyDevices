FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9000

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js relay.js push-service.js apns-client.js ./

EXPOSE 9000

CMD ["npm", "start"]
