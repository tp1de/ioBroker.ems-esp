/* eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
const request = require("request");
const F = require("./functions.js");

let unloaded = false;

let emsesp,ems_token ="",ems_http_wait = 100, ems_polling = 60;
let ems_version = "V3";
let km200_structure = true;

let adapter;


const init = async function(a,o,i) {
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
	const url = emsesp +  "/api/system";
	try {
		const data = await ems_get(url);
		ems_version = "V3";
	}
	catch(error) {
		ems_version = "V2";
		adapter.log.error("API version V2 identified. V2 is not supported anymore");
		return;
	}


	adapter.log.info("API version identified " + ems_version);
	const version = ems_version;

	if (!unloaded) await init_states_emsesp(version);
	if (!unloaded) adapter.log.info("ems  :"+adapter.config.emsesp_active + " " + ems_polling + " secs");
	if (!unloaded) i.ems = setInterval(function() {ems_read(version);}, ems_polling*1000);
};




async function init_states_emsesp(version) {
	adapter.log.info("start initializing ems states " + unloaded);
	const url = emsesp +  "/api/system";
	write_state("esp.api",ems_version,"");

	adapter.log.info(version+"  url:" +url);
	let data ="";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.warn("ems read system error - wrong ip address?");
		data = "Invalid";
	}

	await sleep(ems_http_wait);
	if (data != "Invalid") {

		let devices = {};
		try {devices = JSON.parse(data).Devices;}catch(e){adapter.log.error("error reading ems devices");}
		read_status(data,"esp");

		for (let i=0; i < devices.length; i++) {
			if (device_check(devices[i])) {
				const device = devices[i].type.toLowerCase();
				const url1 = emsesp +  "/api/"+device;

				adapter.log.info(version + "  url1:" + url1);
				data="";
				try {data = await ems_get(url1); }
				catch(error) {
					if (error != null) adapter.log.error("ems http read error init:" + device + " --> " + error + " - " + url1);
				}
				let fields = {};
				if (data != "") {
					try {fields = JSON.parse(data);}
					catch(e) {adapter.log.warn("ems parse error device " + device + " " + url1 + ":"+ data);}
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
	adapter.log.info("end of initializing ems states ");
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
	} catch(e) {adapter.log.error("error ems read status");}
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
		else {if (state.val != value) adapter.setState(statename, {ack: true, val: value});}
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
		adapter.log.debug("ems read system error:" +url+ " - wrong ip address?");
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

		for (let i=0; i < devices.length; i++) {
			if (device_check(devices[i])) {
				const device = devices[i].type.toLowerCase();
				let url1 = emsesp + "/api?device=" + device +"&cmd=info";
				if (version == "V3") url1 = emsesp +  "/api/"+device;

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
			await sleep(ems_http_wait);
		}
		const t2 = new Date().getTime();
		const t3 = (t2-t1) / 1000;

		if (adapter.config.statistics) {
			adapter.setObjectNotExists("statistics.ems-read",{type: "state",
				common: {type: "number", name: "ems read time for polling", unit: "seconds", role: "value", read: true, write: true}, native: {}});
			adapter.setStateAsync("statistics.ems-read", {ack: true, val: t3});
		}
	}

	if (adapter.config.ems_dallas) {
		const url = emsesp +  "/api/dallassensor";
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
		if (array[1].substr(0,2) == "hc" || array[1].substr(0,3) == "ahs" || array[1].substr(0,2)  == "hs" || array[1].substr(0,3)  == "wwc" ) {
			device_id = array[1];
			command = array[2];
		}
		try  {command = command.toLowerCase();} catch(e) {command = "";}

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

		if (def != "" && def != "Invalid") {
			const defj = JSON.parse(def);
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
					let index = "";
					if (defj.min == 1) { index = ii + 1;}
					else { index = ii;}
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

			if(state == null) {adapter.setState(statename1, {ack: true, val: value});}
			else {if (state.val != value) adapter.setState(statename1, {ack: true, val: value});}
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

			adapter.log.info("write change to ems-esp V3: "+ id + ": "+value);

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
		setTimeout(() => !unloaded && resolve(), ms);
	});
}

const unload = function (u) {unloaded = u;};

module.exports ={init,state_change,unload};