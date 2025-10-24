* older changes
## 5.1.0 (2024-12-25)
* error correction on enabling statistics

## 5.0.6 (2024-12-03)
* dependabot updates
* ems-esp: send switchprog updates 3 times (test)

## 5.0.5 (2024-11-22)
* Add native entries to io-package

## 5.0.4 (2024-11-12)
* add missing size attributes for config
* dependabot updates

## 5.0.3 (2024-11-11)
* add missing size attributes for config

## 5.0.2 (2024-11-02)
* check on ems-esp api errors for ../api/system..

## 5.0.1 (2024-11-01)
* update dependencies
* new log entry for private password (km200) since enryption is changed

## 5.0.0 (2024-10-27)
* change encryption for private passwort (km200) - needs to be re-entered

## 4.9.2 (2024-10-27)
* update translations
* responsive design added

## 4.9.1 (2024-10-01)
* update dependencies
* update translations

## 4.9.0 (2024-09-26)
* ems-esp: improve reading for temperatureSensors
* support small screens
* update dependencies
* update translations

## 4.8.0 (2024-08-27)
* ems-esp: disabled parameter to search for extended EMS+ entities due to memory limitations in gateway

## 4.7.2 (2024-08-17)
* ems-esp: enable writing on custom entities

## 4.7.1 (2024-08-17)
* ems-esp: custom entities are now under object structure "custom"

## 4.7.0 (2024-08-16)
* ems-esp: do not allow more then one thermostat for extended own entities
* ems-esp: error correction for holidayModes custom entities

## 4.6.4 (2024-08-14)
* ems-esp: error correction on polling for 3.6.5

## 4.6.3 (2024-08-14)
* small adjustments
* dependabot updates dependencies

## 4.6.2 (2024-08-03)
* ems-esp: re-introduce restart of ems init/polling after firmware version change and 90 seconds waiting time

## 4.6.1 (2024-08-02)
* ems-esp: no version change message if actual version can not be read during polling cycle

## 4.6.0 (2024-08-01)
* disable automatic instance re-start on firmware changes
* ems-esp: new config-structure for extended entities (beta-version)
* ems-esp: support switchProgramModes between level (eco/comfort) and absolute (temperatures) for EMS+ thermostats 
* update dependencies (dependabot)

## 4.5.0 (2024-07-28)
* ems-esp: own entities switchTimes EMS+

## 4.4.5 (2024-07-26)
* ems-esp: adjust to name changes in version 3.7.0-dev.27 - part 2

## 4.4.4 (2024-07-25)
* ems-esp: adjust to name changes in version 3.7.0-dev.27

## 4.4.3 (2024-07-15)
* ems-esp: delete the esp object-structure on start of the adapter instance. It will be rebuild.

## 4.4.2 (2024-07-11)
* ems-esp: update in respect to changes in JSON structure without spaces in System Info
* ems-esp: delete the esp object-structure on start of the adapter instance. It will be rebuild.

## 4.4.1 (2024-07-09)
* avoid crashes when undefined states are changed (old state names in vis)

## 4.4.0 (2024-07-08)
* update dependencies
* test that necessary entities for statistics function are available
* km200: ignore values during polling when value is not within min/max range
* km200: ignore axios read errors on recordings (no error message)
* avoid crashes when undefined states are changed (old state names in vis)
* ems-esp: restart adapter instance on change of firmware version

## 4.3.0 (2024-06-26)
* improve search for EMS+ and EMS 2.0 entities (switchTimes & holidayModes) with raw telegrams
* support different thermostat id's
* change ems-esp warning messages to info on start-up for 3.7 dev versions

## 4.2.0 (2024-06-11)
* ems-esp: process double entity names between boiler and thermostat for dhw
* ems-esp: add original device name to iobroker object name when km200-structure is selected

## 4.1.3 (2024-06-05)
* fix crash on wrong ems-esp ip address

## 4.1.2 (2024-06-03)
* km200 private password might has to be re-entered
* update dependencies (dependabot)

## 4.1.1 (2024-06-03)
* corrections in io-package.json
* install dependabot

