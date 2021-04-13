//"use strict";
"esversion":6";

/*
 * Created with @iobroker/create-adapter v1.33.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const adapter = utils.adapter("ems-esp");

// Load your modules here, e.g.:
const fs = require("fs");
const request = require("request");
const schedule = require("node-schedule");

let datafields = [];


class EmsEsp extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "ems-esp",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here - Read csv-file:
		const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
		const fn = dataDir+this.config.control_file;
		let data ="";
		if (this.config.control_file !== "") {
			try {
				data = fs.readFileSync(fn, "utf8");
			} catch (err) {
				this.log.info(err);
			}
		}
		datafields = read_file(data);

		for (let i=2; i < datafields.length; i++) {
			const r = datafields[i];

			if (r.mqtt_field_read !== "" && r.ems_device !=="") {
				const statename = r.ems_device+"."+r.mqtt_field_read;

				const obj={_id:statename,type:"state",common:{},native:{}};
				obj.common.name= "ems:"+r.mqtt_topic_read+"."+r.mqtt_field_read ;
				obj.common.role = "value";
				obj.common.read = true;
				obj.common.write = false;if (r.ems_field_write !== "") {obj.common.write = true;}
				obj.common.unit = r.units;
				obj.common.type = r.type;
				if(r.min !="") obj.common.min = r.min;
				if(r.max !="") obj.common.max = r.max;
				if(r.states !="") obj.common.states = r.states;
				obj.native.ems_command = r.ems_field_write;
				obj.native.ems_device = r.ems_device_command;
				obj.native.ems_id = r.ems_id;

				//this.log.info(JSON.stringify(obj));
				await this.setObjectNotExistsAsync(statename, obj);
				//await this.setStateAsync(statename, 0);

			} else {
				if (r.km200 !== "") {
					
					var statename = adapter.config.km200_instance+"."+r.km200;
					this.getObject(statename,obj1);
					obj1._id = r.km200;
					obj1.common.name= 'km200:'+r.km200;
					obj1.native.ems_km200 = r.km200;

					await this.setObjectNotExistsAsync(obj1._id, obj1);
					//setObject(obj1._id, obj1, function (err) {if (err) console.log('error:'+err);});
					
				}
			}
		}


		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables

		await this.setObjectNotExistsAsync("testVariable", {
			type: "state",
			common: {
				name: "testVariable",
				type: "boolean",
				role: "indicator",
				read: true,
				write: true,
			},
			native: {},
		});
		*/

		// MQTT Lesen

		const subscribe_mqtt = this.config.mqtt_instance+"."+this.config.mqtt_topic+".*";
		this.subscribeForeignStates(subscribe_mqtt);
		this.subscribeStates("*");

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		//this.subscribeStates("testVariable");


		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates("lights.*");
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		// this.subscribeStates("*");

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)
		//await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		//await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		//await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		//let result = await this.checkPasswordAsync("admin", "iobroker");
		//this.log.info("check user admin pw iobroker: " + result);

		//result = await this.checkGroupAsync("admin", "admin");
		//this.log.info("check group user admin group admin: " + result);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			if (state.from !== "system.adapter."+adapter.namespace) {
				// The state was changed but not from own adapter
				//this.log.info(state.from);
				const array = id.split(".");
				const mqtt_selector = this.config.mqtt_instance+"."+this.config.mqtt_topic;
				const state_selector = array[0]+"."+array[1]+"."+array[2];
				const adapt = array[0];
				if (mqtt_selector == state_selector) {

					//this.log.info(id+':'+JSON.stringify(state));
					const device= array[3];
					//adapter.log.info(typeof state.val);
					if (typeof state.val === "string") {
						const content = JSON.parse(state.val);
						for (const [key, value] of Object.entries(content)) {
							if (typeof value !== "object") {
								//this.log.info(device+' '+key+ ' ' + value);
								ems2iobroker(device,key,value);
							}
							else {
								const key1 = key;
								const wert = JSON.parse(JSON.stringify(value));
								for (const [key2, value2] of Object.entries(wert)) {
									//this.log.info(device+' '+key1+'.'+key2+ ' ' + value2);
									ems2iobroker(device,key1+"."+key2,value2);
								}
							}
						}
					} else write_state(device,state.val);
				}else {
					//this.log.info('ems-esp Änderung:'+ id + '->'+JSON.stringify(state));
					const data = state.val;
					adapter.getObject(id,function (err, obj) {
						if (obj.native.ems_device != null){
							const topic = adapter.config.mqtt_topic+"/" + obj.native.ems_device;
							const command ={};
							command.cmd  = obj.native.ems_command;
							command.data = data;
							if (obj.native.ems_id != "") {
								command.id = obj.native.ems_id.substr(2,1);
							}
							const scommand = JSON.stringify(command);
							adapter.sendTo(adapter.config.mqtt_instance, "sendMessage2Client", {topic : topic , message: scommand});
						}
						else {
							//var statename= adapter_km200+obj.native.ems_km200;
							//setState(statename,data);
						}
					});
				}
			}
		} else this.log.info(`state ${id} deleted`);
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new EmsEsp(options);
} else {
	// otherwise start the instance directly
	new EmsEsp();
}


