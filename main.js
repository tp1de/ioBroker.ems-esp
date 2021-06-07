//eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
//"use strict";
//"esversion":"6";

/*
 * ems-esp adapter version v0.9.0
 *
 * Created with @iobroker/create-adapter v1.33.0
 */

const utils = require("@iobroker/adapter-core");
const adapter = utils.adapter("ems-esp");
const fs = require("fs");
const request = require("request");
let datafields = [];


// ---------km200 en- and decryption parameters -----------------------------------------------------------------------------------------------------------------------
const Rijndael = require("rijndael-js");
const crypto = require("crypto");
const km200_crypt_md5_salt = new Uint8Array([
	0x86, 0x78, 0x45, 0xe9, 0x7c, 0x4e, 0x29, 0xdc,
	0xe5, 0x22, 0xb9, 0xa7, 0xd3, 0xa3, 0xe0, 0x7b,
	0x15, 0x2b, 0xff, 0xad, 0xdd, 0xbe, 0xd7, 0xf5,
	0xff, 0xd8, 0x42, 0xe9, 0x89, 0x5a, 0xd1, 0xe4
]);
let km200_server,km200_gatewaypassword,km200_privatepassword,km200_key,km200_aeskey,cipher;
let emsesp,recordings=false, ems_token ="";

// -------- energy recordings parameters ------------------------------------
const root = "recordings.";
const avg12m = "actualPower.avg12m";
const avg12mdhw = "actualDHWPower.avg12m";
const hh = "actualPower._Hours", hhdhw= "actualDHWPower._Hours";
const dd = "actualPower._Days", dddhw= "actualDHWPower._Days";
const mm = "actualPower._Months", mmdhw= "actualDHWPower._Months";
const felddhw = "recordings/heatSources/actualDHWPower?interval=";
const feld = "recordings/heatSources/actualPower?interval=";
let db = "sql.0";
let km200_structure = true;

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

		km200_server = this.config.km200_ip;
		km200_gatewaypassword = this.config.gateway_pw;
		km200_privatepassword = this.config.private_pw;
		recordings = this.config.recordings;
		db = this.config.database_instance;
		km200_structure= this.config.km200_structure;

		emsesp = this.config.emsesp_ip ;
		ems_token = this.config.ems_token;

		function decrypt(key, value) {
			let result = "";
			for (let i = 0; i < value.length; ++i) {
			 result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
			}
			return result;
		}

		adapter.getForeignObject("system.config", function (err, obj) {
			//adapter.log.info(JSON.stringify(obj));
			if (obj && obj.native && obj.native.secret) {
				km200_privatepassword = decrypt(obj.native.secret, km200_privatepassword);
			} else {
				km200_privatepassword = decrypt("Zgfr56gFe87jJOM", km200_privatepassword);
			}
		});
		await sleep(1000);

		// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
		km200_key = km200_getAccesskey(km200_gatewaypassword,km200_privatepassword);
		km200_aeskey = Buffer.from(km200_key,"hex");
		cipher = new Rijndael(km200_aeskey, "ecb");

		// Read csv-file:
		const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
		await fs.promises.mkdir(dataDir+"/ems-esp", { recursive: true });

		const fn = dataDir+"/ems-esp/"+this.config.control_file;
		let data = "";

		if (this.config.control_file !== "" &&  this.config.control_file !== "*") {
			try {data = fs.readFileSync(fn, "utf8");}
			catch (err) {this.log.info(err);}
		}

		//const results = [];
		if (this.config.control_file !== "*") {datafields = read_file(data);}
		else if (this.config.km200_active === true) {
			datafields = await read_km200structure();
			const fnw = dataDir+"/ems-esp/km200.csv";
			write_file(fnw,datafields);
		}

		await init_statistics();
		await init_controls();
		if (this.config.emsesp_active) await init_states_emsesp();
		if (this.config.km200_active) await init_states_km200();


		// Recording states

		if (recordings === true && this.config.km200_active === true) {
			await this.setObjectNotExistsAsync(root+"created",{type: "state",common: {type: "boolean", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+hh,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+hhdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+dd,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+dddhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+mm,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+mmdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+avg12m,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
			await this.setObjectNotExistsAsync(root+avg12mdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});

			adapter.getState(root+"created", function(err, state) {
				if(state == null || state.val === false) {
					enable_state(root+hh);
					enable_state(root+hhdhw);
					enable_state(root+dd);
					enable_state(root+dddhw);
					enable_state(root+mm);
					enable_state(root+mmdhw);
					adapter.setState(root+"created", {ack: true, val: true});
				}
			});


		}

		this.subscribeStates("*");

		// ems and km200 read schedule
		if (recordings && this.config.km200_active) km200_recordings();
		read_statistics();
		read_efficiency();

		let interval1,interval2,interval3,interval4,interval5;;
		adapter.log.info("start polling intervals now.");
		adapter.log.info("ems  :"+this.config.emsesp_active+" 15 secs");
		adapter.log.info("km200:"+this.config.km200_active+" 90 secs");
		adapter.log.info("recordings:"+this.config.recordings+" hour");

		if (this.config.km200_active) interval1 = setInterval(function() {km200_read(datafields);}, 90000); // 90 sec
		if (this.config.emsesp_active) interval2 = setInterval(function() {ems_read();}, 15000); // 15 sec
		if (recordings && this.config.km200_active ) interval3 = setInterval(function() {km200_recordings();}, 3600000); // 1 hour = 3600 secs
		if (this.config.km200_active || this.config.emsesp_active) interval4 = setInterval(function() {read_statistics();}, 300000); // 5 minutes
		setInterval(function() {read_efficiency();}, 60000); // 60 sec
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// ...
			clearInterval(interval1);clearInterval(interval2);clearInterval(interval3);clearInterval(interval4);clearInterval(interval5);
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
				state_change(id,state);
			}
		} else adapter.log.info("state "+id+" deleted");
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

