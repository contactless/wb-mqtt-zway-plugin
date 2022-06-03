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

inherits(WBMQTT, BaseModule);

_module = WBMQTT;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

WBMQTT.prototype.init = function (config) {
	// Call superclass' init (this will process config argument and so on)
	WBMQTT.super_.prototype.init.call(this, config);

	var self = this;
	self.prefix = "/devices/z-way";

	executeFile(self.moduleBasePath() + "/lib/buffer.js");
	executeFile(self.moduleBasePath() + "/lib/mqtt.js");

	// Default counters
	self.reconnectCount = 0;
	self.isStopping = false;
	self.isConnected = false;
	self.isConnecting = true;

	// Init MQTT client

	var mqttOptions = {
		client_id: self.config.clientId,
		will_flag: true,
		will_topic: self.prefix + "/connected",
		will_message: "0",
		will_retain: true
	};

	if (self.config.clientIdRandomize)
		client_id += "-" + Math.random().toString(16).substr(2, 6);

	if (self.config.user != "none")
		mqttOptions.username = self.config.user;

	if (self.config.password != "none")
		mqttOptions.password = self.config.password;

	self.client = new WBMQTTClient(self.config.host, parseInt(self.config.port), mqttOptions);

	self.client.onLog(function (msg) { self.log(msg.toString()); });
	self.client.onError(function (error) { self.error(error.toString()); });
	self.client.onDisconnect(function () { self.onDisconnect(); });
	self.client.onConnect(function () { self.onConnect();});
	self.client.connect();

	self.updateCallback = _.bind(self.publishDeviceValue, self);
	self.controller.devices.on("change:metrics:level", self.updateCallback);

	self.addСallback = _.bind(self.addDevice, self);
	self.controller.devices.on('created', self.addСallback);
};

WBMQTT.prototype.stop = function () {
	var self = this;

	self.controller.devices.off("change:metrics:level", self.updateСallback);
	self.controller.devices.off("created", self.addСallback);


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
	self.log("Connected to " + self.config.host + " as " + self.client.options.client_id);

	self.isConnected = true;
	self.isConnecting = false;
	self.isStopping = false;
	self.reconnectCount = 0;

	self.client.subscribe(self.prefix + "/#", {}, _.bind(self.onMessage, self));

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

WBMQTT.prototype.onDisconnect = function () {
	var self = this;

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
	var topic = topic.toString();

	if (!topic.endsWith(self.config.topicPostfixSet))
		return;

	self.controller.devices.each(function (device) {
		var deviceTopic = self.createDeviceTopic(device);

		if (topic == deviceTopic + "/" + self.config.topicPostfixSet) {

			var deviceType = device.get('deviceType');

			self.log("New message " + payload);
			self.log("deviceType " + deviceType);

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

	if (self.client && self.client.connected) {
		var options = {};
		options.retain = retained;

		self.client.publish(topic, value.toString().trim());
	}
};

WBMQTT.prototype.createDeviceTopic = function (device) {
	var self = this;
	return self.prefix + "/controls/" + device.get("metrics:title").toTopicAffix() + " " + device.get("id").split("_").pop().toTopicAffix();
}

WBMQTT.prototype.publishDeviceValue = function (device) {
	var self = this;
	var deviceType = device.get("deviceType");
	var retained = true;

	if (!(deviceType in zWaveDeviceType)){
		return;
	}

	self.log("Publish device value");
	self.log("deviceType " + deviceType);

	var value = device.get("metrics:level");
	if (typeof value == "undefined"){
		var id = device.get("id");
		self.error("Device " + id + " metrics:level undefined");
		return;
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

	var topic = self.createDeviceTopic(device);
	self.publish(topic, value, retained);
};

WBMQTT.prototype.publishDeviceMeta = function (device){
	var self = this;

	var deviceType = device.get('deviceType');
	var deviceTopic = self.createDeviceTopic(device);		
	self.publish(deviceTopic + "/meta/z-wave_type", deviceType, true); 

	self.log("Publish device meta");
	self.log("deviceType " + deviceType);

	switch (deviceType){
		case zWaveDeviceType.thermostat:
			self.publish(deviceTopic + "/meta/type", "range", true);
			self.publish(deviceTopic + "/meta/max", device.get("metrics:max"), true);
			break;
		case zWaveDeviceType.doorlock:
		case zWaveDeviceType.switchBinary:
			self.publish(deviceTopic + "/meta/type", "switch", true);
			break;
		case zWaveDeviceType.switchMultilevel:
			self.publish(deviceTopic + "/meta/type", "range", true);
			self.publish(deviceTopic + "/meta/max", 99, true);
			break;
		case zWaveDeviceType.sensorBinary:
			self.publish(deviceTopic + "/meta/type", "switch", true);
			self.publish(deviceTopic + "/meta/readonly", "true", true);
			break;
		case zWaveDeviceType.battery:
		case zWaveDeviceType.sensorMultilevel:
			self.publish(deviceTopic + "/meta/type", "value", true);
			self.publish(deviceTopic + "/meta/units", device.get("metrics:scaleTitle"), true);
			break;
		case zWaveDeviceType.toggleButton:
			self.publish(deviceTopic + "/meta/type", "pushbutton", true);
			break;
		default:
			//switchControl:"switchControl",
			//sensorMultiline:"sensorMultiline",
			//sensorDiscrete:"sensorDiscrete",
			//camera: "camera",
			//text:"text",
			//switchRGB:"switchRGB"
			self.log("Unhandled deviceType " + deviceType);
			break;
	}	
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
	//switchControl:"switchControl",
	sensorBinary: "sensorBinary",
	sensorMultilevel: "sensorMultilevel",
	//sensorMultiline:"sensorMultiline",
	//sensorDiscrete:"sensorDiscrete",
	toggleButton: "toggleButton",
	//camera: "camera",
	//text:"text",
	//switchRGB:"switchRGB"
});