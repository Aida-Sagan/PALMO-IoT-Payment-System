FROM nodered/node-red:latest

RUN npm install node-red-contrib-influxdb

COPY flows.json /data/flows.json
COPY flows_cred.json /data/flows_cred.json