//---------functions ---------------------------------------------------------------------------------------------------------

function enable_state(stateid) {
	const id =  adapter.namespace  + "." + stateid;
	adapter.sendTo(db, "enableHistory", {id: id, options:
		{changesOnly: false,debounce: 0,retention: 0,
			maxLength: 3, changesMinDelta: 0, aliasId: "" } }, function (result) {
		if (result.error) { console.log(result.error); }
		if (result.success) {
			//adapter.setState(stateid, {ack: true, val: 0});
		}
	});
}


async function state_change(id,state) {

	let value = state.val;
	const obj = await adapter.getObjectAsync(id);

	if (obj.native.ems_device != null){
		let url = emsesp + "/api/" + obj.native.ems_device;
		if (obj.native.ems_id =="") {url+= "/"+ obj.native.ems_command;}
		else {url+= "/"+ obj.native.ems_id + "/" +obj.native.ems_command;}

		adapter.log.debug("ems-esp write: "+ id + ": "+value);

		const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
		const body =JSON.stringify({"value": value});

		request.post({url, headers: headers, body}, function(error,response) {
			const status= JSON.parse(response.body).statusCode;
			const resp= JSON.parse(response.body).message;
			if (resp != "OK") adapter.log.error("ems-esp http write error:" + url);
		});

	} else {
		if (obj.native.ems_km200 != null) {
			try {
				//adapter.log.debug("km200 write: "+ obj.native.ems_km200 + ": "+value);
				if(obj.native.km200.allowedValues != undefined) {
					value= obj.native.km200.allowedValues[value];
				}
				adapter.log.debug("km200 write: "+ obj.native.ems_km200 + ": "+value);

				const resp = await km200_put(obj.native.ems_km200 , value);
				if (resp.statusCode == 403) {adapter.log.warn("km200 http write error " + resp.statusCode + ":" + obj.native.ems_km200);}
			}
			catch(error) {adapter.log.warn("km200 http write error "+ error + ":" + obj.native.ems_km200);}
		}
	}

}

