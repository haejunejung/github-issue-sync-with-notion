# node version
FROM node:18

WORKDIR /usr/src/app

COPY workflows/ ./

RUN npm install

CMD ["node", "index.js"]