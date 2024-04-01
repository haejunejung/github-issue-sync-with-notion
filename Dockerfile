# node version
FROM node:16

WORKDIR /usr/src/app

COPY workflows/ ./

RUN npm install

CMD ["node", "index.js"]