## 4.1.0 (2024-06-02)
* BREAKING CHANGES
* use statepicker for jsonConfig (ems-esp energy statistics, boiler efficiency and heating demand)
* new file location for km200.csv file -- breaking change
* old file location for km200.csv file(s) will be deleted by adapter
* new content for selection of database within parameters tab - adpters tries to convert, but please check.

## 4.0.1 (2024-05-31)
* jsonConfig optimization for tablets and medium resolution screens

## 4.0.0 (2024-05-30)
* support different ems-esp bus id's for own states polled
* now with jsonConfig for adapter config
* rework enum attributes for room and function for all adapter states created 
* admin adapter version >= 6.13.16 required - nicer layout with admin version >= 6.17.13

## 3.5.0 (2024-05-15)
* warm water starts not supported anymore within statistics due to name changes within ems-esp firmware 3.7

## 3.4.4 (2024-05-15)
* improve delays between axios get requests for km200 and ems-esp to avoid errors

## 3.4.3 (2024-05-14)
* corrections for reading gateway data for km200 gateway

## 3.4.2 (2024-05-13)
* update dependencies
* replace setTimeout by adapter.delay

## 3.4.1 (2024-04-26)
* correct enum settings for ems-esp gateway on adapter start

## 3.4.0 (2024-04-22)
* changes for ems-esp firmware 3.7.0 
* introduce warnings in log for using ems-esp dev firmware

## 3.3.0 (2024-04-20)
* introduce a new check for ems-esp gateway formatting settings for boolean and enum values
* stop ems-esp polling if wrong settings are detected !

## 3.2.1 (2024-04-17)
* update release script

## 3.2.0 (2024-04-17)
* change for ems-esp firmware 3.7 - add dhw tag

## 3.1.1 (2024-04-11)
* update dependencies and release  script

## 3.1.0 (2024-04-07)
* Update km200 gateway encryption test for wrong passwords
* avoid json error on adapter start for field /gateway/firmware

## 3.0.5 (2024-04-07)
* avoid json error on adapter start for field /gateway/firmware
* update test-and-release worflow
* update license info

## 3.0.4 (2024-04-07)
* avoid json error on adapter start for field /gateway/firmware

## 3.0.3 (2024-03-09)
* improve km200 data read to avoid errors

## 3.0.2 (2024-03-02)
* improve km200 data read to avoid errors - try http get up to 3 times now - especially for recordings

## 3.0.1 (2024-02-25)
* change KM200 error messages for recordings

## 3.0.0 (2024-02-17)
* Node >= 18 required
* update heatdemand weight changes to be effective during active instance
* ems-esp gateway: Raw telegram search for EMS+ thermostats: switchPrograms and holidayModes (RC310/RC300)
* create writable objects / states for switchPrograms and holidayModes
* this function is only active when no km200 gateway is selected - ems-esp gateway only
* improve error messages for km200 (wrong ip / passwords)
* small changes within PDF adapter documentation

## 3.0.0-alpha.2 (2024-02-16)
* Node >= 18 required
* update heatdemand weight changes to be effective during active instance

## 3.0.0-alpha.1 (2024-02-15)
* ems-esp gateway: Raw telegram search for EMS+ thermostats: switchPrograms and holidayModes (RC310/RC300)
* create writable objects / states for switchPrograms and holidayModes
* this function is only active when no km200 gateway is selected - ems-esp gateway only
* improve error messages for km200 (wrong ip / passwords)
* small changes within PDF adapter documentation

## 3.0.0-alpha.0 (2024-02-05)
* Search for ems-esp states for EMS+ thermostats: switchPrograms and holidayModes (RC310/RC300)
* Implement raw telegram search for EMS+ entities and create writable objects / states
* The search is only active when no km200 gateway is selected

## 2.8.0 (2024-02-04)
* influxdb adapter version >= 4.0.2 required 
* store km200 recordings only within defined retention period for influxdb
* delay start of statistics by 5 minutes

## 2.7.5 (2024-02-02)
* allow only positive deltam in config for heat demand function

## 2.7.4 (2024-02-01)
* avoid sql errors on instance start

## 2.7.3 (2024-01-31)
* error correction for heat demand function