async function init_controls() {

	await adapter.setObjectNotExistsAsync("controls.optimize_takt",{type: "state",
		common: {type: "boolean", name: "optimization of takting time", unit: "", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.use_heatingdemand",{type: "state",
		common: {type: "boolean", name: "use calculated heating demand for boiler control", unit: "", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.minimum_boilerpower",{type: "state",
		common: {type: "number", name: "minimum boiler power (min modulation x boiler power)", unit: "kW", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.heatingdemand",{type: "state",
		common: {type: "number", name: "heating demand from external source", unit: "kW", read: true, write: true}, native: {}});

}


async function init_statistics() {

	await adapter.setObjectNotExistsAsync("statistics.ems-read",{type: "state",
		common: {type: "number", name: "ems read time for polling", unit: "seconds", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.km200-read",{type: "state",
		common: {type: "number", name: "km200 read time for polling", unit: "seconds", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-on-1h",{type: "state",
		common: {type: "number", name: "percentage boiler on per hour", unit: "%", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-starts-1h",{type: "state",
		common: {type: "number", name: "boiler starts per hour", unit: "", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-starts-24h",{type: "state",
		common: {type: "number", name: "boiler starts per 24 hours", unit: "", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.efficiency",{type: "state",
		common: {type: "number", name: "boiler efficiency", unit: "%", read: true, write: true}, native: {}});
}

async function read_efficiency() {
	let value = 0;
	let power = 0,temp = 0,tempr = 0, tempavg = 0;

	if (adapter.config.emsesp_active){
		try {
			adapter.getState("heatSources.hs1.curburnpow", function (err, state) { if (state.val != null) power = state.val;} ); 
			adapter.getState("heatSources.hs1.curflowtemp", function (err, state) {if (state.val != null) temp = state.val;} ); 
			adapter.getState("heatSources.hs1.rettemp", function (err, state) {if (state.val != null) tempr = state.val;} ); 
		}
		catch (err) {adapter.log.error("error read efficiency:"+err);}
	}

	await sleep(1000);
	//adapter.log.info(power+ " "+ temp + " " +tempr);
	if (power > 0) {
		tempavg = (temp+tempr) / 2;
		if (tempavg <= 20) value = adapter.config.eff20;
		if (tempavg > 20) value = adapter.config.eff25;
		if (tempavg > 25) value = adapter.config.eff30;
		if (tempavg > 30) value = adapter.config.eff35;
		if (tempavg > 35) value = adapter.config.eff40;
		if (tempavg > 40) value = adapter.config.eff45;
		if (tempavg > 45) value = adapter.config.eff50;
		if (tempavg > 50) value = adapter.config.eff55;
		if (tempavg > 55) value = adapter.config.eff60;
		if (tempavg > 60) value = adapter.config.eff70;
	}

	adapter.setStateAsync("statistics.efficiency", {ack: true, val: value});
}

function read_statistics() {

	const end = Date.now();
	adapter.sendTo("sql.0", "getHistory", {	id: "ems-esp.0.heatSources.hs1.burnstarts",	options: {start: end - 3600000, end: end, aggregate: 'none'}
	}, function (result) {
		const count = result.result.length;
		if (count > 0) {
			const value = result.result[count-1].val-result.result[0].val + 1;
			adapter.setStateAsync("statistics.boiler-starts-1h", {ack: true, val: value});
		}
	});


	adapter.sendTo("sql.0", "getHistory", {	id: "ems-esp.0.heatSources.hs1.burnstarts",	options: {start: end - 86400000, end: end, aggregate: 'none'}
	}, function (result) {
		const count = result.result.length;
		let value = 0;
		if (count > 0) {
			const value = result.result[count-1].val-result.result[0].val + 1;
			adapter.setStateAsync("statistics.boiler-starts-24h", {ack: true, val: value});
		}
	});


	adapter.sendTo("sql.0", "getHistory", {	id: "ems-esp.0.heatSources.hs1.burngas",	options: {start: end - 3600000, end: end, aggregate: 'none'}
	}, function (result) {
		const count = result.result.length;
		let on = 0;
		for (let i = 0; i < result.result.length; i++) {
			if (result.result[i].val == 1) on += 1;
		}
		let value = 0;
		if (count !== 0 && count != undefined) value = on / count * 100;
		value = Math.round(value*10)/10;
		adapter.setStateAsync("statistics.boiler-on-1h", {ack: true, val: value});
	});

}


async function init_states_km200() {
	adapter.log.info("start initializing km200 states");
	for (let i=1; i < datafields.length; i++) {
		const r = datafields[i];
		//adapter.log.info(JSON.stringify(r));
		if (r.ems_field !== "" && r.ems_device !=="") {	}
		else {
			if (r.km200 !== "") {let o;
				try {o = await km200_get(r.km200);}
				catch(error) {adapter.log.warn("http km200 datafield not existing:"+r.km200);}
				if (o != undefined) {
					const obj1 = km200_obj(r.km200,o);
					const value = o.value;
					try {obj1._id = r.km200;
						obj1.common.name= "km200:"+r.km200;
						//obj1.native.source = "km200";
						obj1.native.ems_km200 = r.km200;
						await adapter.setObjectNotExistsAsync(obj1._id, obj1);
					} catch (err) {adapter.log.info(statename+":"+err);}
				}
			}
		}
	}
	adapter.log.info("end of initializing km200 states");
}



async function init_states_emsesp() {
	adapter.log.info("start initializing ems states");
	const url = emsesp +  "/api/system";
	let data ="";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.warn("ems read system error - wrong ip address?");
		data = "Invalid";
	}

	if (data != "Invalid") {
		const devices = JSON.parse(data).Devices;
		const status = JSON.parse(data).Status;
		const system = JSON.parse(data).System;

		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (let i=0; i < devices.length; i++) {
			if (devices[i].handlers != "") {
				const device = devices[i].type.toLowerCase();
				const url1 = emsesp +  "/api/"+device;
				data="";
				try {data = await ems_get(url1); }
				catch(error) {adapter.log.error("ems http read error init:" + error + " - " + url1);}
				let fields = {};
				if (data != "") fields = JSON.parse(data);

				for (const [key, value] of Object.entries(fields)) {
					if (typeof value !== "object") {
						const url2 = emsesp +  "/api/"+device+"/"+key;
						let def;
						try {
							def = await ems_get(url2);
							write_state(device+"."+key,value,def);
						}
						catch(error) {adapter.log.error("ems http read error init:"+ error + " - " + url2);}
					}
					else {
						const key1 = key;
						const wert = JSON.parse(JSON.stringify(value));
						for (const [key2, value2] of Object.entries(wert)) {
							const url2 = emsesp +  "/api/"+device+"/"+key1+"/"+key2;
							let def;
							try {
								def = await ems_get(url2);
								write_state(device+"."+key1+"."+key2,value2,def);
							}
							catch(error) {adapter.log.error("ems http read error init:"+ error + " - " + url2);}
							await sleep(100);
						}
					}
					await sleep(100);
				}
			}
		}
	}
	adapter.log.info("end of initializing ems states");
}


async function ems_read() {
	const t1 = new Date().getTime();
	const url = emsesp +  "/api/system";
	let data = "";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.debug("ems read system error:" +url+ " - wrong ip address?");
		data = "Invalid";
	}
	await sleep(100);

	if (data != "Invalid") {
		const devices = JSON.parse(data).Devices;
		const status = JSON.parse(data).Status;
		const system = JSON.parse(data).System;

		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (let i=0; i < devices.length; i++) {
			if (devices[i].handlers != "") {
				const device = devices[i].type.toLowerCase();
				const url1 = emsesp +  "/api/"+device;
				try {
					data = await ems_get(url1);
					const fields = JSON.parse(data);

					for (const [key, value] of Object.entries(fields)) {
						if (typeof value !== "object") {
							write_state(device+"."+key,value,"");
						}
						else {
							const key1 = key;
							const wert = JSON.parse(JSON.stringify(value));
							for (const [key2, value2] of Object.entries(wert)) {
								write_state(device+"."+key1+"."+key2,value2,"");
							}
						}
					}
				}
				catch(error) {adapter.log.debug("ems http read polling error:"+url1);}
			}
			await sleep(100);
		}
		const t2 = new Date().getTime();
		const t3 = (t2-t1) / 1000;
		adapter.setStateAsync("statistics.ems-read", {ack: true, val: t3});
	}
}



async function km200_read(result){
	const t1 = new Date().getTime();
	for (let i=1; i < result.length; i++) {
		if (result[i].ems_field == "" && result[i].km200 != "") {
			let body;
			try {
				body = await km200_get(result[i].km200);}
			catch(error) {adapter.log.debug("km200 get error state:"+result[i].km200);}
			if (body != undefined) {
				try {
					let val = body.value;
					if (body.type == "stringValue" && body.allowedValues != undefined){
						val = body.allowedValues.indexOf(body.value);
					}
					if (body.type == "switchProgram" && body.switchPoints != undefined){
						val = JSON.stringify(body.switchPoints);
					}
					adapter.setStateChangedAsync(result[i].km200, {ack: true, val: val});
				}
				catch(error) {
					adapter.log.warn("setState error:"+result[i].km200);
				}
			}
		}
	}
	const t2 = new Date().getTime();
	const t3 = (t2-t1) / 1000;
	adapter.setStateAsync("statistics.km200-read", {ack: true, val: t3});
}


async function ems_get(url) {return new Promise(function(resolve,reject) {
	const options = {url: url, method: "GET", status: [200], timeout: 5000, port: 80 };
	request(options, function(error,response,body) {
		if (error) {return reject(error);}
		if (response.statusCode !== 200) {return reject(error);}
		else {resolve(body);}
	});
});}



async function ems_put(url,value)  {
	const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
	const body =JSON.stringify({"value": value});

	request.post({url, headers: headers, body}, function(error,response) {
		const resp= JSON.parse(response.body).message;
		 return (response);
	});
}



//--------------------------------------------------------------------------------------------------------------------------

function read_file(data) {
	const results =[];
	let km200_count = 0;
	// Eingelesenen Text in ein Array splitten (\r\n, \n und\r sind die Trennzeichen für verschiedene Betriebssysteme wie Windows, Linux, OS X)
	const textArray = data.split(/(\n|\r)/gm);

	for (let i = 1; i < textArray.length; i++) {
		if (textArray[i].length > 1) {
			const element ={};
			let km200,ems_device,ems_device_new,ems_id,ems_field;
			const separator = ";";
			const elementArray = textArray[i].split(separator);
			elementArray.splice(elementArray.length - 1, 1);
			element.km200=elementArray[0].trim();
			element.ems_device_new=elementArray[1].trim();
			element.ems_device=elementArray[2];
			element.ems_id=elementArray[3];
			element.ems_field=elementArray[4];

			if (element.ems_field == undefined) element.ems_field = "";
			if (element.ems_device == undefined) element.ems_device = "";
			element.ems_field = element.ems_field.trim();
			element.ems_device = element.ems_device.trim();

			if (element.km200 != "" & element.ems_field == "") km200_count += 1;

			results.push(element);
		} // End if
	} // End for
	adapter.log.info("End reading csv-file: " + km200_count + " km200-fields found");
	return results;
}

function write_file(fnw,datafields) {
	adapter.log.info("write km200 file:" + fnw);

	let data = "km200 (equivalent) field;ems_device_new;ems_device;ems_id;ems_field;\n";
	for (let i = 0; i < datafields.length; i++) {
		data += datafields[i].km200 +";;;;;"+ "\n";
	}

	try { fs.writeFileSync(fnw, data, "utf8");
	}
	catch (err) {adapter.log.info(err);}

}





async function read_km200structure() {
	adapter.log.info("Start reading km200 data-structure");
	const results = [];
	results.push({"km200":"","ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});

	await tree("heatSources");
	await tree("dhwCircuits");
	await tree("heatingCircuits");
	await tree("system");
	await tree("notifications");
	await tree("gateway");
	await tree("solarCircuits");

	adapter.log.info("End reading km200 data-structure: " + results.length + " fields found");
	return results;


	async function tree(reference) {
		try {
			const data = await km200_get(reference);
			if (data.type != "refEnum") {
				const element=data.id.substring(1).split("/").join(".");
				results.push({"km200":element,"ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});
			} else await refEnum(data);
		} catch(error) {adapter.log.warn("http error reading km200 tree:"+error);}
	}

	async function refEnum(data){
		let data1,field1,element;
		for (let i=0;i < data.references.length;i++){
			field1 =data.references[i].id.substring(1).split("/").join(".");
			try {data1 = await km200_get(field1);}
			catch(error) {data1 = "";}
			if (data1 != "") {
				if (data1.type != "refEnum") {
					element=data1.id.substring(1).split("/").join(".");
					results.push({"km200":element,"ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});
				}
				else {await refEnum(data1);}
			}
		}
	}

}




async function write_state(statename,value,def) {
	const array = statename.split(".");
	let device = "", device_ems="",command ="",device_id="";
	let statename1 = statename;
	device = array[0];
	device_ems=device;
	if (def == "Invalid") adapter.log.warn("Invalid:"+statename);

	if (km200_structure) {
		if (array[0] == "thermostat") device = "heatingCircuits";
		if (array[0] == "thermostat" && array[1].substring(0,2) == "ww") device = "dhwCircuits";
		if (array[0] == "mixer") device = "heatingCircuits";
		if (array[0] == "solar") device = "solarCircuits.sc1";
		if (array[0] == "boiler") {
			if (array[1].substring(0,2) == "ww") device = "dhwCircuits.dhw1";
			if (array[1].substring(0,2) != "ww") device = "heatSources.hs1";
		}
	}

	command = array[1];
	if (array[1] == "hc1" || array[1] == "hc2" || array[1] == "hc3" ) {
		device_id = array[1];
		command = array[2];
	}
	command = command.toLowerCase();

	if (device_id == "") {
		statename1 = device+"."+command;
	} else {
		statename1 = device+"."+device_id+"."+command;
	}

	const obj={_id:statename1,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "ems:"+statename;
	obj.common.type = "mixed";
	obj.common.unit = "";
	obj.common.read = true;
	obj.common.write = false;
	obj.common.role = "value";

	if (def != "" && def != "Invalid") {
		const defj = JSON.parse(def);

		if (defj.writeable == true) {obj.common.write = true;}
		obj.common.unit = defj.unit;

		if(defj.writeable == true) obj.common.min = defj.min;
		if(defj.writeable == true) obj.common.max = defj.max;

		if(defj.type == "text") defj.type = "string";
		obj.common.type = defj.type;
		if(defj.type == "enum") {
			obj.common.type = "number";
			obj.common.states = "";
			obj.native.ems_enum = defj.enum;
			for (let ii = 0; ii< defj.enum.length;ii++) {
				if (defj.min = 1) {obj.common.states += (ii+1)+":"+defj.enum[ii];}
				else {obj.common.states += ii+":"+defj.enum[ii];}
				//obj.common.states += ii+":"+defj.enum[ii];
				if (ii< defj.enum.length-1) obj.common.states += ";";
			}
		}

		if(defj.type == "boolean") {
			obj.common.type = "number";
			if (value == true) value = 1;
			if (value == false) value = 0;
			obj.common.states = "0:Off;1:On";
		}
	}

	//obj.native.source = "ems-esp";
	obj.native.ems_command = command;
	obj.native.ems_device = device_ems;
	obj.native.ems_id = device_id;

	// @ts-ignore
	await adapter.setObjectNotExistsAsync(statename1, obj);
	await adapter.getStateAsync(statename1, function(err, state) {
		if(state == null) {adapter.setStateAsync(statename1, {ack: true, val: value});}
		else {if (state.val != value) adapter.setStateAsync(statename1, {ack: true, val: value});} });
		

}

//------- km200 functions ------------------------------------------------------------------------------------------

async function km200_get(url) {return new Promise(function(resolve,reject) {
	const urls = km200_server +  "/" + url.split(".").join("/") ;
	const options =
        {   url: urls,
        	method: "GET",
        	status: [200],
        	timeout: 10000,
        	encoding: "utf8",
        	port: 80,
        	headers: {"Accept": "application/json", "agent": "TeleHeater/2.2.3", "User-Agent": "TeleHeater/2.2.3"}
        };

	request(options, function(error,response,body) {
		if (error) {return reject(error);}
		if (response == undefined) {resolve("");}
		if (response.statusCode == 403 || response.statusCode == 404 ) resolve("");
		if (response.statusCode !== 200) {
			return reject(error+response.statusCode);}
		else {
			try {var data= km200_decrypt(body);}
			catch(error) {data="";}
			resolve(data);}
	});
});
}

async function km200_put(url,value) {return new Promise(function(resolve,reject) {
	const data= km200_encrypt( Buffer.from(JSON.stringify({value: value })) );
	const urls = km200_server +"/" + url.split(".").join("/");
	request.put({headers: {"Accept": '"application/json',"User-Agent": "TeleHeater/2.2.3"},url: urls, body: data},
		function(error, response){
			if (error) {return reject(error);}
			resolve(response);});
});
}



function km200_decrypt(input) {
	// Decrypt
	let s = Buffer.from(cipher.decrypt(Buffer.from(input,"base64"),16)).toString("utf8");
	while (s.charCodeAt(s.length - 1) === 0) s = s.slice(0, s.length - 1);
	const output = JSON.parse(s);
	return output;
}

function km200_encrypt(input) {
	// Encrypt
	const output = Buffer.from(cipher.encrypt(input,16)).toString("base64");
	return output;
}

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------

async function km200_recordings(){
	const adapt = adapter.namespace+".";
	await hours();
	await days();
	await months();
}

async function recs(field,daten) {

	if (db.substring(0,3) == "sql" ) {
		await adapter.sendToAsync(db, "deleteAll", {id: field});
		await sleep(1000);
		adapter.sendTo(db,"storeState", daten);
	}


	if (db.substring(0,8) == "influxdb" ) {
		const query = 'drop series from "' +  field + '";';
		await adapter.sendToAsync(db, "query", query);
		await sleep(100);
		for (let i = 0; i < daten.length;i++){
			adapter.sendTo(db,"storeState", daten[i]);
		}
	}
}


async function hours() {
	const adapt = adapter.namespace+".";

	let datum= new Date();
	let daten = [], data;
	let field = adapt+root+hh;

	for (let i=0;i<3;i++) {
		const url1 = feld + datum.getFullYear()+"-"+ (datum.getMonth()+1) +"-"+datum.getDate();
		try {data = await km200_get(url1);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + ((ii+2) * 3600000 );
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		datum.setDate(datum.getDate() - 1);
	}

	await recs(field,daten);

	datum= new Date();
	daten = [], data="";
	field = adapt+root+hhdhw;

	for (let i=0;i<3;i++) {
		const url11 = felddhw + datum.getFullYear()+"-"+ (datum.getMonth()+1) +"-"+datum.getDate();
		try {data = await km200_get(url11);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + ((ii+2) * 3600000 );
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		datum.setDate(datum.getDate() - 1);
	}
	await recs(field,daten);
}

async function days() {
	const adapt = adapter.namespace+".";
	let datum= new Date();
	let daten = [], data;
	let field = adapt+root+dd;
	let jahr = datum.getFullYear();
	let monat = datum.getMonth() + 1;

	for (let i=0;i<3;i++) {
		const url1 = feld + jahr + "-" + monat;
		try {data = await km200_get(url1);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + 60000 + (ii * 3600000 * 24);
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		if (monat == 1) {jahr = jahr-1;monat=12;}
		else if (monat > 1) {monat = monat-1;}
	}
	await recs(field,daten);

	datum= new Date();
	daten = [], data="";
	field = adapt+root+dddhw;
	jahr = datum.getFullYear();
	monat = datum.getMonth() + 1;

	for (let i=0;i<3;i++) {
		const url11 = felddhw + jahr +"-"+ monat;
		try {data = await km200_get(url11);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + 60000 + (ii * 3600000 * 24);
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		if (monat == 1) {jahr = jahr-1;monat=12;}
		else if (monat > 1) {monat = monat-1;}
	}
	await recs(field,daten);
}



async function months() {
	const adapt = adapter.namespace+".";
	let datum= new Date();
	let daten = [], data;
	let field = adapt+root+mm;
	let jahr = datum.getFullYear();
	const ja = jahr;
	const ma = datum.getMonth() + 1;
	let sum = 0;

	for (let i=0;i<3;i++) {
		const url1 = feld + jahr ;
		try {data = await km200_get(url1);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const m = ii+1;
					const t = jahr + "-" + m.toString() +"-15" ;
					if(jahr == ja && m < ma ) sum+=wert;
					if(jahr == ja-1 && m >= ma ) sum+=wert;
					const ts = new Date(t).getTime();
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		jahr = jahr-1;
	}
	await recs(field,daten);
	sum = Math.round(sum) ;
	adapter.setStateAsync(root+avg12m, {ack: true, val: sum});

	datum= new Date();
	daten = [], data="";
	field = adapt+root+mmdhw;
	jahr = datum.getFullYear();
	sum = 0;

	for (let i=0;i<3;i++) {
		const url11 = felddhw + jahr;
		try {data = await km200_get(url11);}
		catch(error) {console.error("error"+data);data = " "; }
		if (data != " ") {
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const m = ii+1;
					const t = jahr + "-" + m.toString() +"-15" ;
					if(jahr == ja && m < ma ) sum+=wert;
					if(jahr == ja-1 && m >= ma ) sum+=wert;
					const ts = new Date(t).getTime();
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		jahr = jahr-1;
	}
	await recs(field,daten);
	sum = Math.round(sum/12) ;
	adapter.setStateAsync(root+avg12mdhw, {ack: true, val: sum});
}





function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}



// -------------------------------------------------------------------------------------------------------------------------------------------------------------------

function km200_getAccesskey(gatewaypassword, privatepassword) {
	function md5(text) {
		return crypto.createHash("md5").update(text).digest("hex");
	}

	function str2ab(str) {
		const buf = new ArrayBuffer(str.length * 1); // 2 bytes for each char
		const bufView = new Uint8Array(buf);
		for (let i = 0, strLen = str.length; i < strLen; i++) {bufView[i] = str.charCodeAt(i);}
		return bufView;
	}

	function concatUint8Array(array1, array2) {
		const array3 = new Uint8Array(array1.length + array2.length);
		for (let i = 0; i < array1.length; i++) {array3[i] = array1[i];}
		for (let i = 0; i < array2.length; i++) {array3[array1.length + i] = array2[i];}
		return array3;
	}

	gatewaypassword = gatewaypassword.replace(/-/g, "");
	const km200_gateway_password = str2ab(gatewaypassword);
	const km200_private_password = str2ab(privatepassword);
	const key_1 = md5(concatUint8Array(km200_gateway_password, km200_crypt_md5_salt));
	const key_2_private = md5(concatUint8Array(km200_crypt_md5_salt, km200_private_password));
	const km200_crypt_key_private = key_1 + key_2_private;
	return km200_crypt_key_private.trim().toLowerCase();
}


function km200_obj(n,o) {

	let t = o.type;
	let u = o.unitOfMeasure;
	let v = o.value;
	o.valIs = "value";

	let w = !!o.writeable;
	let r = w ? "level" : "value";
	let s = false;
	if (u === "C") {
		u = "°C";
		r += ".temperature";
	} else if (typeof u === "undefined")
		u = "";
	switch (t) {
		case "stringValue":
			if (Array.isArray(o.allowedValues)) {
				o.valIs = "states";
				t = "number";
				v = o.allowedValues.indexOf(o.value);
				s = [];
				for (let ii = 0; ii < o.allowedValues.length; ++ii)
					s.push(ii.toString() + ":" + o.allowedValues[ii]);
				s = s.join(";");
			} else
				t = "string";
			break;
		case "floatValue":
			t = "number";
			break;
		case "systeminfo":
		case "errorList":
		case "arrayData":
			v = o.values; //*****
			o.valIs = "values";
			t = "string";
			w = false;
			break;
		case "switchProgram":
			v = o.switchPoints; //*****
			o.valIs = "switchPoints";
			t = "string";
			//                w = false;
			break;
		case "yRecording":
			v = o.values;
			o.valIs = "values";
			t = "array";
			w = false;
			break;
		default: // put others in pure objects'
			v = o;  //*****
			o.valIs = "values";
			t = "string";
			w = false;
	}
	const c = {
		type: "state",
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
	if (typeof o.minValue !== "undefined")
		c.common.min = o.minValue;
	if (typeof o.maxValue !== "undefined")
		c.common.max = o.maxValue;

	if (o.state !== undefined){
		if  (o.state[1] !== undefined) {
			if  (o.state[1].na !== undefined) c.common.min = o.state[1].na;
		}
		   // c.common.min = o.state[1].na;
	}
	c.native.km200 = o;
	//c.common.native = { km200: o };
	return c;
}
