FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
 
# requests every 3 seconds, 100 users, simulates for 86400 seconds
CMD ["node", "utils/simulation.js", "3", "100", "86400", "5", "2"]