## 2.7.2 (2024-01-31)
* error correction for heat demand function

## 2.7.1 (2024-01-30)
* improve error processing for wrongly defined heat demand states

## 2.7.0 (2024-01-28)
* improve heatdemand hysteresis (on: actualtemp < settemp -delta / off > settemp)
* allow heatdemand parameters to be changed within objects (delta & weight) for thermostats and (weighton/weightoff) for heating circuits
* these object changes are lost when adapter restarts.
* show log entries in debug mode now for state changes and heat demand switch on / off

## 2.6.3 (2024-01-04)
* Update dependencies

## 2.6.2 (2023-11-18)
* correct notifications and systeminfo for km200

## 2.6.1 (2023-11-01)
* Avoid crash on adapter start while delete states is used in parameters

## 2.6.0 (2023-10-30)
* Add indicator for connection status of the gateways within instances overview

## 2.5.3 (2023-10-29)
* Replace axios post by axios put for KM200 gateway to secure that write changes are accepted

## 2.5.2 (2023-10-19)
* Update energy statistics and recordings for history and influxdb
* include warning in log that InfluxDB V2 will not be supported in future versions anymore

## 2.5.1 (2023-10-13)
* correct hourly recordings timestamps for km200 (timezone difference)

## 2.5.0 (2023-10-11)
* avoid duplicates on ems-esp energy statistics
* replace request by axios
* some corrections for ems-esp sensors and custom elements
* move database config to parameter page

## 2.4.1 (2023-09-10)
* add parameter to read ems-esp custom elments

## 2.4.0 (2023-09-03)
* integrate custom entities for ems-esp gateway
* rework async functions

## 2.3.3 (2023-08-28)
* error correction mySQL too many connections
* read database name from db-instance settings

## 2.3.2 (2023-08-27)
* optimize SQL access for energy statistics

## 2.3.1 (2023-08-27)
* avoid sql errors within energy statistics for mySQL

## 2.3.0 (2023-08-26)
* New function: ems-esp gateway energy statistics (consumption)
* change sorting order of enegry statistics & recordings in array from new to old

## 2.2.1 (2023-08-20)
* trim km200 passwords
* require node version >= 16
* update dependencies

## 2.2.0 (2023-08-09)
* enable history adapter for recordings and statistics
* update km200 states for valid range of min/max 
* avoid warnings from v2.1 related to min/max in combination with km200 state-list
* update dependencies

## 2.1.0 (2023-07-30)
* ems-esp V3.6 release preparation
* error corrections for ems-esp state changes

## 2.0.3 (2023-07-25)
* error corrections for km200 read

## 2.0.2 (2023-07-24)
* re-add parameters for room / function
* change statistics update intervall for number of starts to every 5 minutes

## 2.0.1 (2023-07-24)
* without parameters for enum attributes
* Error correction on v2.0.0 for ems-esp datanames and structure

## 2.0.0 (2023-07-23)
* DO NOT USE - DOES NOT WORK correctly !!
* support for ems-esp version 3.6
* message about ems-esp adapter version to use for old gateway v2 users
* rework statistics to avoid slowing down admin adapter
* some minor improvements

## 1.34.0 (2023-07-21)
* avoid warnings on statistics processing for new installations without historic data yet
* allow statistics for polling-time for both gateways without active database
* allow old "dallas" prefix instead of "temperaturesensors"

## 1.33.0 (2023-07-20)
* Rework adapter instance config: Split EMS-ESP and KM200 config pages
* parameters stay the same

## 1.32.0 (2023-07-19)
* ems-esp v3.6 adjustments for dallas/temperaturesensors (not tested yet)
* update dependencies 
* improve processing off errors on statistics
* Small adjustments on parameter screen

## 1.31.0 (2023-07-08)
* correction on JSON errors for ems-esp gateway entities (heatpump)

## 1.30.0 (2023-04-12)
* update efficience calculation to support external sensor for return temperature
* when 3 state fields are empty then standard fields are used.
* when state field(s) are filled, than this state(s) are used - e.g. own sensor for return temp
* coorect error processing when no ems-esp devices found

## 1.29.0 (2023-03-08)
* update dependencies

