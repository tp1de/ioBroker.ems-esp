const request = require("request");

let unloaded = false;

let emsesp,ems_token ="",ems_http_wait = 100, ems_poll_wait,ems_polling = 60;
let ems_version = "V2",enable_syslog = false;
const db = "sql.0";
let km200_structure = true;
const owm_states = [];


let adapter;
const init = async function(a,o,i) {
	adapter = a;
	own_states = o;
	aliveState =  "system.adapter."+adapter.namespace + ".alive";

	emsesp = adapter.config.emsesp_ip ;
	if (emsesp.substr(0,7) != "http://") emsesp = "http://" + emsesp;

	ems_token = adapter.config.ems_token.trim();
	ems_http_wait = adapter.config.ems_http_wait;
	ems_poll_wait = adapter.config.ems_poll_wait;
	ems_polling = adapter.config.ems_polling;
	if (ems_polling < 15) ems_polling = 15;
	km200_structure= adapter.config.km200_structure;

	// Testing API Version
	const url = emsesp +  "/api/system";
	try {
		const data = await ems_get(url);
		ems_version = "V3";
	}
	catch(error) {ems_version = "V2";}
	adapter.log.info("API version identified " + ems_version);
	const version = ems_version;

	if (!unloaded) await init_states_emsesp(version);
	if (version == "V2" && !unloaded) await v2_readwrite(); // test for API V2 if states are writable

	if (!unloaded) adapter.log.info("ems  :"+adapter.config.emsesp_active + " " + ems_polling + " secs");
	if (!unloaded) i.ems = setInterval(function() {ems_read(version);}, ems_polling*1000);

};




async function init_states_emsesp(version) {
	adapter.log.info("start initializing ems states " + unloaded);
	let url = emsesp +  "/api?device=system&cmd=info";
	if (ems_version == "V3") url = emsesp +  "/api/system";
	write_state("esp.api",ems_version,"");

	adapter.log.info(version+"  url:" +url);
	let data ="";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.warn("ems read system error - wrong ip address?");
		data = "Invalid";
	}

	if (data != "Invalid") {

		let devices = {}, status = {}, system = {}, network = {};
		try {
			devices = JSON.parse(data).Devices;
			status = JSON.parse(data).Status;
			system = JSON.parse(data).System;
			adapter.log.info("ems-esp-version identified:" + system.version);
		}
		catch(error) {adapter.log.error("*** error can't read system information " + error);}

		try {
			network = JSON.parse(data).Network;
			for (const [key, value] of Object.entries(network)) {
				if (typeof value !== "object") write_state("esp."+key,value,"");
			}
		}
		catch (error) {}

		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}


		for (let i=0; i < devices.length; i++) {
			if (devices[i].handlers != undefined) {
				const device = devices[i].type.toLowerCase();
				let url1 = "";
				url1 = emsesp + "/api?device=" + device + "&cmd=info";
				if (version == "V3") url1 = emsesp +  "/api/"+device;

				adapter.log.info(version + "  url1:" + url1);
				data="";
				try {data = await ems_get(url1); }
				catch(error) {adapter.log.error("ems http read error init:" + device + " --> " + error + " - " + url1);}
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
							await sleep(ems_http_wait);
						}
					}
					await sleep(ems_http_wait);
				}
			}
		}
	}
	adapter.log.info("end of initializing ems states " + unloaded);
}

async function v2_readwrite() {
	const fields = [];
	const select = adapter.namespace+".*";

	const states = await adapter.getStatesAsync(select);
	for (const id in states) {fields.push(id);}


	for (let i = 0; i < fields.length; i++) {
		await test_v2(fields[i]);
		await sleep(ems_http_wait);
	}
}


async function test_v2(id) {
	const obj = await adapter.getObjectAsync(id);
	if (obj.native.write == null  && obj.native.ems_device != null) {
		const state = await adapter.getStateAsync(id);
		if (state != null) {
			let url = emsesp + "/api?device=" + obj.native.ems_device + "&cmd=" + obj.native.ems_command + "&data=" + state.val;
		    if (obj.native.ems_id != "") {url+= "&id="+ obj.native.ems_id;}

			try {
				request(url , function(error,response) {
					if (response != undefined) {
						const status = response.statusCode;
						const resp= response.body;
						if (resp != "OK") {
							obj.common.write = false;
							obj.native.write = false;
							adapter.setObject(id,obj);
						}
						if (resp == "OK") {
							obj.common.write = true;
							obj.native.write = true;
							adapter.setObject(id,obj);
						}
					}
				});
			}
			catch (error) {}
		}
	}
}



