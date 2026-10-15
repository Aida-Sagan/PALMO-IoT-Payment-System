const { startRegistrator } = require('../registrator');
const { startTopUp } = require('../topup');
const { startPOS } = require('../pos');
const BROKER_URL = process.env.MQTT_BROKER || 'mqtt://mosquitto:1883';

// how to run: node simulation.js <Interval> <MaxHashes> <RunTime> <posCount> <TopupCount>
const args = process.argv.slice(2);
const INTERVAL_SEC = args[0] ? parseInt(args[0]) : 2;
const MAX_HASHES = args[1] ? parseInt(args[1]) : 5;
const RUN_TIME_SEC = args[2] ? parseInt(args[2]) : 120;
const POS_COUNT = parseInt(args[3]) || 3;       
const TOPUP_COUNT = parseInt(args[4]) || 2;

console.log('-------------------------------------------\n');
console.log(`PALMO IoT NETwORK SIMULATION START`);
console.log(`INTERVAL: ${INTERVAL_SEC} s`);
console.log(`MAX HASH NUM: ${MAX_HASHES}`);
console.log(`SIM TIME: ${RUN_TIME_SEC} s`);
console.log(`POS NUM: ${POS_COUNT}`);
console.log(`TOPUP NUM: ${TOPUP_COUNT}`);
console.log('--------------------------------------------\n');

const registrar = startRegistrator(BROKER_URL, INTERVAL_SEC, MAX_HASHES);


const posTerminals = [];
const topupTerminals = [];

for (let i = 1; i <= POS_COUNT; i++) {
    let newpos = startPOS(BROKER_URL, INTERVAL_SEC + Math.random() * (5 + i), MAX_HASHES, `pos_${i}`);
    posTerminals.push(newpos);
}
for (let i = 1; i <= TOPUP_COUNT; i++) {
    let newtopup = startTopUp(BROKER_URL, INTERVAL_SEC + Math.random() * 10 + 2, MAX_HASHES, `topup_${i}`);
    topupTerminals.push(newtopup);
}

// const topup = startTopUp(BROKER_URL, INTERVAL_SEC + 2, MAX_HASHES);
// const pos = startPOS(BROKER_URL, INTERVAL_SEC + 1, MAX_HASHES, terminals[0]);
// const pos2 = startPOS(BROKER_URL, INTERVAL_SEC + 2, MAX_HASHES, terminals[1]);
// const pos3 = startPOS(BROKER_URL, INTERVAL_SEC, MAX_HASHES, terminals[2]);

setTimeout(() => {
    console.log('TIMEOUT SIMULATION END');
    
    registrar.stop();
    // topup.stop();
    // pos.stop();
    // pos2.stop();
    // pos3.stop();
    posTerminals.forEach(pos => {
        pos.stop();
    });

    topupTerminals.forEach(topup => {
        topup.stop();
    });

    setTimeout(() => {
        process.exit(0);
    }, 1000);

}, RUN_TIME_SEC * 1000);