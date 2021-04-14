//"use strict";
//"esversion":6";

/*
 * ems-esp adapter version v 0.4
 *
 * Created with @iobroker/create-adapter v1.33.0
 */

const utils = require("@iobroker/adapter-core");
const adapter = utils.adapter("ems-esp");

// Load your modules here, e.g.:
const fs = require("fs");
const request = require("request");
const schedule = require("node-schedule");
let datafields = [];


// -------------------------------------------------------------------------------------------------------------------------------------------------------------------

const Rijndael = require('rijndael-js');
const crypto = require('crypto');

const km200_crypt_md5_salt = new Uint8Array([
    0x86, 0x78, 0x45, 0xe9, 0x7c, 0x4e, 0x29, 0xdc,
    0xe5, 0x22, 0xb9, 0xa7, 0xd3, 0xa3, 0xe0, 0x7b,
    0x15, 0x2b, 0xff, 0xad, 0xdd, 0xbe, 0xd7, 0xf5,
    0xff, 0xd8, 0x42, 0xe9, 0x89, 0x5a, 0xd1, 0xe4
]);

let km200_server,km200_gatewaypassword,km200_privatepassword,km200_key,km200_aeskey,cipher;

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------

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
		// Initialize your adapter here 
		
		km200_server = this.config.km200_ip;
		km200_gatewaypassword = this.config.gateway_pw;
		km200_privatepassword = this.config.private_pw;
		
		// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
		
		km200_key = km200_getAccesskey(km200_gatewaypassword,km200_privatepassword);
		km200_aeskey = Buffer.from(km200_key,"hex");
		cipher = new Rijndael(km200_aeskey, "ecb");		


		// Read csv-file:
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
				await this.setObjectNotExistsAsync(statename, obj);

			} else {
				if (r.km200 !== "") {
					let o;
				try {
						o = await km200_get(r.km200);					    
					}
					catch(error) {adapter.log.warn("http km200 datafield not existing:"+r.km200);}
					if (o != undefined) {			
						let obj1 = km200_obj(r.km200,o); 												
						try {
							obj1._id = r.km200;
							obj1.common.name= "km200:"+r.km200;
							obj1.native.ems_km200 = r.km200;
							await this.setObjectNotExistsAsync(obj1._id, obj1);
						} 
						catch (err) {this.log.info(statename+":"+err);}
						
					}
				}
			}
		}


		// MQTT Read 

		const subscribe_mqtt = this.config.mqtt_instance+"."+this.config.mqtt_topic+".*";
		this.subscribeForeignStates(subscribe_mqtt);
		this.subscribeStates("*");

		const j = schedule.scheduleJob("* * * * *", function() {km200_read(datafields);});

		async function km200_read(result){
			for (let i=2; i < result.length; i++) {
				if (result[i].mqtt_field_read == "" && result[i].km200 != "") {
					let body;
					try {
						body = await km200_get(result[i].km200);
					}
					catch(error) {}
					if (body != undefined) {
						try {
							var val = body.value;
							adapter.setState(result[i].km200, {ack: true, val: val});
						}
						catch(error) {adapter.log.info("setState error:"+result[i].km200);}
					}
				}
			}
		}
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

	/********************************************************************************************************************
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
							try {   
								adapter.log.info(obj.native.ems_km200);
								var response = km200_put(obj.native.ems_km200 , data);
								
							}   
							catch(error) {console.error("http fehler:"+feld);}    
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

async function km200_get(url) {return new Promise(function(resolve,reject) {
    var urls = km200_server +  "/" + url.split('.').join('/') ;
	var options = 
        {   url: urls, 
            method: 'GET', 
            status: [200],
            timeout: 5000, 
            encoding: 'utf8',
            port: 80,
            headers: {'Accept': "application/json", 'agent': 'TeleHeater/2.2.3', 'User-Agent': "TeleHeater/2.2.3"} 
        };

    request(options, function(error,response,body) {
        if (error) {return reject(error);}
        if (response.statusCode !== 200) {return reject(error);}
        else {                    
            var data= km200_decrypt(body);   
            resolve(data);}
        }); 
    });
}



async function km200_put(url,value) {return new Promise(function(resolve,reject) {
    var data= km200_encrypt( Buffer.from(JSON.stringify({value: value })) );   
    var urls = km200_server +"/" + url.split('.').join('/');
    request.put({headers: {'Accept': '"application/json','User-Agent': 'TeleHeater/2.2.3'},url: urls, body: data},
                function(error, response, body){if (error) {return reject(error);} resolve(response);});
    });
}


function km200_decrypt(input) {
    // Decrypt
    var s = Buffer.from(cipher.decrypt(Buffer.from(input,"base64"),16)).toString('utf8');
    while (s.charCodeAt(s.length - 1) === 0) s = s.slice(0, s.length - 1);
    var output = JSON.parse(s);
    return output;
}

function km200_encrypt(input) {
    // Encrypt
    var output = Buffer.from(cipher.encrypt(input,16)).toString("base64");
    return output;
}

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------

function km200_getAccesskey(gatewaypassword, privatepassword) {
            function md5(text) {
                return crypto.createHash('md5').update(text).digest("hex");
            }

            function str2ab(str) {
                let buf = new ArrayBuffer(str.length * 1); // 2 bytes for each char
                let bufView = new Uint8Array(buf);
                for (let i = 0, strLen = str.length; i < strLen; i++) {bufView[i] = str.charCodeAt(i);}
                return bufView;
            }

            function concatUint8Array(array1, array2) {
                const array3 = new Uint8Array(array1.length + array2.length);
                for (let i = 0; i < array1.length; i++) {array3[i] = array1[i];}
                for (let i = 0; i < array2.length; i++) {array3[array1.length + i] = array2[i];}
                return array3;
            }

            gatewaypassword = gatewaypassword.replace(/-/g, '');
            let km200_gateway_password = str2ab(gatewaypassword);
            let km200_private_password = str2ab(privatepassword);
            // Erste Hälfte des Schlüssels: MD5 von ( Gerätepasswort . Salt )
            let key_1 = md5(concatUint8Array(km200_gateway_password, km200_crypt_md5_salt));
            // Zweite Hälfte des Schlüssels - privat: MD5 von ( Salt . privates Passwort )
            let key_2_private = md5(concatUint8Array(km200_crypt_md5_salt, km200_private_password));
            let km200_crypt_key_private = key_1 + key_2_private;
            return km200_crypt_key_private.trim().toLowerCase();
}


function km200_obj(n,o) {
    
        let t = o.type;
        let u = o.unitOfMeasure;
        let v = o.value;
        o.valIs = "value";

        let w = !!o.writeable;
        let r = w ? 'level' : 'value';
        let s = false;
        if (u === 'C') {
            u = '°C';
            r += '.temperature';
        } else if (typeof u === 'undefined')
            u = "";
        switch (t) {
            case 'stringValue':
                if (Array.isArray(o.allowedValues)) {
                    o.valIs = 'states';
                    t = 'number';
                    v = o.allowedValues.indexOf(o.value);
                    s = [];
                    for (let ii = 0; ii < o.allowedValues.length; ++ii)
                        s.push(ii.toString() + ':' + o.allowedValues[ii]);
                    s = s.join(';');
                } else
                    t = 'string';
                break;
            case 'floatValue':
                t = 'number';
                break;
            case 'systeminfo':
            case 'errorList':
            case 'arrayData':
                v = o.values; //*****
                o.valIs = "values";
                t = 'string';
                w = false;
                break;
            case 'switchProgram':
                v = o.switchPoints; //*****
                o.valIs = "switchPoints";
                t = 'string';
                //                w = false;
                break;
            case 'yRecording':
                v = o.values;
                o.valIs = "values";
                t = 'array';
                w = false;
                break;
            default: // put others in pure objects'
                v = o;  //*****
                o.valIs = "values";
                t = 'string';
                w = false;             
		}   
        const c = {
            type: 'state',
            id: n,
            common: {
                id: n,
                name: n,
                type: t,
                unit: u,
                read: true,
                write: w,
                role: r,
            },
            native: {}
        };

        if (s) {
            c.common.states = s;
            c.common.min = 0;
            c.common.max = o.allowedValues.length - 1;
        }
        if (typeof o.minValue !== 'undefined')
            c.common.min = o.minValue;
        if (typeof o.maxValue !== 'undefined')
            c.common.max = o.maxValue;
        c.native.km200 = o;
        //c.common.native = { km200: o };
    return c;
}