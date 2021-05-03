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
and the ems-esp interface (https://github.com/emsesp/EMS-ESP32) with tested version > 3.0.3 b4 and the ESP32 chip.

The ems-esp adapter reads values from the hardware EMS-bus with installed ems-esp hardware and the adapter is using the rest api interface. 
The Enable API write commands settings within ems-esp has to be enabled for writing values.

While selecting the checkbox either km200-like device structure is used for ems-esp datafields or the original devices are kept: boiler, thermostat, mixer etc.


When an IP-gateway like km200 / ip inside is available, the gateway can be integrated as well (read & write).
Unlike the km200 adapter the fields to be used has to be defined in an csv file (standard ems.csv) within the iobroker-data directory.

This adapter then reads values from ems-esp and km200 by http get requests and is capable to subscribe on state changes and send 
the respective http (post) commands back to ems-esp hardware and km200. 

ems-esp read polling is fixed to 15 seconds and to 90 seconds for km200.
 
km200 datafields can be selected using a csv-file within iobroker-data directory. When filename is empty only ems-esp data will be read.
Using a wildcard * within csv-file parameter field will read all available km200 datapoints.

The ems.csv file contains the following status information per datapoint: (separated by ";")

column 1: km200 field (e.g. iobroker state like: heatingCircuits.hc1.actualSupplyTemperature or km200 style heatingCircuits/hc1/actualSupplyTemperature)

column 2: ioBroker device new for state tree (e.g. heatSources instead of boiler) - actually not used since managed within adapter code

column 3: ems-esp device

column 4: ems-esp id like hc1 / hc2 

column 5: ems-esp field


By start of the adapter all ems-esp states will be initialized by by reading the devices by using the system info command and then getting all fields available 
by device info and device field command. Therefore any ems.csv is not used for ems-esp states and therefore not needed.

The km200 datafields are initialized and processed when the column 1 within ems.csv file contains data and the column 5 (ems-esp field) is empty.
Whenever ems-esp field is available this one is used, when not available then km200 field is used and the respective state is generated.
Usi´ng the wildcard option will override this logic and all km200 fields will be read.

Most modern heating systems have ip-inside integrated and support energy statistics (recording for total power consmption and warm water (dhw)).
For these systems the powerconsumption statistics for total power consumtion and warm water power consumption can be read (hourly / dayly / monthly).

The checkbox recordings has to be enabled and the database instance (mySQL) has to be defined. SQL History adapter need to be installed with mySQL.

***** This is only tested yet for mySQL databases *****

This adapter then creates the respective recording states, enables sql statistics and writes historic database entries using sql commands and is updating the recordings. 
Update is every hour. The values can then be shown by using e.g. the Flot Charts adapter.




## Changelog

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