async function ems_read(version) {
	const t1 = new Date().getTime();
	let url = emsesp +  "/api?device=system&cmd=info";
	if (version == "V3") url = emsesp +  "/api/system";

	//adapter.log.info(version + "  " + url);
	let data = "";
	try {data = await ems_get(url); }
	catch(error) {
		adapter.log.debug("ems read system error:" +url+ " - wrong ip address?");
		data = "Invalid";
	}
	await sleep(ems_http_wait);

	if (data != "Invalid") {
		let devices = {}, status = {}, system = {}, network = {};
		try {
			devices = JSON.parse(data).Devices;
			status = JSON.parse(data).Status;
			system = JSON.parse(data).System;
		}
		catch(error) {
			//adapter.log.error("*** error can't read system information")
		}

		try {
			network = JSON.parse(data).Network;
			for (const [key, value] of Object.entries(network)) {
				if (typeof value !== "object") write_state("esp."+key,value,"");
			}
		}
		catch (error) {}


		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}


		for (let i=0; i < devices.length; i++) {
			if (devices[i].handlers != undefined) {
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

		//adapter.setStateAsync("statistics.ems-read", {ack: true, val: t3});
	}

	if (adapter.config.ems_dallas) {

		url = emsesp +  "/api?device=dallassensor&cmd=info";
		if (version == "V3") url = emsesp +  "/api/dallassensor";

		data = "";
		try {data = await ems_get(url); }
		catch(error) {
			adapter.log.debug("ems read dallassensor error:" +url);
			data = "Invalid";
		}
		await sleep(ems_http_wait);

		let sensors = {};
		try {sensors = JSON.parse(data);}
		catch(error) {
			adapter.log.info("ems read dallassensor parse error: "+ url + "->" + data);
		}

		for (const [key, value] of Object.entries(sensors)) {
			if (value.temp == undefined) write_state("dallas."+key,value,"");
			else write_state("dallas."+key,value.temp,"");
		}
	}

}



async function ems_get(url) {return new Promise(function(resolve,reject) {
	const options = {url: url, method: "GET", status: [200], timeout: 5000, port: 80 };
	request(options, function(error,response,body) {
		if (error) {return reject(error);}
		if (response.statusCode !== 200) {return reject(error);}
		else {resolve(body);}
	});
});}

async function ems_apiversion(emsesp) {
	let ems_version;
	try {const data = await ems_get(emsesp+"/api/system");ems_version = "V3";}catch(error) {ems_version = "V2";}
	return(ems_version);
}

async function ems_put(url,value)  {
	const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
	const body =JSON.stringify({"value": value});
	request.post({url, headers: headers, body}, function(error,response) {
		try {const resp= JSON.parse(response.body).message;}
		catch(error) {const resp = "";}
		return (response);
	});
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
			if (array[0] == "mixer") device = "heatingCircuits";
			if (array[0] == "solar") device = "solarCircuits.sc1";
			if (array[0] == "boiler") {
				device = "heatSources.hs1";
				if (array[1].substring(0,2) == "ww" || array[1].substring(0,2) == "wW" ) device = "dhwCircuits.dhw1";
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

			obj.common.name= "ems: "+defj.fullname;

			if (defj.writeable == true) {obj.common.write = true;}
			obj.common.unit = defj.uom;

			if(defj.writeable == true) obj.common.min = defj.min;
			if(defj.writeable == true) obj.common.max = defj.max;

			if(defj.type == "text") defj.type = "string";
			obj.common.type = defj.type;

			if(defj.type == "enum") {
				obj.common.type = "mixed";
				obj.common.states = "";
				obj.native.ems_enum = defj.enum;
				for (let ii = 0; ii< defj.enum.length;ii++) {
					if (defj.min == 1) {obj.common.states += (ii+1)+":"+defj.enum[ii];}
					else {obj.common.states += ii+":"+defj.enum[ii];}
					if (ii< defj.enum.length-1) obj.common.states += ";";
				}
			}

			if(defj.type == "boolean") {
				obj.common.type = "number";
				if (value === true || value === "on" || value === "ON") value = 1;
				if (value === false || value === "off" || value === "OFF") value = 0;
				obj.common.states = "0:Off;1:On";
				obj.common.min = 0;
				obj.common.max = 1;
			}
			obj.native.ems_type = defj.type;

		}

		if (def == "") {
			if (value === true || value === "on" || value === "ON") value = 1;
			if (value === false || value === "off" || value === "OFF") value = 0;
		}

		if (device_ems == "ems") {
			obj.common.write = false;
		}

		if (ems_version == "V2") {
			if (device_ems == "mixer") obj.common.write = false;
			if (device_ems == "thermostat") obj.common.write = true;
			if (device_ems == "boiler") obj.common.write = true;
			if (device_ems == "heatpump") obj.common.write = true;
			if (device_ems == "solar") obj.common.write = true;
			if (statename.indexOf("temp") > -1) obj.common.unit = "°C";
			if (statename.indexOf("Temp") > -1) obj.common.unit = "°C";
		}

		//obj.native.source = "ems-esp";
		obj.native.ems_command = command;
		obj.native.ems_device = device_ems;
		obj.native.ems_id = device_id;
		obj.native.ems_api = ems_version;

		// @ts-ignore
		try {
			await adapter.setObjectNotExistsAsync(statename1, obj);

			if (def != "" && def != "Invalid" && ems_version == "V3") {
				const defj = JSON.parse(def);
				await adapter.setObjectAsync(statename1, obj);
				if (obj.native.ems_command == "seltemp") {
					obj.common.min = -1;
					await adapter.setObjectAsync(statename1, obj); // reset min value for seltemp
				}
			}
		} catch(e) {}

		/*
	if (ems_version == "V3") {
		let obj = await adapter.getObjectAsync(statename1);
		if (obj != undefined) {
			if (obj.native.ems_type == "enum") {
				for (let iii = 0; iii < obj.native.ems_enum.length;iii++) {
					if (obj.native.ems_enum[iii] == value) value = iii;	// When field value is returned as text --> transform into number
				}
			}
		}
	}
	*/
		try {
			const state = await adapter.getStateAsync(statename1);
			if(state == null) {adapter.setState(statename1, {ack: true, val: value});}
			else {if (state.val != value) adapter.setState(statename1, {ack: true, val: value});}
		} catch(e) {}
	}
}







