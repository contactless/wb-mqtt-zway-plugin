/*** MQTT Z-Way HA module ****************************************************

Version: 1.3
(c) Robin Eggenkamp, 2016
-----------------------------------------------------------------------------
Author: Robin Eggenkamp <robin@edubits.nl>
Description:
   Publishes the status of devices to a Wiren Board MQTT topic and is able
   to set values based on subscribed topics

   MQTTClient based on https://github.com/goodfield/zway-mqtt

 *****************************************************************************/


// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function WBMQTT (id, controller) {
	WBMQTT.super_.call(this, id, controller);
}

inherits(WBMQTT, AutomationModule);

_module = WBMQTT;

WBMQTT.prototype.log = function (message) {
	if (undefined === message) return;
	console.log('[' + this.constructor.name + '-' + this.id + '] ' + message);
};

WBMQTT.prototype.error = function (message) {
	if (undefined === message) message = 'An unknown error occured';
	var error = new Error(message);
	console.error('[' + this.constructor.name + '_' + this.id + '] ' + error.stack);
};

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

WBMQTT.prototype.init = function (config) {
	// Call superclass' init (this will process config argument and so on)
	WBMQTT.super_.prototype.init.call(this, config);

	var self = this;
	self.prefix = "/devices/z-way";

	// Default counters
	self.reconnectCount = 0;
	self.isStopping = false;
	self.isConnected = false;
	self.isConnecting = true;

	// Init MQTT client

	if (self.config.user != "none" && self.config.password != "none") {
		self.client = new mqtt(self.config.host, parseInt(self.config.port), self.config.user, self.config.password, self.config.clientId);
	}
	else
		self.client = new mqtt(self.config.host, parseInt(self.config.port), self.config.clientId);

	self.client.ondisconnect = function () { self.onDisconnect(); };
	self.client.onconnect = function () { self.onConnect(); };
	self.client.onmessage = function (topic, payload) { self.onMessage(topic, payload); };

	self.updateCallback = _.bind(self.publishDeviceValue, self);
	self.controller.devices.on("change:metrics:level", self.updateCallback);

	self.addСallback = _.bind(self.addDevice, self);
	self.controller.devices.on('created', self.addСallback);

	self.removeСallback = _.bind(self.removeDevice, self);
	self.controller.devices.on('removed', self.removeСallback);

	self.client.connect();
};