function read_file(data) {
	const results =[];

	// Eingelesenen Text in ein Array splitten (\r\n, \n und\r sind die Trennzeichen für verschiedene Betriebssysteme wie Windows, Linux, OS X)
	const textArray = data.split(/(\n|\r)/gm);

	// Über alle CSV-Zeilen iterieren
	for (let i = 0; i < textArray.length; i++) {
		// Nur wenn die Größe einer Zeile > 1 ist (sonst ist in der Zeile nur das Zeilenumbruch Zeichen drin)
		if (textArray[i].length > 1) {
			const element ={};
			var km200,ems_device,ems_field_write,ems_id,mqtt_topic_read,mqtt_field_read,type,units,min,max,states,ems_device_command;
			const separator = ";";
			// Zeile am Trennzeichen trennen
			const elementArray = textArray[i].split(separator);
			// überflüssiges Element am Ende entfernen - nur notwendig wenn die Zeile mit dem Separator endet
			elementArray.splice(elementArray.length - 1, 1);
			element.km200=elementArray[0].trim();
			element.ems_device=elementArray[1].trim();
			element.ems_field_write=elementArray[2].trim();
			element.ems_id=elementArray[3].trim();
			element.mqtt_topic_read=elementArray[4].trim();
			element.mqtt_field_read=elementArray[5].trim();
			element.type=elementArray[6].trim();
			element.units=elementArray[7].trim();
			element.min=elementArray[8];
			element.max=elementArray[9];
			const re = /,/gi;element.states=elementArray[10].replace(re,";");
			element.ems_device_command=elementArray[11].trim();
			element.val = "0";

			// Array der Zeile dem Ergebnis hinzufügen
			results.push(element);
		} // Ende if
	} // Ende for
	return results;
}


function ems2iobroker(device,key,value) {
	let devicenew = "";
	for (let i=1; i < datafields.length; i++) {
		if(device == datafields[i].mqtt_topic_read && key == datafields[i].mqtt_field_read) {
			devicenew = datafields[i].ems_device;
			write_state(devicenew+"."+key,value);
		}
	}
	if (devicenew=="") {
		write_state(device+"."+key,value);
	}
}


async function write_state(field_ems,value) {
	const statename = field_ems;

	const array = statename.split(".");
	let device = "", command ="",device_id="";

	if (array[0] == "thermostat_data") device = "thermostat";
	if (array[0] == "boiler_data") device = "boiler";
	if (array[0] == "boiler_data_ww") device = "boiler";
	if (device != "") command = array[1];

	if (array[1] == "hc1" || array[1] == "hc2" || array[1] == "hc3" ) {
		device_id = array[1];
		command = array[2];
	}
	command = command.toLowerCase();
	//adapter.log.info(array[0] +':'+value);


	// @ts-ignore
	await adapter.setObjectNotExistsAsync(statename, {
		type: "state",
		common: {
			name: statename,
			type: "mixed",
			read: true
		},
		native: {
			ems_command: command,
			ems_device: device,
			ems_device_id: device_id
		}
	});


	(function(value) {
		adapter.getState(statename, function(err, state) {
			if(state == null) {
				adapter.setState(statename, {ack: true, val: value});
			}
			else {
				if (state.val != value) adapter.setStateAsync(statename, {ack: true, val: value});
			}
		});
	})(value);
}

