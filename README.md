# Wiren Board MQTT Z-Way Gateway

Publishes the status of devices to a MQTT topic and is able to set
values based on subscribed topics.

# Installation

Normally the module should be installed from the Z-Way App Store (Menu → Apps → Online).

1. Manual installation of the module from git:
```shell
        # Execute on Wiren Board
        apt install git
        cd /opt/z-way-server/automation/userModules
        git clone https://github.com/wirenboard/wb-mqtt-zway-plugin WBMQTT
```
2. To update to last version from this repo:
```shell
        cd /opt/z-way-server/automation/userModules/WBMQTT
        git pull
```
# Usage

Add an instance of the app through Z-Wave interface (Menu → Apps → Local Apps). No configuration needed. All configuration fields are skipped.

If new device was added to Z-Way later, restart module with:
```shell
service z-way-server restart
```

# Acknowledgements

I want to thank @Edubits for developing this module. It's only slightly simplified to work with Wiren Board and switched to internal Z-Way MQTT library. His module can be found at https://github.com/Edubits/Zway-MQTT.
