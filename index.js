/*** MQTT Z-Way HA module ****************************************************

Version: 1.3
(c) Robin Eggenkamp, 2016
-----------------------------------------------------------------------------
Author: Robin Eggenkamp <robin@edubits.nl>
Description:
   Publishes the status of devices to a MQTT topic and is able
   to set values based on subscribed topics

   MQTTClient based on https://github.com/goodfield/zway-mqtt

 *****************************************************************************/


// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function MQTT (id, controller) {
	MQTT.super_.call(this, id, controller);
}

inherits(MQTT, BaseModule);

_module = MQTT;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

MQTT.prototype.init = function (config) {
	// Call superclass' init (this will process config argument and so on)
	MQTT.super_.prototype.init.call(this, config);

	var self = this;
	self.prefix = "/devices/z-way";

	// Imports
	executeFile(self.moduleBasePath() + "/lib/buffer.js");
	executeFile(self.moduleBasePath() + "/lib/mqtt.js");

	// Init MQTT client
	self.setupMQTTClient();

	// Default counters
	self.reconnectCount = 0;
	self.isStopping = false;
	self.isConnected = false;
	self.isConnecting = true;
	self.client.connect();

	self.callback = _.bind(self.updateDevice, self);
	self.controller.devices.on("change:metrics:level", self.callback);
};

MQTT.prototype.stop = function () {
	var self = this;

	self.controller.devices.off("change:metrics:level", self.callback);

	// Cleanup
	self.isStopping = true;
	self.client.close();

	// Clear any active reconnect timers
	if (self.reconnect_timer) {
		clearTimeout(self.reconnect_timer);
		self.reconnect_timer = null;
	}

	MQTT.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

MQTT.prototype.setupMQTTClient = function () {
	var self = this;

	var mqttOptions = {
		client_id: self.config.clientId,
		will_flag: true,
		will_topic: self.prefix + "/connected",
		will_message: "0",
		will_retain: true
	};

	if (self.config.clientIdRandomize)
		mqttOptions.client_id += "-" + Math.random().toString(16).substr(2, 6);

	if (self.config.user != "none")
		mqttOptions.username = self.config.user;

	if (self.config.password != "none")
		mqttOptions.password = self.config.password;

	// mqttOptions.infoLogEnabled = true;

	self.client = new MQTTClient(self.config.host, parseInt(self.config.port), mqttOptions);
	self.client.onLog(function (msg) { self.log(msg.toString()); });
	self.client.onError(function (error) { self.error(error.toString()); });
	self.client.onDisconnect(function () { self.onDisconnect(); });

	self.client.onConnect(function () {
		self.log("Connected to " + self.config.host + " as " + self.client.options.client_id);

		self.isConnected = true;
		self.isConnecting = false;
		self.isStopping = false;
		self.reconnectCount = 0;

		self.client.subscribe(self.prefix + "/#", {}, _.bind(self.parseMQTTCommand, self));

		// Publish connected notification
		self.publish(self.prefix + "/connected", "2", true);
		self.publishAuxiliaryWBTopics();
	});
};

MQTT.prototype.onDisconnect = function () {
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

MQTT.prototype.updateDevice = function (device) {
	var self = this;
	var deviceType = device.get("deviceType");
	var retained = true;

	if (!deviceType.startsWith("sensor") && deviceType != "switchBinary" && deviceType != "thermostat") {
		return; // exit if type not recognized since not all devices have "metrics:level" propery
	}

	var value = device.get("metrics:level");

	if (deviceType == "switchBinary" || deviceType == "sensorBinary") {
		if (value == 0 || value === "off") {
			value = "0";
		} else if (value == 255 || value === "on") {
			value = "1";
		}
	}

	var topic = self.createDeviceTopic(device);
	self.publish(topic, value, retained);
};

MQTT.prototype.publish = function (topic, value, retained) {
	var self = this;

	if (self.client && self.client.connected) {
		var options = {};
		options.retain = retained;

		self.client.publish(topic, value.toString().trim(), options);
	}
};

MQTT.prototype.parseMQTTCommand = function (topic, payload) {
	var self = this;
	var topic = topic.toString();

	if (!topic.endsWith(self.config.topicPostfixStatus) && !topic.endsWith(self.config.topicPostfixSet))
		return;

	self.controller.devices.each(function (device) {
		var deviceTopic = self.createDeviceTopic(device);

		if (topic == deviceTopic + "/" + self.config.topicPostfixStatus) {
			self.updateDevice(device);
		}

		if (topic == deviceTopic + "/" + self.config.topicPostfixSet) {

			var deviceType = device.get('deviceType');

			if (deviceType.startsWith("sensor")) {
				self.error("Can't perform action on sensor " + device.get("metrics:title"));
				return;
			}

			if (deviceType === "switchMultilevel" && payload !== "on" && payload !== "off" && payload !== "stop") {
				device.performCommand("exact", { level: payload + "%" });
			} else if (deviceType === "thermostat") {
				device.performCommand("exact", { level: payload });
			} else if (deviceType === "switchBinary") {
				if (payload === "0") {
					device.performCommand("off");
				} else if (payload === "1") {
					device.performCommand("on");
				}
			} else {
				device.performCommand(payload);
			}
		}
	});
};

MQTT.prototype.createDeviceTopic = function (device) {
	var self = this;
	return self.prefix + "/controls/" + device.get("metrics:title").toTopicAffix() + " " + device.get("id").split("_").pop().toTopicAffix();
}

MQTT.prototype.publishAuxiliaryWBTopics = function () {
	var self = this;

	self.publish(self.prefix + "/meta/name", "Z-Wave", true);

	self.controller.devices.each(function (device) {
		var deviceType = device.get('deviceType');
		var deviceTopic = self.createDeviceTopic(device);
		// self.publish(deviceTopic + "/meta/z-wave_type", deviceType, true); // uncomment to publish type for all Z-Wave devices

		if (deviceType.startsWith("sensor")) {
			self.publish(deviceTopic + "/meta/type", "value", true);
			self.publish(deviceTopic + "/meta/units", device.get("metrics:scaleTitle"), true);
			self.updateDevice(device);
		} else if (deviceType === "switchBinary") {
			self.publish(deviceTopic + "/meta/type", "switch", true);
			self.updateDevice(device);
		}
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