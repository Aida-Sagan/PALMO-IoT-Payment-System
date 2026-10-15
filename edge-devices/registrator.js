const mqtt = require('mqtt');
const { generatePalmHash } = require('./utils/hash');

function startRegistrator(brokerUrl, intervalSec, maxHashes) {
    const client = mqtt.connect(brokerUrl);
    let timer;

    client.on('connect', () => {
        client.subscribe('palmo/register/status');
        
        timer = setInterval(() => {
            const randomId = Math.floor(Math.random() * maxHashes) + 1;
            const hash = generatePalmHash(randomId);
            const initialBalance = Math.floor(Math.random() * 200) + 50;

            const payload = {
                hash: hash,
                name: `User_${randomId}`,
                balance: initialBalance,
                timestamp: Date.now()
            };

            client.publish('palmo/register', JSON.stringify(payload));
            console.log(`[REGISTRATOR] REGISTRATION REQUEST: User_${randomId} (BALANCE: ${initialBalance} EUR)`);
        }, intervalSec * 1000);
    });

    client.on('message', (topic, message) => {
        const response = JSON.parse(message.toString());
        if (response.status === 'SUCCESS') {
            console.log(`[REGISTRATOR] RESPONSE: ${response.message}`);
        }
    });

    return {
        stop: () => {
            clearInterval(timer);
            client.end();
            console.log('[REGISTRATOR] STOP');
        }
    };
}

module.exports = { startRegistrator };