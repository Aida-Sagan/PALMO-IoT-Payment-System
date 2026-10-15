const mqtt = require('mqtt');
const { generatePalmHash } = require('./utils/hash');

function startTopUp(brokerUrl, intervalSec, maxHashes, deviceId) {
    const client = mqtt.connect(brokerUrl);
    let timer;

    client.on('connect', () => {
        client.subscribe(`palmo/topup/${deviceId}/status`);
        
        timer = setInterval(() => {
            const randomId = Math.floor(Math.random() * maxHashes) + 1;
            const hash = generatePalmHash(randomId);
            const topupAmount = Math.floor(Math.random() * 50) + 10;

            const payload = {
                hash: hash,
                amount: topupAmount,
                timestamp: Date.now(),
                deviceId: deviceId
            };

            client.publish('palmo/topup', JSON.stringify(payload));
            console.log(`[TOP-UP][${deviceId}] TOP UP REQUEST: ID ${randomId}  ON AMOUNT ${topupAmount} EUR`);
        }, intervalSec * 1000);
    });

    client.on('message', (topic, message) => {
        const response = JSON.parse(message.toString());
        if (response.status === 'SUCCESS') {
            console.log(`[TOP-UP][${deviceId}] RESPONSE: ${response.message}`);
        }
    });

    return {
        stop: () => {
            clearInterval(timer);
            client.end();
            console.log(`[TOP-UP][${deviceId}] STOP.`);
        }
    };
}

module.exports = { startTopUp };