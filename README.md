# Wiren Board MQTT Z-Way Gateway

Publishes the status of devices to a MQTT topic and is able to set
values based on subscribed topics.

# Installation

1. Install module:
```shell
        # Execute on Wiren Board
        apt install git
        cd /opt/z-way-server/automation/userModules
        git clone https://github.com/wirenboard/wb-mqtt-zway-plugin.git WBMQTT
```
1. To update to last version in this repo:
```shell
        cd /opt/z-way-server/automation/userModules/WBMQTT
        git pull
```
# Usage

Add an instance of the app through Z-Wave interface (Menu - Apps - Local Apps). No configuration needed. All configuration fields are skipped.
