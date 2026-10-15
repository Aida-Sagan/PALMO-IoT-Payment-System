const mqtt = require('mqtt');
const crypto = require('crypto');
const { startTopUp } = require('../topup');
const { startPOS } = require('../pos');

const args = process.argv.slice(2);

if (args.length != 4) {
    console.error("Wrong num of arguments");
    console.error("Expected: node addNewDevice.js <pos|topup> <period> <device_ID> <lifetime_sec>");
    process.exit(1);
}

const type = args[0].toLowerCase();
const periodSec = parseFloat(args[1]);
const deviceId = args[2];
const lifetimeSec = parseInt(args[3]);
var newDevice
if (!['pos', 'topup'].includes(type)) {
    console.error("Allowed only device of type 'pos' or 'topup'");
    process.exit(1);
}

const BROKER_URL = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
if (type == 'pos') {
    let newpos = startPOS(BROKER_URL, periodSec,100,deviceId);
    newDevice = newPos
    setTimeout(() => {
        console.log(`\n[${deviceId.toUpperCase()}] Lifetime ended`);
        cleanupAndExit(newpos);}, lifetimeSec * 1000);
}
if (type == 'topup') {
    let newtopup = startTopUp(BROKER_URL, periodSec,100,deviceId);
    newDevice = newtopup
    setTimeout(() => {
        console.log(`\n[${deviceId.toUpperCase()}] Lifetime ended`);
        cleanupAndExit(newtopup);}, lifetimeSec * 1000);
}

function cleanupAndExit(device) {
    device.stop();
    process.exit(0);
}

process.on('SIGINT', () => {
    console.log(`\n [${deviceId.toUpperCase()}] Ctrl+C`);
    cleanupAndExit(newDevice);
});