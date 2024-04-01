# node version
FROM node:16

WORKDIR /usr/src/app

COPY workflows/ ./workflows

RUN npm install

CMD ["node", "workflows/github-with-notion/index.js"]