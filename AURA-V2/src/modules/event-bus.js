const EventEmitter = require('events');
class MissionEventBus extends EventEmitter {}
const eventBus = new MissionEventBus();
module.exports = eventBus;
