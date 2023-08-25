/* eslint-disable no-unused-vars */
/* eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
const request = require("request");
const F = require("./functions.js");

let unloaded = false;

let emsesp,ems_token ="",ems_http_wait = 100, ems_polling = 60;
let ems_version = "V3";
let km200_structure = true;
let energy_init = true;

let adapter;


const init = async function(a,i) {
	adapter = a;
	emsesp = adapter.config.emsesp_ip ;

	if (emsesp.substr(0,3) == "***") emsesp = emsesp.substr(3);
	if (emsesp.substr(0,7) != "http://") emsesp = "http://" + emsesp;

	ems_token = adapter.config.ems_token.trim();
	ems_http_wait = adapter.config.ems_http_wait;
	ems_polling = adapter.config.ems_polling;
	if (ems_polling < 15) ems_polling = 15;
	km200_structure= adapter.config.km200_structure;

	// Testing API Version
	let url = emsesp +  "/api/system";
	let data;
	try {
		data = await ems_get(url);
		ems_version = "V3";
	}
	catch(error) {
		url = emsesp +  "/api?device=system&cmd=info";
		try {
			data = await ems_get(url);
			ems_version = "V2";
			adapter.log.error("API version V2 - V2 is not supported anymore");
			adapter.log.info("last adapter version supporting V2 was v1.15.0");
			adapter.log.info("install within within shell: cd /opt/iobroker; iobroker upgrade ems-esp@1.15.0");
			return;
		}
		catch(e) {adapter.log.error("EMS-ESP Gateway IP address wrong");return;}
	}

	try {ems_version = JSON.parse(data)["System Info"].version;} catch(e) {}


	adapter.log.info("EMS-ESP API version: " + ems_version);
	const version = ems_version;

	if (adapter.config.ems_energy == true && adapter.config.db == "") {
		adapter.log.warn("no database selected for energy statistics");
		adapter.config.ems_energy = false;
	}

	if (!unloaded) await init_states_emsesp(version);

	if (!unloaded && adapter.config.ems_energy) {
		await init_energy();
		energy_init = false;
		if (ems_polling != 15) {
			ems_polling = 15;
			adapter.log.info("ems  : set polling to 15 seconds due to energy statistics");
		}
		await ems_read(version);
		i.ems_energy = setInterval(function() {read_energy();}, 60 * 1000); // every 10 minutes
		adapter.log.info("ems  : energy polling every 10 minutes");
	}

	if (!unloaded) adapter.log.info("ems  : polling every " + ems_polling + " secs");
	if (!unloaded) i.ems = setInterval(function() {ems_read(version);}, ems_polling*1000);

};




async function init_states_emsesp(version) {
	adapter.log.info("start initializing EMS-ESP states ");
	const url = emsesp +  "/api/system";
	write_state("esp.api",ems_version,"");

	adapter.log.info("url:" +url);
	let data ="";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.warn("EMS-ESP read system error - wrong ip address?");
		data = "Invalid";
	}

	await sleep(ems_http_wait);
	if (data != "Invalid") {

		let devices = {}, devices_count = 0;
		try {devices = JSON.parse(data).Devices; devices_count = devices.length; }catch(e){adapter.log.error("error reading EMS-ESP devices");}
		read_status(data,"esp");

		for (let i=0; i < devices_count; i++) {
			if (device_check(devices[i])) {
				const device = devices[i].type.toLowerCase();
				const url1 = emsesp +  "/api/"+device;

				adapter.log.info("url1:" + url1);
				data="";
				try {data = await ems_get(url1); }
				catch(error) {
					if (error != null) adapter.log.error("EMS-ESP http read error init:" + device + " --> " + error + " - " + url1);
				}
				let fields = {};
				if (data != "") {
					try {fields = JSON.parse(data);}
					catch(e) {adapter.log.warn("EMS-ESP parse error device " + device + " " + url1 + ":"+ data);}
				}

				for (const [key, value] of Object.entries(fields)) {
					if (typeof value !== "object") {
						const url2 = emsesp +  "/api/"+device+"/"+key;
						let def;
						try {
							def = await ems_get(url2);
							write_state(device+"."+key,value,def);
						}
						catch(error) {write_state(device+"."+key,value,"");} // V2

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
							catch(error) {write_state(device+"."+key1+"."+key2,value2,"");}  // V2
						}
					}
					await sleep(ems_http_wait);
				}
			}
		}

	}
	adapter.log.info("end of initializing EMS-ESP states ");
}


async function read_status(data,entry) {
	try {
		const datap = JSON.parse(data);
		for (const [key, value] of Object.entries(datap)) {
			if (typeof value !== "object") {
				write_status(entry+"."+key,value);
			}
			else {
				const key1 = key;
				const wert = JSON.parse(JSON.stringify(value));
				for (const [key2, value2] of Object.entries(wert)) {
					if (typeof value2 !== "object") {
						write_status(entry+"."+key1+"."+key2,value2);
					}
					else {
						const wert2 = JSON.parse(JSON.stringify(value2));
						for (const [key3, value3] of Object.entries(wert2)) {
							if (key1 == "Devices" || key1 == "devices") {
								const key2a = wert2.type + " " + key2;
								write_status(entry+"."+key1+"."+key2a+"."+key3,value3);
								const pos = wert2.name.indexOf("DeviceID") + 9;
								const id = wert2.name.substr(pos,4);
								write_status(entry+"."+key1+"."+key2a+".busid",id);
							}
							else write_status(entry+"."+key1+"."+key2+"."+key3,value3);
						}
					}
				}
			}
		}
	} catch(e) {adapter.log.error("error EMS-ESP read status");}
}

async function write_status (statename, value) {
	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "ems:"+statename;
	obj.common.type = "mixed";
	obj.common.unit = "";
	obj.common.read = true;
	obj.common.write = false;
	await adapter.setObjectNotExistsAsync(statename, obj);
	try {
		const state = await adapter.getStateAsync(statename);
		if(state == null) {adapter.setState(statename, {ack: true, val: value});}
		else {if (state.val != value || state.ack == false) adapter.setState(statename, {ack: true, val: value});}
	} catch(e) {}
}


function device_check(dev) {
	for (const key in dev) {
		switch (key) {
			case "entities":
				if (dev[key] > 0) return true;
				break;
			// eslint-disable-next-line no-fallthrough
			case "type":
				if (dev[key] == "Gateway") return false;
				if (dev[key] == "Controller") return false;
				break;
			case "handlers": return true;
			case "handlers_received": return true;
			case "handlers_fetched": return true;
			case "handlers received": return true;
			case "handlers fetched": return true;
		}
	}
	// adapter.log.warn("unclear device attributes " + JSON.stringify(dev));
	return false;
}




async function ems_read(version) {
	const t1 = new Date().getTime();
	const url = emsesp +  "/api/system";

	//adapter.log.info(version + "  " + url);
	let data = "";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.debug("EMS-ESP read system error:" +url+ " - wrong ip address?");
		data = "Invalid";
	}

	await sleep(ems_http_wait);

	if (data != "Invalid") {
		let devices = {};
		try {devices = JSON.parse(data).Devices;}
		catch(error) {
			//adapter.log.error("*** error can't read system information")
		}

		read_status(data,"esp");

		try{
			for (let i=0; i < devices.length; i++) {
				if (device_check(devices[i])) {
					const device = devices[i].type.toLowerCase();
					let url1 = emsesp + "/api?device=" + device +"&cmd=info";
					url1 = emsesp +  "/api/"+device;

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
					catch(error) {adapter.log.debug("EMS-ESP http read polling error:"+url1);}
				}
				await sleep(ems_http_wait);
			}
		} catch (e) {}
		const t2 = new Date().getTime();
		const t3 = (t2-t1) / 1000;

		if (adapter.config.statistics) {
			adapter.setObjectNotExists("statistics.ems-read",{type: "state",
				common: {type: "number", name: "ems read time for polling", unit: "seconds", role: "value", read: true, write: true}, native: {}});
			adapter.setStateAsync("statistics.ems-read", {ack: true, val: t3});
		}
	}

	if (adapter.config.ems_dallas) {
		let url = emsesp +  "/api/dallassensor";
		data = "";
		try {data = await ems_get(url); }
		catch(error) {data = "Invalid";	}
		await sleep(ems_http_wait);

		if (data != "Invalid") {
			let sensors = {};
			try {sensors = JSON.parse(data);}
			catch(error) {}

			for (const [key, value] of Object.entries(sensors)) {
				const url1 = emsesp +  "/api/dallassensor/" + key;
				try {data = await ems_get(url1); }
				catch(error) {data = "Invalid";}
				await sleep(ems_http_wait);
				if (data != "Invalid") {
					let def;
					try {def = JSON.parse(data);}
					catch(error) {}
					write_sensor("dallas."+def.id,def.value,def);
				}
			}
		}

		// new version for v 3.6 ...
		url = emsesp +  "/api/temperaturesensor";
		data = "";
		try {data = await ems_get(url); }
		catch(error) {data = "Invalid";	}
		await sleep(ems_http_wait);

		if (data != "Invalid") {
			let sensors = {};
			try {sensors = JSON.parse(data);}
			catch(error) {}

			for (const [key, value] of Object.entries(sensors)) {
				const url1 = emsesp +  "/api/temperaturesensor/" + key;
				try {data = await ems_get(url1); }
				catch(error) {data = "Invalid";}
				await sleep(ems_http_wait);
				if (data != "Invalid") {
					let def;
					try {def = JSON.parse(data);}
					catch(error) {}
					if (adapter.config.ems_dallas_old_format) write_sensor("dallas."+def.id,def.value,def);
					else write_sensor("temperaturesensor."+def.id,def.value,def);
				}
			}
		}

	}

	if (adapter.config.ems_analog) {
		const url = emsesp +  "/api/analogsensor";
		data = "";
		try {data = await ems_get(url); }
		catch(error) {data = "Invalid";}
		await sleep(ems_http_wait);

		if (data != "Invalid") {
			let analogs = {};
			try {analogs = JSON.parse(data);}
			catch(error) {}

			for (const [key, value] of Object.entries(analogs)) {
				const url1 = emsesp +  "/api/analogsensor/" + key;
				try {data = await ems_get(url1); }
				catch(error) {data = "Invalid";}
				await sleep(ems_http_wait);
				if (data != "Invalid") {
					let def;
					try {def = JSON.parse(data);}
					catch(error) {}
					write_sensor("analog.gpio"+def.gpio,def.value,def);
				}
			}
		}
	}
	// Energy statistics for ems-esp

	if (adapter.config.ems_energy) {

		const power = adapter.config.ems_nominalpower;
		let powera = 0;

		try {
			let rec_state = adapter.config.ems_modulation;
			const array = rec_state.split(".");
			if (adapter.config.km200_structure == true && array[0] == "boiler") {
				rec_state = "heatSources.hs1." + array[1];
			}
			const state = await  adapter.getStateAsync(rec_state);
			const mod = state.val;
			powera = mod * power / 100;

		} catch(e) {adapter.log.error("State modulation for energy statistics does not exist");adapter.config.ems_energy = false;}

		let wwa = 0;
		try {
			let ww_state = adapter.config.ems_wwactive;
			const array2 = ww_state.split(".");
			if (km200_structure && array2[0] == "boiler") {
				ww_state = "dhwCircuits.dhw1." + array2[1];
			}
			const state = await adapter.getStateAsync(ww_state);
			wwa = state.val;
		} catch(e) {adapter.log.error("State wwactive for energy statistics does not exist");adapter.config.ems_energy = false; wwa = 0;}

		let statename = "energy.actualPower.power";
		await adapter.setStateAsync(statename, {ack: true, val: powera});

		if (wwa == 1 || wwa.toString() == "1" || wwa.toString() == "on" || wwa.toString() == "ON" || wwa.toString() == "true" ) {
			statename = "energy.actualDHWPower.power";
			await adapter.setStateAsync(statename, {ack: true, val: powera});
			statename = "energy.actualCHPower.power";
			await adapter.setStateAsync(statename, {ack: true, val: 0});
		}
		else {
			statename = "energy.actualDHWPower.power";
			await adapter.setStateAsync(statename, {ack: true, val: 0});
			statename = "energy.actualCHPower.power";
			await adapter.setStateAsync(statename, {ack: true, val: powera});
		}
	}
}

async function init_energy() {

	let statename = "energy.actualPower.power";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy power", unit: "kW", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualCHPower.power";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy power", unit: "kW", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualDHWPower.power";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy power", unit: "kW", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualPower._Hours";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualPower._Days";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualPower._Months";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualCHPower._Hours";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualCHPower._Days";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualCHPower._Months";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualDHWPower._Hours";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualDHWPower._Days";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

	statename = "energy.actualDHWPower._Months";
	await adapter.setObjectAsync(statename,{type: "state",
		common: {type: "number", name: "ems: energy consumption", unit: "kWh", role: "value", read: true, write: false}, native: {}});
	enable_state(statename);

}

async function read_energy() {
	const hours = 24*60;
	const adapt = adapter.namespace+".";

	let db;
	if (adapter.config.db.trim() == "" ) db = "";
	else db = adapter.config.db.trim()+"."+adapter.config.db_instance;

	let end = Date.now();
	let end_ = new Date(end);
	let year = end_.getFullYear();
	let month = end_.getMonth()+1;
	const date = end_.getDate();
	const hour = end_.getHours();
	end_ = new Date (year + "-" + month + "-" + date + " " + hour + ":00");
	end = end_.getTime() + 3600000;


	let intervall = 24 * 60 * 3600000; // hourly values for 60 days
	let step = 3600000; // one hour steps
	await energy(db, adapt+"energy.actualPower.power", adapt+"energy.actualPower._Hours",end,intervall,step);
	await energy(db, adapt+"energy.actualCHPower.power", adapt+"energy.actualCHPower._Hours",end,intervall,step);
	await energy(db, adapt+"energy.actualDHWPower.power", adapt+"energy.actualDHWPower._Hours",end,intervall,step);


	intervall = 24 * 60 * 3600000; // daily values for 60 days
	step = 3600000 * 24; // 24 hour steps
	end_ = new Date (year + "-" + month + "-" + date );
	end = end_.getTime() + 3600000 * 24;
	await energy(db, adapt+"energy.actualPower.power", adapt+"energy.actualPower._Days",end,intervall,step);
	await energy(db, adapt+"energy.actualCHPower.power", adapt+"energy.actualCHPower._Days",end,intervall,step);
	await energy(db, adapt+"energy.actualDHWPower.power", adapt+"energy.actualDHWPower._Days",end,intervall,step);

	const datum= new Date();
	year = datum.getFullYear();
	month = datum.getMonth() + 1;

	let year1 = year;
	let month1 = month+1;
	if (month1 == 13) {year1 = year1+1;month1=1;}

	let start,start_;
	for (let i=0;i<12;i++) {
		end_ = new Date (year1 + "-" + month1);
		end = end_.getTime();
		start_ = new Date (year + "-" + month);
		start = start_.getTime();
		intervall = end - start;
		step = intervall;

		//console.log(year+"-"+month+ " ---- "+year1+"-"+month1);
		await energy(db, adapt+"energy.actualPower.power", adapt+"energy.actualPower._Months",end,intervall,step);
		await energy(db, adapt+"energy.actualCHPower.power", adapt+"energy.actualCHPower._Months",end,intervall,step);
		await energy(db, adapt+"energy.actualDHWPower.power", adapt+"energy.actualDHWPower._Months",end,intervall,step);

		if (month == 1) {year = year-1;month=12;}
		else if (month > 1) {month = month-1;}
		if (month1 == 1) {year1 = year1-1;month1=12;}
		else if (month1 > 1) {month1 = month1-1;}
	}
}

async function energy(db,idr,idw,end,intervall,step) {
	const recs = [];
	const result = await adapter.sendToAsync(db, "getHistory", {id: idr,
		options: {start: end - intervall, end: end, step:step, integralUnit: 3600, aggregate: "total"}});
	const res = result.result;

	if (res.length > 1) {
		for (let i=1; i< res.length;i++) {
			const ts = res[i].ts;

			const val = Math.round(res[i].val / 240 * 100) / 100  ;
			recs.push({id: idw,state: {ts: ts ,val: val,ack: true}});
		}
	} else {
		const ts = end - intervall/2;
		recs.push({id: idw,state: {ts: ts ,val: 0,ack: true}});

	}

	const start =  (end-intervall);
	try {await adapter.sendToAsync(db,"deleteRange",[{id: idw, start: start, end: end}]);}
	catch(e) {adapter.log.error(e);}
	try {await adapter.sendToAsync(db,"storeState", recs);} catch(e) {adapter.log.error(e);adapter.log.error(recs);}
	adapter.log.info(recs);
}



function enable_state(statename) {
	let db;
	if (adapter.config.db.trim() == "" ) db = "";
	else db = adapter.config.db.trim()+"."+adapter.config.db_instance;

	if (db != "" && energy_init == true) {
		const id =  adapter.namespace  + "." + statename;
		adapter.sendTo(db, "enableHistory", {id: id, options:
			{changesOnly: false, debounce: 0,retention: 86400*365,changesRelogInterval: 0,
				maxLength: 100, changesMinDelta: 0, aliasId: "" } }, function (result) {
			if (result.error) {adapter.log.error("enable history error " + id);}
		});
	}
}



async function ems_get(url) {return new Promise(function(resolve,reject) {
	const options = {url: url, charset: "utf-8", method: "GET", status: [200], timeout: 5000, port: 80 };
	request(options, function(error,response,body) {
		if (error) {return reject(error);}
		if (response.statusCode !== 200) {return reject(error);}
		else {resolve(body);}
	});
});}


async function write_sensor(statename,value,def) {
	const array = statename.split(".");
	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.role = "value";
	obj.common.name=  def.name;
	obj.common.read = true;
	obj.common.write = false;
	obj.common.unit = def.uom;
	obj.common.type = def.type;
	obj.native = def;

	try {
		await adapter.setObjectNotExistsAsync(statename, obj);
		F.enums(adapter,statename);
	} catch(e) {}

	try {
		const state = await adapter.getStateAsync(statename);
		if(state == null) {adapter.setState(statename, {ack: true, val: value});}
		else {if (state.val != value) adapter.setState(statename, {ack: true, val: value});}
	} catch(e) {}

}


async function write_state(statename,value,def) {
	if (!unloaded) {
		const array = statename.split(".");
		let device = "", device_ems="",command ="",device_id="";
		let statename1 = statename;
		device = array[0];
		device_ems=device;
		if (def == "Invalid") adapter.log.warn("Invalid:"+statename);


		if (km200_structure) {
			if (array[0] == "thermostat") device = "heatingCircuits";
			if (array[0] == "thermostat" && array[1].substring(0,2) == "ww") device = "dhwCircuits";
			if (array[0] == "thermostat" && array[1].substring(0,3) == "hm_") device = "system.holidayModes";
			if (array[0] == "mixer" && array[1].substring(0,2) == "hc") device = "heatingCircuits";
			if (array[0] == "mixer" && array[1].substring(0,3) == "dhw") device = "dhwCircuits";
			if (array[0] == "mixer" && array[1] == "wwc1") device = "dhwCircuits.dhw1";
			if (array[0] == "mixer" && array[1] == "wwc2") device = "dhwCircuits.dhw2";

			if (array[0] == "solar") device = "solarCircuits.sc1";
			if (array[0] == "boiler") {
				device = "heatSources.hs1";
				if (array[1].substring(0,2) == "hs") device = "heatSources";
				if (array[1].substring(0,2) == "ww" || array[1].substring(0,2) == "wW" ) device = "dhwCircuits.dhw1";
				//if (array[1] == "ahs1" ) device = "heatSources.hsa";
			}

			if (array[0] == "heatsource" ) device = "heatSources";

		} else {
			if (array[0] == "thermostat" && array[1].substring(0,3) == "hm_") device = "thermostat.hm";
		}

		command = array[1];

		if (array.length == 3) {
			if (array[1].substr(0,2) == "hc" || array[1].substr(0,3) == "ahs" || array[1].substr(0,2)  == "hs" || array[1].substr(0,3)  == "wwc" ) {
				device_id = array[1];
				command = array[2];
			}
			try  {command = command.toLowerCase();} catch(e) {command = "";}
		}

		if (device_id == "") {
			statename1 = device+"."+command;
		} else {
			statename1 = device+"."+device_id+"."+command;
		}

		statename1 = statename1.replace("#","");

		const obj={_id:statename1,type:"state",common:{},native:{}};
		const obj1={_id:statename1,type:"state",common:{},native:{}};
		obj.common.id = statename;
		obj.common.name= "ems:"+statename;
		obj.common.type = "mixed";
		obj.common.unit = "";
		obj.common.read = true;
		obj.common.write = false;

		obj.common.role = "value";

		let defj = {};
		if (def != "" && def != "Invalid") {
			try {defj = JSON.parse(def);} catch(e) {def = def.replace(".,", ",");}
			/* 2nd try with corrected numeric values */
			try {defj = JSON.parse(def);}
			catch(e) {
				adapter.log.warn("wrong ems-esp state definition: " + statename + "  " + def);
				def = "";
			}
		}

		if (def != "" && def != "Invalid") {
			obj.common.role = F.roles(adapter,device,defj.type,defj.uom,defj.writeable);

			obj.common.name= "ems: "+defj.fullname;

			if (defj.writeable == true) {obj.common.write = true;}
			obj.common.unit = defj.uom;

			if(defj.writeable == true) obj.common.min = defj.min;
			if(defj.writeable == true) obj.common.max = defj.max;

			if(defj.type == "text") defj.type = "string";
			obj.common.type = defj.type;

			if(defj.type == "enum") {
				obj.common.type = "mixed";
				obj.common.states = {};
				obj.native.ems_enum = defj.enum;

				for (let ii = 0; ii< defj.enum.length;ii++) {
					let index = ii;
					if (defj.min == 1) { index = ii + 1;}
					obj.common.states[index] = defj.enum[ii];
				}
			}

			if(defj.type == "boolean") {
				obj.common.type = "number";

				switch (value) {
					case true: value = 1; break;
					case "true": value = 1; break;
					case "1": value = 1; break;
					case "ON": value = 1; break;
					case "on": value = 1; break;

					case false: value = 0; break;
					case "false": value = 0; break;
					case "0": value = 0; break;
					case "OFF": value = 0; break;
					case "off": value = 0; break;
				}

				obj.common.states = {"0":"Off","1":"On"};
				obj.common.min = 0;
				obj.common.max = 1;
			}
			obj.native.ems_type = defj.type;
			try {obj.native.visible = defj.visible;} catch(e) {}

		}

		if (def == "") {

			switch (value) {
				case true: value = 1; break;
				case "true": value = 1; break;
				case "1": value = 1; break;
				case "ON": value = 1; break;
				case "on": value = 1; break;

				case false: value = 0; break;
				case "false": value = 0; break;
				case "0": value = 0; break;
				case "OFF": value = 0; break;
				case "off": value = 0; break;
			}

		}

		if (device_ems == "ems") {
			obj.common.write = false;
		}

		//obj.native.source = "ems-esp";
		obj.native.ems_command = command;
		obj.native.ems_device = device_ems;
		obj.native.ems_id = device_id;
		obj.native.ems_api = ems_version;

		// @ts-ignore
		try {
			await adapter.setObjectNotExistsAsync(statename1, obj);

			if (def != "" && def != "Invalid" ) {
				const defj = JSON.parse(def);
				await adapter.setObjectAsync(statename1, obj);

				if (obj.native.ems_command == "seltemp") {
					obj.common.min = -1;
					await adapter.setObjectAsync(statename1, obj); // reset min value for seltemp
				}
				F.enums(adapter,statename1);
			}
		} catch(e) {}

		try {
			const state = await adapter.getStateAsync(statename1);
			const obj = await adapter.getObjectAsync(statename1);

			if(obj.native.ems_type == "enum") {
				if (isNaN(value)) {
					//value not index of enum -> search number
					let found = -1;
					for (let ii = 0; ii< 10;ii++) {
						if (obj.common.states[ii] == value) {found = ii;break;}
					}
        			value = found;
				}
			}
			//adapter.setState(statename1, {ack: true, val: value});
			if (value != undefined) {
				if(state == null) {adapter.setState(statename1, {ack: true, val: value});}
				else {if (state.val != value || state.ack == false) adapter.setState(statename1, {ack: true, val: value});}
			}
		} catch(e) {}
	}
}


const state_change = async function (id,state,obj) {
	if (unloaded) return;
	const value = state.val;

	try {
		ems_version = obj.native.ems_api;

		if (obj.native.ems_device != null){

			let url = emsesp + "/api/" + obj.native.ems_device;
			if (obj.native.ems_id =="") {url+= "/"+ obj.native.ems_command;}
			else {url+= "/"+ obj.native.ems_id + "/" +obj.native.ems_command;}

			adapter.log.info("write change to ems-esp: "+ id + ": "+value);

			const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
			const body =JSON.stringify({"value": value});

			request.post({url, headers: headers, body}, function(error,response) {
				const status= JSON.parse(response.body).statusCode;
				const resp= JSON.parse(response.body).message;
				if (resp != "OK") adapter.log.error("ems-esp http write error: " + status + " " + resp + "  " + url);
			});

		}
	} catch(e) {}
};


async function sleep(ms) {
	if (unloaded) return;
	return new Promise(resolve => {
		setTimeout(() => !unloaded && resolve(true), ms);
	});
}

const unload = function (u) {unloaded = u;};

module.exports ={init,state_change,unload};