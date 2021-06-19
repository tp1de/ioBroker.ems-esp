![Logo](admin/ems-esp.png)
# ioBroker.ems-esp

[![NPM version](https://img.shields.io/npm/v/iobroker.ems-esp.svg)](https://www.npmjs.com/package/iobroker.ems-esp)
[![Downloads](https://img.shields.io/npm/dm/iobroker.ems-esp.svg)](https://www.npmjs.com/package/iobroker.ems-esp)
![Number of Installations (latest)](https://iobroker.live/badges/ems-esp-installed.svg)
![Number of Installations (stable)](https://iobroker.live/badges/ems-esp-stable.svg)
[![Dependency Status](https://img.shields.io/david/tp1de/iobroker.ems-esp.svg)](https://david-dm.org/tp1de/iobroker.ems-esp)

[![NPM](https://nodei.co/npm/iobroker.ems-esp.png?downloads=true)](https://nodei.co/npm/iobroker.ems-esp/)

**Tests:** ![Test and Release](https://github.com/tp1de/ioBroker.ems-esp/workflows/Test%20and%20Release/badge.svg)

## ems-esp adapter for ioBroker

The adapter supports the heating systems from Bosch Group (Buderus / Junkers /Netfit etc) as supported by the iobroker km200 adapter 
and the ems-esp interface (https://github.com/emsesp/EMS-ESP32) with latest dev version (see below) and the ESP32 chip.

The ems-esp adapter can read and write data from the km200 gateway and/or the ems-esp hardware. 
It can be used for the original Bosch-group gateways or the ems-esp or both in parallel when an IP-gateway like km200 / ip 
inside is available.

The ems-esp adapter reads values from the hardware EMS-bus with installed ems-esp hardware and the adapter is using the REST API V3 interface. 
The Enable API write commands settings within ems-esp has to be enabled for writing values.

The Adapter is only working with the latest Firmware: https://github.com/emsesp/EMS-ESP32/releases/tag/latest
MQTT Settings have to be boolean format 1/0 ! (actual bug in the firmware of ems-esp)

While selecting the checkbox either km200-like device structure is used for ems-esp datafields or the original devices are kept: boiler, thermostat, mixer etc.
When using the km200 gateway in parallel it is recommended to use the km200 data structure. Then all datafields are within same location within object structure.

Unlike the km200 adapter the fields to be used can be defined by the respective csv-file within the adapter instance parameters.
For 1st adapter start it is recommended to use a "*" so select all km200 data-fields.
The adapter then creates a km200.csv file within ../iobroker-data/ems-esp directory. This file can be used for next start of adapter-instance. 


This adapter reads after start values from ems-esp and km200 by http get requests and is capable to subscribe on state changes and send 
the respective http (post) commands back to ems-esp hardware and km200. 

ems-esp read polling is fixed to 15 seconds and to 90 seconds for km200.
 

Most modern heating systems have ip-inside integrated and support energy statistics (recording for total power consumption and warm water (dhw)).
For these systems the powerconsumption statistics for total power consumtion and warm water power consumption can be read (hourly / dayly / monthly).

The checkbox recordings has to be enabled and the database instance (mySQL or influxdb) has to be defined. 
SQL or InfluxDB History adapter need to be installed to use this option.

*** This is only tested yet for mySQL and influxdb v1.8 databases ***

This adapter then creates the respective recording states, enables sql statistics and writes historic database entries using sql commands and is updating the recordings. 
Update is every hour. The values can then be shown by using e.g. the Flot Charts adapter.

Since v 0.9.0 there are statistics states within the objects. The polling time read duration for ems-esp and/or km200 gateway are shown.
Additionally the number of boiler starts per hour / 24 hours and the boiler utilization per hour (0-100%).
If values are filled the boiler efficiency can be calculated based on average boiler temp: (boiler temp + return temp) / 2

For future use (under development) a controls section is created. This is not used yet in v 0.9.0.


## Changelog

### 0.9.1
* (Thomas Petrick) Adjust for different boolean formats

### 0.9.0
* (Thomas Petrick) Rework Adapter for some statistics and prepare for heating control (under development)

### 0.8.0
* (Thomas Petrick) REST API V3 and js-controller v3.3.x and support of influxdb for recordings

### 0.7.5
* (Thomas Petrick) REST API V3 and js-controller v3.3.x

### 0.7.0
* (Thomas Petrick) REST API V3

### 0.6.3
* (Thomas Petrick) Encrypted password

### 0.6.2
* (Thomas Petrick) Select all km200 datapoints without csv file (*)

### 0.6.1
* (Thomas Petrick) New parameters & selection to use km200 or ems-esp device tree structure

### 0.6.0
* (Thomas Petrick) 1st working adapter with rest api

## License
MIT License

Copyright (c) 2021 Thomas Petrick 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."# iobroker.ems-esp" 
