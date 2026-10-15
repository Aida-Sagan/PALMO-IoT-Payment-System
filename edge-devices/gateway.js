const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost:1883');
const DEVICE_ID = 'gate_controller_01';

client.on('connect', () => {
  console.log(`[GATE] Connected to mqtt broker with ID: ${DEVICE_ID}`);
  client.subscribe('palmo/gate/command');
});

client.on('message', (topic, message) => {
  const command = JSON.parse(message.toString());
  
  if (command.action === 'OPEN') {
    console.log('\n[GATE ACTUATOR] SUCCESS! OPENING GATES!');
    setTimeout(() => {
      console.log('[GATE ACTUATOR] TIMEOUT! BLOCKING GATES!');
    }, 4000);
  }
});