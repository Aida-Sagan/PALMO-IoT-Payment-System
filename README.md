# PALMO-IoT-Payment-System
Proof-of-concept palm-payment system built with IoT tools. Node.js edge devices (point of sale, top-up, registration) exchange events over MQTT, Node-RED routes transactions into InfluxDB as a time-series ledger, and Grafana shows live dashboards. Runs fully in Docker.


﻿# PALMO project

PALMO is a decentralized IoT proof-of-concept designed to demonstrate usage of industry grade tehonlogy stack
**MQTT, Node-RED, InfluxDB, and Grafana**. 

We decided that working with actual biometry is too out of subject scope. Instead system simply uses template hash generators. We assume, that in real life raw palm scanner output won't be sent to another device.

## System overview

1. **Edge devices:** Node.js devices generating biometric telemetry.
   - `Registrator`: Enrolls new users and sets initial deposits.
   - `POS terminal`: Requests transactions using only biometric hashes.
   - `Top-up terminal`: Allows balance refilling.
2. **Transport Layer:** Eclipse Mosquitto (MQTT) handling asynchronous Pub/Sub messaging.
3. **Orchestration Layer:** Node-RED acts as the central middleware, performing business logic (balance validation, registration)
4. **Data Persistence:** InfluxDB v2 acts as an immutable financial ledger (Time-Series DB).
5. **Visualization:** Grafana provides real-time monitoring and analytics.


 ## How to run
Docker and Docker Compose are required to run on your machine. Everything else comes packed and ready.

Clone the repository:
```bash
   git clone https://github.com/DaurKas/palmo_iot.git
   cd palmo-project
```

Download and put [hand_landmarker.task](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) file into palmo_scanner folder
```
cd .\palmo-scanner\
curl -o hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
cd ..
```

Build and start the entire ecosystem in detached mode:
```bash
    docker compose up -d --build  
```
To check simulation logs run
```bash
    docker logs -f palmo-edge-simulator
```

To access web interfaces visit
- Node-RED - [http://localhost:1880](http://localhost:1880)
- InfluxDB - [http://localhost:8086](http://localhost:8086) - admin / BOLZ_oprQ38
- Grafana - [http://localhost:3000](http://localhost:3000) - admin / admin_password


To access palm scanner web interface visit
[http://localhost:8080](http://localhost:8080)

Some helper functions

To start new device:
```bash
node .\edge-devices\utils\addNewDevice.js <pos or topup> <period> <device_ID> <lifetime_sec>
```
To run another instance of simulation. Note, that simulation runs by default after docker container's start up/
```bash
node .\edge-devices\utils\simulation.js <Interval> <MaxHashes> <RunTime> <posCount> <TopupCount>
```