const state_change = async function (id,state,obj) {
	if (unloaded) return;
	let value = state.val;

	try {
		ems_version = obj.native.ems_api;

		if (ems_version == "raw" && obj.common.role == "value") {
			let vc = "";

			if (obj.native.ems_multi != "") {
				const multi = 1 / obj.native.ems_multi;
				value = value * multi;
				vc = value.toString(16);
			} else vc = value.toString(16);

			if (vc.length == 1) vc = "0" + vc;
			if (vc.length == 3) vc = "0" + vc;

			let type = obj.native.ems_type;

			if (type.substring(0,2) == "0x") type = type.substring(2);
			let telegram = "0B " + obj.native.ems_src + " ";

			if (type.length == 2) {
				telegram += type + " " + obj.native.ems_offset + " " + vc;
			}
			if (type.length == 3) {
				telegram += "FF " + obj.native.ems_offset + " 0" + type.substring(0,1);
				telegram += " " + type.substring(1,2) + " " + vc;
			}
			if (obj.native.ems_type.length == 4) {
				telegram += "FF " + obj.native.ems_offset + " " + type.substring(0,2);
				telegram += " " + type.substring(2,4) + " " + vc;

			}

			adapter.log.info(type + " " + type.length + " " + telegram);

			const url = emsesp + "/api/system/send ";
			adapter.log.info("write change to ems-esp raw telegram: "+ id + ": "+value);

			const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
			const body =JSON.stringify({"value": telegram});

			request.post({url, headers: headers, body}, function(error,response) {
				const status= JSON.parse(response.body).statusCode;
				const resp= JSON.parse(response.body).message;
				if (resp != "OK") adapter.log.error("ems-esp http write error: " + status + " " + resp + "  " + url);
			});


		}


		if (ems_version == "raw" && obj.common.role == "switchPrograms") {

			const spa = JSON.parse(value);
			const t = switchProgram_to_telegram(spa);
			const tt = t.split(" ");

			let type = obj.native.ems_type;
			const src = obj.native.ems_src;
			if (type.substring(0,2) == "0x") type = type.substring(2);
			if (type.length == 3) type = "0"+type;

			const url = emsesp + "/api/system/send ";
			adapter.log.info("write change to ems-esp raw telegram: "+ id);
			const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};

			let offset = 0;
			let telegram = "";

			for (i=0;i<7;i++) {
				offset = (i*12).toString(16).toUpperCase();
				if (offset.length == 1) offset = "0"+offset;
				telegram = "0B " + src + " FF " +  offset + " " + type.substring(0,2)+ " " + type.substring(2,4);

				for (ii=0;ii<12;ii++) {
					telegram += " " + tt[(i*12)+ii];
				}
				adapter.log.info(telegram);

				const body =JSON.stringify({"value": telegram});
				request.post({url, headers: headers, body}, function(error,response) {
					const status= JSON.parse(response.body).statusCode;
					const resp= JSON.parse(response.body).message;
					if (resp != "OK") adapter.log.error("ems-esp http write error: " + status + " " + resp + "  " + url);
				});

			}
		}


		if (obj.native.ems_device != null){
			if (ems_version == "V3") {
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
			if (ems_version == "V2") {
				let url = emsesp + "/api?device=" + obj.native.ems_device + "&cmd=" + obj.native.ems_command + "&data=" + value;
				if (obj.native.ems_id != "") {url+= "&id="+ obj.native.ems_id;}
				adapter.log.info("write change to ems-esp V2: "+ id + ": "+value);
				request(url , function(error,response) {
					const status = response.statusCode;
					const resp= response.body;
					if (resp != "OK") adapter.log.error("ems-esp http write error: " + status + " " + resp + "  " + url);
				});
			}


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