## 1.28.0 (2023-03-08)
* update dependencies

## 1.27.0 (2023-03-08)
* update dependencies

## 1.26.0 (2023-02-27)
* error corrections due to changes since v1.21

## 1.25.0 (2023-02-26)
* set acknowledge to true when re-reading changed values from ems-esp

## 1.24.0 (2023-02-26)
* error corrections for version 1.22 and 1.23

## 1.23.0 (2023-02-26)
* correct ww states from v1.22

## 1.22.0 (2023-02-17)
* support multiple mixer devices

## 1.21.0 (2023-01-02)
* am200 from ems-esp adjustments to changed structure

## 1.20.0 (2022-12-29)
* am200 from ems-esp - redefine to heatSources/hsa for km200 structure mode

## 1.19.0 (2022-12-29)
* am200 - alternative heatsource adjustments

## 1.18.0 (2022-12-24)
* Statistics
* alternative heat souces (am200)

## 1.17.1 (2022-12-04)
* correct actualweight statistics within heatdemand function

## 1.17.0 (2022-12-02)
* add actual weight per thermostat in heatdemand object structure
* add heatdemand difference values

## 1.16.2 (2022-11-21)
* adjustments for ems-esp sensors v3.5

## 1.16.1 (2022-11-20)
* error correction sensors

## 1.16.0 (2022-11-20)
* ems-esp V2 NOT SUPPORTED ANYMORE !!!!
* pepare for enum as values and not just index
* new parameters for "Room" and "Function" for adapter states
* adjust for latest ems-esp dev version 3.5 
* units of measument for ems-esp sensors
* support name changes within ems-esp for sensors

## 1.15.0 (2022-06-06)
* adjustments for ems-esp RC310 holiday modes

## 1.14.0 (2022-05-18)
* split parameters for dallas & analog sensors
* improve warning messages if sensors are missing

## 1.13.0 (2022-05-17)
* add visibility attributes within ems-esp states
* error processing dallas / analog sensors of ems-esp

## 1.12.1 (2022-05-16)
* corrections for heatdemand function
* enable expert view
* vis views for syslog analysis in expert views

## 1.12.0 (2022-05-15)
* add analog sensors for ems-esp gateway, remove ems-esp settings

## 1.11.2 (2022-04-27)
* code optimization and error processing for ems-esp gateway

## 1.11.1 (2022-04-25)
* error corrections on invalid heatdemand states

## 1.11.0 (2022-04-24)
* corrections on hourly recordings for temperature
* make interpolation (missing of c-counts) in energy recordings configurable (on/off)
* error corrections on heatdemand with empty data

## 1.10.0 (2022-04-23)
* add heatdemand customization & calculation with automatic switch (on/off) per heating circuit 
* error corrections on efficiency calculation - make fields used configurable
* some other error corrections

## 1.9.0 (2022-04-18)
* beta test new version (github only)
* add heatdemand customization & calculation with automatic switch (on/off) per heating circuit

## 1.4.0 (2022-03-16)
* recordings new logic and now working without database instance as well

## 1.3.3 (2022-02-26)
* avoid null values in recordings

## 1.3.2 (2022-02-25)
* correction for recordings without reference object
* corrections for mySQL recordings

## 1.3.1 (2022-02-24)
* correction on temperature recordings (months and days)

## 1.3.0 (2022-02-23)
* new logic and state-structure for km200 recordings
* recordings stored in states [array of values] and within database
* please adjust adapter configuration
* support of Buderus heatpump with Logamatic HMC300 IP-Inside

## 1.2.1 (2022-02-18)
* adjust for js-controller v4 - part 2
* private password encryption by admin instead of own code (if necessary please re-enter pw)

## 1.2.0 (2022-02-18)
* Adjust for js-controller v4 - part 1
* private password encryption by admin instead of own code (if necessary please re-enter pw)

## 1.1.1 (2022-02-11)
* Improve tests on km200 ip-address and passwords

## 1.1.0 (2022-02-07)
* last tested version for old ems-esp ESP8266 with API V2.
* support for KM200 HRV (ventilation)
* corrections for km200 recordings and statistics module
* prepare for ems-esp firmware 3.4