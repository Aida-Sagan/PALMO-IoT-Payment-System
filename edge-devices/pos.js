const mqtt = require('mqtt');
const { generatePalmHash } = require('./utils/hash');

function startPOS(brokerUrl, intervalSec, maxHashes, deviceId = 'pos_01') {
    const client = mqtt.connect(brokerUrl);
    let timer;

    client.on('connect', () => {
        client.subscribe(`palmo/pos/${deviceId}/response`);
        
        timer = setInterval(() => {
            const randomId = Math.floor(Math.random() * maxHashes) + 1;
            const hash = generatePalmHash(randomId);
            const amount = Math.floor(Math.random() * 80) + 5;

            const payload = {
                deviceId: deviceId,
                hash: hash,
                amount: amount,
                timestamp: Date.now()
            };

            client.publish('palmo/pos/tx', JSON.stringify(payload));
            console.log(`[POS][${deviceId}] PAYMENT REQUEST: ID ${randomId} on amount ${amount} EUR`);
        }, intervalSec * 1000);
    });

    client.on('message', (topic, message) => {
        const response = JSON.parse(message.toString());
        if (response.status === 'APPROVED') {
            console.log(`[POS][${deviceId}] APPROVED. REMAINING: ${response.remainingBalance} EUR`);
        } else {
            console.log(`[POS][${deviceId}] DENIED. REASON: ${response.reason}`);
        }
    });

    return {
        stop: () => {
            clearInterval(timer);
            client.end();
            console.log('[POS] STOP');
        }
    };
}

module.exports = { startPOS };