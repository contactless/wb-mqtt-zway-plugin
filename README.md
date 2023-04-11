# Wiren Board MQTT Z-Way Gateway

Publishes the status of devices to a MQTT topic and is able to set
values based on subscribed topics.

# Installation

1. Install module:
```shell
        # Execute on Wiren Board
        apt install git
        cd /opt/z-way-server/automation/userModules
        git clone https://github.com/wirenboard/wb-mqtt-zway-plugin.git WBMQTTNative
```
1. To update to last version in this repo:
```shell
        cd /opt/z-way-server/automation/userModules/WBMQTTNative
        git pull
```
# Usage

Add an instance of the app through Z-Wave interface (Menu - Apps - Local Apps). No configuration needed. All configuration fields are skipped.

# Acknowledgements for older versions

I want to thank @Edubits for developing this module. It's only slightly simplified to work with Wiren Board. His module can be found at https://github.com/Edubits/Zway-MQTT.

I want to thank @goodfield for finding and fixing a fully JavaScript MQTTClient which I could use in this module as well. His module can be found at https://github.com/goodfield/zway-mqtt.
