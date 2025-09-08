FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production
COPY src ./src
CMD [ "node", "src/server.js" ]