WBMQTT.prototype.stop = function () {
	var self = this;

	// Cleanup
	self.isStopping = true;
	self.client.close();

	// Clear any active reconnect timers
	if (self.reconnect_timer) {
		clearTimeout(self.reconnect_timer);
		self.reconnect_timer = null;
	}

	WBMQTT.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

WBMQTT.prototype.onConnect = function(){
	var self = this;
	self.log("Connected to " + self.config.host + " as " + self.config.clientId);

	self.isConnected = true;
	self.isConnecting = false;
	self.isStopping = false;
	self.reconnectCount = 0;

	self.client.subscribe(self.prefix + "/#");

	// Publish connected notification
	self.publish(self.prefix + "/connected", "2", true);
	self.publish(self.prefix + "/meta/name", "Z-Wave", true);

	self.controller.devices.each(function (device){
		self.publishDeviceMeta(device);
		self.publishDeviceValue(device);
	});
}

WBMQTT.prototype.addDevice = function (device){
	var self = this;

	self.log('Add new device');
	self.publishDeviceMeta(device);
	self.publishDeviceValue(device);
};

WBMQTT.prototype.removeDevice = function (device){
	var self = this;

	self.log('Remove device');
	self.removeDeviceMeta(device);
	self.removeDeviceValue(device);
};

WBMQTT.prototype.onDisconnect = function () {
	var self = this;

	self.controller.devices.off("change:metrics:level", self.updateCallback);
	self.controller.devices.off("created", self.addСallback);
	self.controller.devices.off("removed", self.removeСallback);

	// Reset connected flag
	if (self.isConnected === true) self.isConnected = false;

	// Reset connecting flag
	if (self.isConnecting === true) self.isConnecting = false;

	if (self.isStopping) {
		self.log("Disconnected due to module stop, not reconnecting");
		return;
	}

	self.error("Disconnected, will retry to connect...");

	// Setup a connection retry
	self.reconnect_timer = setTimeout(function() {
		if (self.isConnecting === true) {
			self.log("Connection already in progress, cancelling reconnect");
			return;
		}

		if (self.isConnected === true) {
			self.log("Connection already open, cancelling reconnect");
			return;
		}

		self.log("Trying to reconnect (" + self.reconnectCount + ")");

		self.reconnectCount++;
		self.isConnecting = true;
		self.client.connect();

		self.log("Reconnect attempt finished");
	}, Math.min(self.reconnectCount * 1000, 60000));
};

WBMQTT.prototype.onMessage = function (topic, payload) {
	var self = this;
	//var topic = topic.toString();
	var payload = byteArrayToString(payload);

	if (!topic.endsWith(self.config.topicPostfixSet))
		return;

	self.controller.devices.each(function (device) {
		var deviceTopic = self.getDeviceTopic(device);

		if (topic == deviceTopic + "/" + self.config.topicPostfixSet) {

			var deviceType = device.get('deviceType');

			self.log("New message " + payload);
			self.log("DeviceType " + deviceType);

			switch (deviceType){
				case zWaveDeviceType.battery:
				case zWaveDeviceType.sensorBinary:
				case zWaveDeviceType.sensorMultilevel:
				case zWaveDeviceType.toggleButton:
					device.performCommand(payload);
					break;
				case zWaveDeviceType.doorlock:
					if (payload === "0") {
						device.performCommand("close");
					} else if (payload === "1") {
						device.performCommand("open");
					} else {
						device.performCommand(payload);
					}
					break;
				case zWaveDeviceType.switchBinary:
					if (payload === "0") {
						device.performCommand("off");
					} else if (payload === "1") {
						device.performCommand("on");
					} else {
						device.performCommand(payload);
					}
					break;
				case zWaveDeviceType.thermostat:
				case zWaveDeviceType.switchMultilevel:
					var level = parseInt(payload);
					if (!isNaN(level)){
						device.performCommand("exact", { level: payload + "%" });
					} else {
						device.performCommand(payload);
					}
					break;
				default:
					self.log("OnMessage callback does not support " + deviceType + "device type");
					break;
			}
		}
	});
};


WBMQTT.prototype.publish = function (topic, value, retained) {
	var self = this;

	if (self.client && self.isConnected) {
		self.client.publish(topic, value.toString().trim());
	}
};

WBMQTT.prototype.getDeviceTopic = function (device) {
	var self = this;
	return self.prefix + "/controls/" + device.get("metrics:title").toTopicAffix() + " " + device.get("id").split("_").pop().toTopicAffix();
};

WBMQTT.prototype.getDeviceValueArray = function (device){
	var self = this;
	var deviceType = device.get("deviceType");

	deviceTopicValue = new Array();

	addDevice = function (topic,value){
		var item= [topic, value];
		deviceTopicValue.push(item);
	};

	if (!(deviceType in zWaveDeviceType)){
		self.log("Unhandled device type " + deviceType);
		return deviceTopicValue;
	}

	var value = device.get("metrics:level");
	if (typeof value == "undefined"){
		var id = device.get("id");
		self.error("Device " + id + " metrics:level undefined");
		return deviceTopicValue;
	}

	switch (deviceType){
		case zWaveDeviceType.doorlock:
		case zWaveDeviceType.switchBinary:
		case zWaveDeviceType.sensorBinary:
			if (value == 0 || value === "off" || value == "closed") {
				value = "0";
			} else if (value == 255 || value === "on" || value == "open") {
				value = "1";
			}
			break;
		default:
			break;
	}

	addDevice(self.getDeviceTopic(device), value);
	return deviceTopicValue;
};

WBMQTT.prototype.publishDeviceValue = function (device) {
	var self = this;

	var deviceArray = self.getDeviceValueArray(device);

	self.log("Publish Device Value " + device.get("deviceType"));

	deviceArray.forEach(function (item){
		var value = item.pop();
		var topic = item.pop();
		self.publish(topic,value, true);
	});
};

WBMQTT.prototype.removeDeviceValue = function (device) {
	var self = this;

	var deviceArray = self.getDeviceValueArray(device);

	self.log("Remove Device Value " + device.get("deviceType"));

	deviceArray.forEach(function (item){
		var value = item.pop();
		var topic = item.pop();
		self.publish(topic,"", true);
	});
};

WBMQTT.prototype.getDeviceMetaArray = function (device){
	var self = this;

	var deviceType = device.get('deviceType');
	var deviceMetaTopic = self.getDeviceTopic(device) + "/meta";

	var metaTopicValue = new Array();
	var metaJSON = {};

	var addMetaTopicValue = function (topic, value){
		metaTopicValue.push([deviceMetaTopic + "/" + topic, value]);
		metaJSON[topic] = value;
	}

	var addMetaJSON = function (){
		metaTopicValue.push([deviceMetaTopic, JSON.stringify(metaJSON)]);
	}

	addMetaTopicValue("z-wave_type", deviceType); 	
	switch (deviceType){
		case zWaveDeviceType.thermostat:
			addMetaTopicValue("type", "range");
			addMetaTopicValue("max", device.get("metrics:max"));
			break;
		case zWaveDeviceType.doorlock:
		case zWaveDeviceType.switchBinary:
			addMetaTopicValue("type", "switch");
			break;
		case zWaveDeviceType.switchMultilevel:
			addMetaTopicValue("type", "range");
			// Range [0;99] is caused by "max" command, which set level to 99.
			// In real case with Fibaro Dimmer 2 max level can be 100.
			addMetaTopicValue("max", 99);
			break;
		case zWaveDeviceType.sensorBinary:
			addMetaTopicValue("type", "switch");
			addMetaTopicValue("readonly", "true");
			break;
		case zWaveDeviceType.battery:
		case zWaveDeviceType.sensorMultilevel:
			addMetaTopicValue("type", "value");
			addMetaTopicValue("units", device.get("metrics:scaleTitle"));
			break;
		case zWaveDeviceType.toggleButton:
			addMetaTopicValue("type", "pushbutton");
			break;
		default:
			//This case should be used for
			//this unsupported device types
			//switchControl:"switchControl",
			//sensorMultiline:"sensorMultiline",
			//sensorDiscrete:"sensorDiscrete",
			//camera: "camera",
			//text:"text",
			//switchRGB:"switchRGB"
			self.log("Unhandled deviceType " + deviceType);
			break;
	};
	addMetaJSON();

	return metaTopicValue;
}

WBMQTT.prototype.publishDeviceMeta = function (device){
	var self = this;

	self.log("Publish Device Meta " + device.get("deviceType"));

	var metaArray = self.getDeviceMetaArray(device);
	metaArray.forEach(function (item){
		var value = item.pop();
		var topic = item.pop();
		self.publish(topic,value, true);
	});
};

WBMQTT.prototype.removeDeviceMeta = function (device){
	var self = this;
	var metaArray = self.getDeviceMetaArray(device);

	self.log("Remove Device Meta " + device.get("deviceType"));

	metaArray.forEach(function (item){
		var value = item.pop();
		var topic = item.pop();
		self.publish(topic,"", true);
	});
};

// ----------------------------------------------------------------------------
// --- Utility methods
// ----------------------------------------------------------------------------

String.prototype.toCamelCase = function() {
	return this
		.replace(/\s(.)/g, function($1) { return $1.toUpperCase(); })
		.replace(/\s/g, '')
		.replace(/^(.)/, function($1) { return $1.toLowerCase(); });
};

String.prototype.startsWith = function (s) {
	return this.length >= s.length && this.substr(0, s.length) == s;
};

String.prototype.endsWith = function (s) {
	return this.length >= s.length && this.substr(this.length - s.length) == s;
};

String.prototype.toTopicAffix = function () {
	return this
		.replace(/[+#]/g, "");
};

// ----------------------------------------------------------------------------
// --- Device types enum
// ----------------------------------------------------------------------------

const zWaveDeviceType = Object.freeze({
	battery: "battery",
	doorlock: "doorlock",
	thermostat:"thermostat",
	switchBinary:"switchBinary",
	switchMultilevel:"switchMultilevel",	
	sensorBinary: "sensorBinary",
	sensorMultilevel: "sensorMultilevel",
	toggleButton: "toggleButton",
	//Unsupported device types
	//switchControl:"switchControl",
	//sensorMultiline:"sensorMultiline",
	//sensorDiscrete:"sensorDiscrete",	
	//camera: "camera",
	//text:"text",
	//switchRGB:"switchRGB"
});