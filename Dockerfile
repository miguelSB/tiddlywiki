FROM node:8-alpine

WORKDIR /usr/src/app

COPY package*.json ./

COPY . .

RUN npm install -g tiddlywiki
RUN mkdir miguel_wiki
RUN cd miguel_wiki
RUN tiddlywiki miguel_wiki --init server

EXPOSE 8080

CMD tiddlywiki miguel_wiki --listen host=0.0.0.0
