// @ts-nocheck
/* eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
const { default: axios } = require("axios");

let emsesp, ems_token = "", busid = "00";
let own_states = [], devices = [], switchTimes = [];
let thermostat_id, handlers;
let unloaded = false;

let adapter;
let state_suffix = "";

const init = async function (a, i) {
	adapter = a;
	let busid_d = 11;
	let init = false;
	try { busid_d = (await adapter.getStateAsync("esp.Settings.ems bus id")).val; } catch (e) { }
	try { busid_d = (await adapter.getStateAsync("esp.Settings.ems_bus_id")).val; } catch (e) { }
	try { busid_d = (await adapter.getStateAsync("esp.settings.emsBusId")).val; } catch (e) { }

	busid = 0x00 + busid_d.toString(16).toUpperCase();
	adapter.log.debug("busid: " + busid);

	try {

		emsesp = adapter.config.emsesp_ip;
		if (emsesp.substr(0, 3) == "***") emsesp = emsesp.substr(3);
		if (emsesp.substr(0, 7) != "http://") emsesp = "http://" + emsesp;
		ems_token = adapter.config.ems_token.trim();

		//   Read thermostat device id
		const url = emsesp + "/api/system";
		let data = "";
		try { data = await ems_get(url); } catch (e) { }

		let dev = {}, dev_count = 0;
		try {
			dev = JSON.parse(data).Devices;
			if (dev == undefined) dev = JSON.parse(data).devices;
			dev_count = dev.length;
		} catch (ee) { }

		thermostat_id = "*";
		handlers = "";
		let thermostat_count = 0;

		for (let i = 0; i < dev_count; i++) {
			const device = dev[i].type.toLowerCase();
			//adapter.log.info(device);
			if (device == "thermostat") {
				thermostat_count += 1;
				try { thermostat_id = dev[i]["device id"]; } catch (ee) { }
				if (thermostat_id == undefined) try { thermostat_id = dev[i]["deviceID"]; } catch (ee) { }

				if (dev[i]["handlers received"] != undefined) handlers += dev[i]["handlers received"] + " ";
				if (dev[i]["handlers fetched"] != undefined) handlers += dev[i]["handlers fetched"] + " ";
				if (dev[i]["handlers pending"] != undefined) handlers += dev[i]["handlers pending"] + " ";
				if (dev[i]["handlers ignored"] != undefined) handlers += dev[i]["handlers ignored"];

				if (dev[i]["handlersReceived"] != undefined) handlers += dev[i]["handlersReceived"] + " ";
				if (dev[i]["handlersFetched"] != undefined) handlers += dev[i]["handlersFetched"] + " ";
				if (dev[i]["handlersPending"] != undefined) handlers += dev[i]["handlersPending"] + " ";
				if (dev[i]["handlersIgnored"] != undefined) handlers += dev[i]["handlersIgnored"];
			}
		}

		thermostat_id = thermostat_id.replace("0x", "");

		if (thermostat_count != 1) {
			adapter.log.warn("ems-esp: more then one thermostat found - extended entities function not possible");
			const inst = "system.adapter." + adapter.namespace;
			const obj = await adapter.getForeignObjectAsync(inst);
			obj.native.devices = [];
			obj.native.switchTimes = [];
			obj.native.ems_custom = false;
			await adapter.setForeignObjectAsync(inst, obj);
			adapter.log.warn("ems: extended entities function disabled .... instance will restart");
		}
		else {
			adapter.log.debug("thermostat_id: " + thermostat_id);
			adapter.log.debug("handlers: " + handlers);	
		}

		devices = adapter.config.devices;
		switchTimes = adapter.config.switchTimes;

		let length1 = 0; try { length1 = devices.length; } catch (e) { }
		let length2 = 0; try { length2 = switchTimes.length; } catch (e) { }

		if (length1 == 0 && length2 == 0) {
			adapter.log.info("EMS+ entity new search initialized - this might take several minutes");
			devices = init_own_states(thermostat_id);
			switchTimes = init_switchTimes(thermostat_id);
			//adapter.log.debug(JSON.stringify(switchTimes));
			init = true;
		}

		if (switchTimes == undefined) {
			// reinitialize devices and switchTimes for new structure
			adapter.log.info("EMS+ entity search structure has changed - new search initialized");
			devices = init_own_states(thermostat_id);
			switchTimes = init_switchTimes(thermostat_id);
			init = true;
		}

		//if (init) check_handlers(handlers);
		
		//adapter.log.debug(JSON.stringify(devices));
		//adapter.log.debug(JSON.stringify(switchTimes));

		state_suffix = "";
		if (adapter.config.km200_active && adapter.config.km200_structure) state_suffix = "_";

		await ems_poll();

		let count = 0;
		let d = [], st = [];

		try {
			for (let i = 0; i < devices.length; i++) {
				if (devices[i].polling) {
					adapter.log.info("extended entity found:" + devices[i].state);
					count += 1;
					d.push(devices[i]);
				}
			}
		} catch (e) { }

		try {
			for (let i = 0; i < switchTimes.length; i++) {
				if (switchTimes[i].polling) {
					adapter.log.info("extended entity found:" + switchTimes[i].state);
					count += 1;
					st.push(switchTimes[i]);
				}
			}
		} catch (e) { }


		if (init && count > 0) {
			init = false;
			const inst = "system.adapter." + adapter.namespace;
			const obj = await adapter.getForeignObjectAsync(inst);
			obj.native.devices = d;
			obj.native.switchTimes = st;
			await adapter.setForeignObjectAsync(inst, obj);
			adapter.log.info("ems: extended entities configuration stored .... instance will restart");
		}

		if (count > 0 && count < 5) {
			adapter.log.info("extended entity poll for " + count + " states every minute");
			i.poll = setInterval(function () { ems_poll(); }, 60000);
		}
		if (count >= 5 && count < 10) {
			adapter.log.info("extended entity poll for " + count + " states every 2 minutes");
			i.poll = setInterval(function () { ems_poll(); }, 120000);
		}
		if (count >= 10) {
			adapter.log.info("extended entity poll for " + count + " states every 3 minutes");
			i.poll = setInterval(function () { ems_poll(); }, 180000);
		}

	} catch (e) { adapter.log.error(e) }
};

async function check_handlers(handlers) {

	handlers = handlers.replaceAll("0x", "");
	let h = handlers.split(" ");
	for (let i = 0; i < h.length; i++) { h[i] = type_to_raw(h[i]); }
	h.sort();

	let f = 0, t = "";
	for (let i = 0; i < devices.length; i++) {
		t = devices[i].type;
		f = h.indexOf(t);
		if (f == -1) {
			devices[i].polling = false;
			devices.splice(i, 1);
		}
	}

	for (let i = 0; i < switchTimes.length; i++) {
		t = switchTimes[i].typei; f = h.indexOf(t);
		if (f == -1) {
			switchTimes[i].typei = "";
			switchTimes[i].offseti = "";
			switchTimes[i].type2 = "";
		}

		t = switchTimes[i].type1; f = h.indexOf(t);
		if (f == -1) {
			switchTimes[i].typei = "";
			switchTimes[i].offseti = "";
			switchTimes[i].polling = false;
			switchTimes[i].type1 = "";
			switchTimes[i].type2 = "";
			switchTimes.splice(i, 1);
		}
	}
}

async function ems_poll() {
	const t1 = new Date().getTime();

	try {
		for (let i = 0; i < devices.length; i++) {
			if (devices[i].polling && !unloaded) {

				let telegram = busid + " ";

				hexValue = parseInt(devices[i].src, 16);
				hexValue = hexValue + 0x80;
				const dest = hexValue.toString(16).toUpperCase();
				telegram += dest + " ";

				if (devices[i].type.length > 2) {
					telegram += "FF ";
					telegram += devices[i].offset + " ";
					if (devices[i].bytes < 10) telegram += "0";
					telegram += devices[i].bytes + " ";
					telegram += devices[i].type.substr(0, 2) + " ";
					telegram += devices[i].type.substr(2, 2) + " ";
				} else {
					telegram += devices[i].type + " ";
					telegram += devices[i].offset + " ";
					telegram += devices[i].bytes;
				}

				let urls = emsesp + "/api/system/send ";
				await ems_put(urls, telegram);
				adapter.log.debug("telegram: " + telegram);
				await adapter.delay(1000);
				let response = "";
				url = emsesp + "/api/system/response ";
				const type = devices[i].type;
				const offset = devices[i].offset;
				let typer, offsetr;

				[typer, offsetr, response] = await resp(url, urls, init, type, telegram);

				if (type != typer) {
					adapter.log.debug("telegram " + type + " not found");
					devices[i].polling = false;
				}
				else {

					try {
						let resp = JSON.parse(response).response;
						if (resp == "") devices[i].polling = false;
					} catch (e) { }


					if (devices[i].polling) {
						try {
							r = JSON.parse(response).data;
							//adapter.log.info("r: "+r);
							if (r == "<empty>" || r == "") devices[i].polling = false;
						}
						catch (error) { adapter.log.error("catch"); devices[i].polling = false; }
					}
					let d;
					try { d = r.split(" "); } catch (e) { }

					if (devices[i].polling) {

						const bytes = devices[i].bytes;
						const bit = devices[i].bit;
						let wb = "";

						switch (devices[i].state_type) {
							case "switchPrograms":
								try { read_switchPrograms(devices[i], d); }
								catch (error) { adapter.log.warn("no poll response for extended entity telegram " + devices[i].state); }
								break;

							case "holidayModes":
								try { read_holidayModes(devices[i], d); }
								catch (error) { adapter.log.warn("no poll response for extended entity telegram " + devices[i].state); }
								break;

							case "number":
								if (devices[i].bit == "") {
									for (let ii = 0; ii < bytes; ii++) { wb += d[ii]; }
									const s = devices[i].signed;
									let w = parseInt(wb, 16);
									if (s == true) w = hexToSignedInt(wb);
									let m = 1;
									if (devices[i].multi !== "") m = devices[i].multi;
									if (w == -1 && bytes == 1) m = 1;
									w = w / m;
									write_ownstate(devices[i].state, w, devices[i]);
								}
								else {
									let wbb = "";
									wb = d[0];
									wbb = parseInt(wb, 16).toString(2).padStart(8, "0");
									const w = parseInt(wbb.substr(7 - bit, 1));
									write_ownstate(devices[i].state, w, devices[i]);
								}
								break;

							case "string":
								for (let ii = 0; ii < bytes; ii++) { wb += d[ii]; }
								write_ownstate(devices[i].state, wb, devices[i]);
								break;

							case "hex":
								for (let ii = 0; ii < bytes; ii++) { wb += d[ii] + " "; }
								write_ownstate(devices[i].state, wb, devices[i]);
								break;

							default:
								try {
									//adapter.log.debug(devices[i].state + " " + devices[i].state_type + " " + r);
								}
								catch (error) { adapter.log.warn("no poll response for extended entity telegram " + devices[i].state); }
								break;
						}
					}
				}
			}
		}
	} catch (e) { }

	try {
		for (let i = 0; i < switchTimes.length; i++) {
			//adapter.log.debug(i+ " "+ JSON.stringify(switchTimes[i]));

			if (switchTimes[i].polling && !unloaded) {
				let typer, offsetr, type, telegram, hexValue, url, urls, dest, response, r;

				let val = 0;
				if (switchTimes[i].typei.trim() != "") {
					let st = "";
					try {
						for (let ii = 0; ii < devices.length; ii++) {
							if (switchTimes[i].typei == devices[ii].type && switchTimes[i].offseti == devices[ii].offset) {
								st = devices[ii].state;
								break;
							}
						}
					} catch (e) { }
					if (adapter.config.km200_structure) st = st.replace("thermostat", "heatingCircuits");

					try { if (st != "") val = (await adapter.getStateAsync(st)).val; } catch (e) { }

				}

				if (val == 0) {
					type = switchTimes[i].type1;
					switchTimes[i].typei = "";
					switchTimes[i].type2 = "";
					switchTimes[i].offseti = "";
				}
				if (val == 1) type = switchTimes[i].type1;
				if (val == 2) type = switchTimes[i].type2;


				telegram = busid + " ";
				hexValue = parseInt(switchTimes[i].src, 16);
				hexValue = hexValue + 0x80;
				dest = hexValue.toString(16).toUpperCase();
				telegram += dest + " FF 00 FF ";
				telegram += type.substr(0, 2) + " ";
				telegram += type.substr(2, 2) + " ";
				urls = emsesp + "/api/system/send ";
				await ems_put(urls, telegram);
				await adapter.delay(1000);
				response = "";
				url = emsesp + "/api/system/response ";

				[typer, offsetr, response] = await resp(url, urls, init, type, telegram);

				if (type != typer) {
					adapter.log.debug("telegram " + type + " not found");
				}
				else {

					try {
						let resp = JSON.parse(response).response;
						if (resp == "" || resp == "<empty>") switchTimes[i].polling = false;
					} catch (e) { }


					if (switchTimes[i].polling) {
						try {
							r = JSON.parse(response).data;
							//adapter.log.info("r: "+r);
							if (r == "<empty>" || r == "") switchTimes[i].polling = false;
						}
						catch (error) { adapter.log.error("catch telegram"); switchTimes[i].polling = false; }
					}

					let d;
					try { d = r.split(" "); } catch (e) { }

					if (switchTimes[i].polling) {

						let wb = "";

						let own = {
							"state": switchTimes[i].state,
							"src": switchTimes[i].src,
							"type": type,
							"offset": "00",
							"bytes": "FF",
							"polling": true,
							"writable": true,
							"state_type": "switchPrograms"
						};

						try { read_switchPrograms(own, d); }
						catch (error) { adapter.log.warn("no poll response for extended entity telegram " + switchTimes[i].state); }

					}
				}
			}
		}
	} catch (e) { }


	const t2 = new Date().getTime();
	const t3 = (t2 - t1) / 1000;

	if (adapter.config.statistics) {
		await adapter.setObjectNotExistsAsync("statistics.ems-own-read", {
			type: "state",
			common: { type: "number", name: "ems read time for own states polling", unit: "seconds", role: "value", read: true, write: true }, native: {}
		});
		adapter.setStateAsync("statistics.ems-own-read", { ack: true, val: t3 });
	}
}




async function resp(url, urls, init, type, telegram) {
	let r, typer, offsetr;

	try {
		let loops = 5;
		if (init) loops = 10;
		for (let ii = 0; ii < loops; ii++) {
			await adapter.delay(1000);
			try { response = await ems_get(url); } catch (ee) { adapter.log.error(ee + " " + url); }
			typer = "", offsetr = "";
			try { typer = type_to_raw(JSON.parse(response).type); } catch (eee) { typer = ""; }
			try { offsetr = response.offset; } catch (eee) { offsetr = ""; }
			try { r = JSON.parse(response).data; } catch (eee) { r = ""; }
			if (r == undefined) r = "";
			if (type == typer && r != "<empty>" && r != "") {
				adapter.log.debug(ii + " - " + type + "/" + typer + " : " + response);
				break;
			}
			else adapter.log.debug(ii + " - " + type + "/" + typer + " : " + response);
			//else if (ii == loops - 1) adapter.log.debug(ii + " - " + type + "/" + typer + " : " + response);
			//if (ii == 5 || ii == 20 || ii == 30) { await ems_put(urls, telegram); }
		}
	} catch (e) { adapter.log.error(e); }

	return [typer, offsetr, response];
}



function type_to_raw(type) {
	let typer = type;
	if (type.length > 2) {
		hexValue = parseInt(type, 16);
		hexValue = hexValue - 0x0100;
		typer = hexValue.toString(16).toUpperCase();
		if (typer.length == 3) typer = "0" + typer;
	}
	return typer;
}


async function ems_get(url) {
	const options = { url: url, charset: "utf-8", method: "GET", status: [200], timeout: 5000, port: 80 };
	try {
		let b = "*";
		b = await axios(options);
		
		if (b.data == {}) throw new Error("Request failed " + url);
		const data = JSON.stringify(b.data);
		if (b.status == 200) return (data);
		else throw new Error(`Request failed with status ${b.status}`);
	} catch (e) { throw new Error(`ems-get request failed`); }
}



async function ems_put(url, value) {
	try {
		const data = { "value": value };
		const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + ems_token };
		const options = { "url": url, "headers": headers, "data": data, "method": "POST" };
		let r = (await axios(options));
		//adapter.log.info(r.status);
		await adapter.delay(5000);
		r = (await axios(options));
		//adapter.log.info(r.status);
		
		return;
	} catch (e) {
		adapter.log.error("post: " + url + "  " + e);
	}
}


// Own states processing ---------------------------------------------------------------------------------------------------------------------------------

async function read_holidayModes(devices, d) {
	if (d.length >= 18) {
		let wb = "", value;
		const j1 = parseInt(d[0], 16) + 2000;
		const m1 = parseInt(d[1], 16);
		const d1 = parseInt(d[2], 16);
		const j2 = parseInt(d[3], 16) + 2000;
		const m2 = parseInt(d[4], 16);
		const d2 = parseInt(d[5], 16);

		wb = j1 + "-" + ("00" + m1).slice(-2) + "-" + ("00" + d1).slice(-2) + "/";
		wb += j2 + "-" + ("00" + m2).slice(-2) + "-" + ("00" + d2).slice(-2);

		const own = {};
		own.src = devices.src;
		own.type = devices.type;
		own.state_type = "holidayPeriod";
		own.bytes = 6;
		own.bit = "";
		own.uom = "";
		own.multi = "";
		own.signed = false;
		own.writable = devices.writable;
		own.offset = "00";
		own.states = "";
		write_ownstate(devices.state + state_suffix + ".startStop", wb, own);

		own.bytes = 1;
		own.offset = "06";
		own.state_type = "mixed";
		own.min = 1;
		own.max = 4;
		value = parseInt(d[6], 16);
		own.states = { "1": "AUTO_SAT", "2": "FIX_TEMP", "3": "OFF", "4": "ECO" };
		if (value > 0 && value < 5) write_ownstate(devices.state + state_suffix + ".hcMode", value, own);

		own.bytes = 1;
		own.offset = "08";
		own.state_type = "mixed";
		own.states = { "2": "OFF", "3": "TD_OFF" };
		own.min = 2;
		own.max = 3;
		value = parseInt(d[8], 16);
		if (value > 1 && value < 4) write_ownstate(devices.state + state_suffix + ".dhwMode", value, own);
		adapter.log.debug(devices.state + state_suffix + ".dhwMode : "+ value);

		own.bytes = 10;
		own.offset = "09";
		own.state_type = "holidayModes";
		const assignedTo = [];

		if (j1 > 2020) {
			if (d[9] == "FF") assignedTo.push("hc1");
			if (d[10] == "FF") assignedTo.push("hc2");
			if (d[11] == "FF") assignedTo.push("hc3");
			if (d[12] == "FF") assignedTo.push("hc4");
			if (d[17] == "FF") assignedTo.push("dhw1");
			if (d[18] == "FF") assignedTo.push("dhw2");
		}
		own.states = "";
		write_ownstate(devices.state + state_suffix + ".assignedTo", JSON.stringify(assignedTo), own);
	}
}


async function read_switchPrograms(own_states, d) {
	try {
		//adapter.log.info(d.length+"  "+d);
		if (d.length > 80) {
			// Multiple days switchProgram long telegram
			const spa = telegram_to_switchProgram(d);
			write_ownstate(own_states.state + state_suffix, JSON.stringify(spa), own_states);
		}
	} catch (e) { }
}


function telegram_to_switchProgram(tt) {

	/*	per day there is a maximum of 6 switch points. Each switchpoint is represented by 2 bytes. Therefore each day is 12 bytes:

		Mo offset 0  0x00
		Tu offset 12 0x0C
		We offset 24 0x18
		Th offset 36 0x24
		Fr offset 48 0x30
		Sa offset 60 0x3C
		Su offset 72 0x48

		Telegram structure of one day looks like this with 2 active switchpoints:
		P1 P2 P3 P4 P5 P6 ...........................P12
		14 01 58 03 FF 03 FF 03 FF 03 FF 03

		P1: time of 1st sp: unit 15 minutes --> 0x14 = 20 *15 = 300 minutes = 05:00 hours
		P2: temperatureLevel : hc levels 03: eco 01:comfort2 -- ww levels 03:low 02:high
	*/
	const spa = [];
	for (let d = 0; d < 7; d++) {
		for (let ii = 0; ii < 6; ii++) {
			const i1 = d * 12 + ii * 2;
			const i2 = i1 + 1;
			if (tt[i2] != "FF") {
				const min = parseInt(tt[i2], 16) * 15;
				let h = parseInt(min / 60);
				let m = min - (h * 60);
				let t;
				if (m == 0) t = Math.round(min / 60) + ":00";
				else t = parseInt((min - m) / 60) + ":" + m;
				const sp = {
					"dayOfWeek": day(d),
					"setpoint": setpoint(tt[i1], "in"),
					"time": t
				};
				spa.push(sp);
			}
		}
	}
	return spa;
}


function switchProgram_to_telegram(spa) {
	let data = "", c = 0, h = 0, m = 0;
	try {
		for (let i = 0; i < spa.length; i++) {
			data += setpoint(spa[i].setpoint, "out") + " ";

			if (spa[i].time.length == 4) {
				h = parseInt(spa[i].time.substring(0, 1));
				m = parseInt(spa[i].time.substring(2, 4));
			}
			if (spa[i].time.length == 5) {
				h = parseInt(spa[i].time.substring(0, 2));
				m = parseInt(spa[i].time.substring(3, 5));
			}
			// @ts-ignore

			if (h < 0) h = 0;
			if (h >= 24) { h = 24; m = 0; }
			if (m > 45) m = 45;

			const hex = ((h * 60 + m) / 15).toString(16);
			data += hex + " ";
			c = c + 1;

			if (i < spa.length - 1) {
				if (spa[i].dayOfWeek != spa[i + 1].dayOfWeek && c < 6) {
					for (let ii = 0; ii < 6 - c; ii++) { data += "0A FF "; }
					c = 0;
				}
			}
			else for (let ii = 0; ii < 6 - c; ii++) { data += "0A FF "; }
		}
	} catch (e) {
		adapter.log.error("switchProgram has wrong definition");
		adapter.log.error(e + ":" + data);
		data = "";
	}
	data = data.toUpperCase();
	return data;
}



function setpoint(hex, dir) {
	switch (hex) {
		case "FF": return ("on");
		case "03": return ("comfort");
		case "02": return ("high");
		case "01": return ("eco/low");
		case "00": return ("off");

		case "on": return ("FF");
		case "off": return ("00");
		case "comfort": return ("03");
		case "high": return ("02");
		case "eco/low": return ("01");
	}
	if (dir == "out") {
		let r = Number(hex) * 2;
		let h = r.toString(16).toUpperCase();
		return h;
	}
	if (dir == "in") return (Number("0x" + hex) / 2);
}


function day(d) {
	let dd = "";
	switch (d) {
		case 0: dd = "Mo"; break;
		case 1: dd = "Tu"; break;
		case 2: dd = "We"; break;
		case 3: dd = "Th"; break;
		case 4: dd = "Fr"; break;
		case 5: dd = "Sa"; break;
		case 6: dd = "Su"; break;
	}
	return dd;
}



function hexToSignedInt(hex) {
	if (hex.length % 2 != 0) {
		hex = "0" + hex;
	}
	let num = parseInt(hex, 16);
	const maxVal = Math.pow(2, hex.length / 2 * 8);
	if (num > maxVal / 2 - 1) {
		num = num - maxVal;
	}
	return num;
}


// own state write  --------------------------------------------------------------------------------------------------------------------------

async function write_ownstate(statename, value, own) {
	if (unloaded) return;

	const array = statename.split(".");
	if (adapter.config.km200_structure) {

		if (array[0] == "thermostat" && array[1] == "ww") {
			array[0] = "dhwCircuits";
			array[1] = "dhw1";
		}
		if (array[0] == "thermostat" && array[1] == "dhw1") {
			array[0] = "dhwCircuits";
		}

		if (array[0] == "thermostat" && array[1].substring(0, 2) == "ww") { array[0] = "dhwCircuits"; }

		if (array[0] == "thermostat") array[0] = "heatingCircuits";

		if (array[0] == "mixer") array[0] = "heatingCircuits";
		if (array[0] == "solar") array[0] = "solarCircuits.sc1";
		if (array[0] == "boiler") {
			array[0] = "heatSources.hs1";
			if (array[1].substring(0, 2) == "ww" || array[1].substring(0, 2) == "wW") {
				array[0] = "dhwCircuits";
				array[1] = "dhw1";
			}
		}
	}
	if (!adapter.config.km200_structure) {
		if (array[0] == "thermostat" && array[1] == "ww") {
			array[1] = "dhw1";
		}
	}

	statename = "";
	for (let i = 0; i < array.length; i++) {
		if (array[i] != "") statename += array[i];
		if (i < array.length - 1) statename += ".";
	}
	//if (array[1] == "holidayModes") adapter.log.debug(statename + " " + value + " " + JSON.stringify(own));


	const obj = { _id: statename, type: "state", common: {}, native: {} };
	obj.common.id = statename;
	obj.common.type = "mixed";

	if (own.state_type == "number" && own.enum == "") {
		obj.common.type = "number";
		if (typeof (value) != "number") value = Number(value);
		if (own.min !== "") obj.common.min = Number(own.min);
		if (own.max !== "") obj.common.max = Number(own.max);
	}

	if (own.state_type == "string") obj.common.type = own.state_type;
	if (own.state_type == "hex") obj.common.type = "string";
	if (own.state_type == "switchPrograms") obj.common.type = "json";
	if (own.state_type == "holidayModes") obj.common.type = "string";
	if (own.state_type == "holidayPeriod") obj.common.type = "string";


	if (typeof own.states == "object") own.states = JSON.stringify(own.states);

	if (own.states != "" && typeof own.states == "string") {
		own.states = own.states.replace("{",""); own.states = own.states.replace("}","");
		try { obj.common.states = JSON.parse("{" + own.states + "}"); obj.common.type = "mixed"; }
		catch (e) { adapter.log.error("own.states:" + own.states); }
	}

	obj.common.unit = own.uom;
	obj.common.read = true;
	obj.common.write = false;
	if (own.writable === true) obj.common.write = true;
	obj.common.role = "value";
	if (own.state_type == "switchPrograms") obj.common.role = "switchPrograms";
	if (own.state_type == "holidayModes") obj.common.role = "holidayModes";
	if (own.state_type == "holidayPeriod") obj.common.role = "holidayModes";

	obj.native.ems_command = "own";
	obj.native.ems_api = "raw";
	obj.native.ems_src = own.src;
	obj.native.ems_type = own.type;
	obj.native.ems_offset = own.offset;
	obj.native.ems_bit = own.bit;
	obj.native.ems_bytes = own.bytes;
	obj.native.ems_signed = own.signed;
	obj.native.ems_multi = own.multi;
	obj.native.ems_state_type = own.state_type;

	obj.common.name = "ems-own: " + statename;

	// @ts-ignore
	await adapter.setObjectNotExistsAsync(statename, obj);
	await adapter.setStateAsync(statename, { ack: true, val: value });
}

// own state change  --------------------------------------------------------------------------------------------------------------------------

const state_change = async function (id, state, obj) {
	if (unloaded) return;
	let value = state.val;

	try {

		if (obj.common.role == "value" && obj.native.ems_state_type == "number") {
			let vc = "";
			const multi = obj.native.ems_multi;
			const bytes = obj.native.ems_bytes;

			if (multi != "") {
				if (value == -1 && bytes == 1) vc = "FF";
				else {
					value = value * multi;
					vc = value.toString(16);
				}
			} else vc = value.toString(16);

			if (vc.length == 1 || vc.length == 3) vc = "0" + vc;
			let type = obj.native.ems_type;

			if (type.substring(0, 2) == "0x") type = type.substring(2);
			let telegram = busid + " " + obj.native.ems_src + " ";

			if (type.length == 2) {
				telegram += type + " " + obj.native.ems_offset + " " + vc;
			}
			if (type.length == 3) {
				telegram += "FF " + obj.native.ems_offset + " 0" + type.substring(0, 1);
				telegram += " " + type.substring(1, 2) + " " + vc;
			}
			if (type.length == 4) {
				telegram += "FF " + obj.native.ems_offset + " " + type.substring(0, 2);
				telegram += " " + type.substring(2, 4) + " " + vc;
			}
			post(id, telegram);
		}

		if (obj.common.role == "value" && obj.native.ems_state_type == "hex") {
			//const bytes = obj.native.ems_bytes;
			let type = obj.native.ems_type;

			if (type.substring(0, 2) == "0x") type = type.substring(2);
			let telegram = busid + " " + obj.native.ems_src + " ";

			if (type.length == 2) {
				telegram += type + " " + obj.native.ems_offset + " " + value;
			}
			if (type.length == 3) {
				telegram += "FF " + obj.native.ems_offset + " 0" + type.substring(0, 1);
				telegram += " " + type.substring(1, 2) + " " + value;
			}
			if (type.length == 4) {
				telegram += "FF " + obj.native.ems_offset + " " + type.substring(0, 2);
				telegram += " " + type.substring(2, 4) + " " + value;
			}

			post(id, telegram);
		}


		if (obj.common.role == "switchPrograms") {

			const spa = JSON.parse(value);
			const t = switchProgram_to_telegram(spa);
			if (t != "") {
				//adapter.log.debug(t);

				const tt = t.split(" ");

				let type = obj.native.ems_type;
				const src = obj.native.ems_src;
				if (type.substring(0, 2) == "0x") type = type.substring(2);
				if (type.length == 3) type = "0" + type;

				let offset = "00";
				let telegram = "";

				for (let i = 0; i < 7; i++) {
					offset = (i * 12).toString(16).toUpperCase();
					if (offset.length == 1) offset = "0" + offset;
					telegram = busid + " " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4);

					for (let ii = 0; ii < 12; ii++) {
						telegram += " " + tt[(i * 12) + ii];
					}
					post(id, telegram);
				}
			}
		}


		if (obj.common.role == "holidayModes") {
			let type = obj.native.ems_type;
			const src = obj.native.ems_src;
			if (type.substring(0, 2) == "0x") type = type.substring(2);
			if (type.length == 3) type = "0" + type;

			if (obj.native.ems_state_type == "holidayPeriod") {

				value = value.trim();
				if (value.length < 21) {  // reset holiday period
					value = "2009-01-01/2009-01-01";
					await adapter.setStateAsync(obj.common.id, { ack: true, val: value });
				}
				try {
					const offset = "00";
					let telegram = busid + " " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4) + " ";
					let yy = parseInt(value.substr(2, 2)).toString(16).toUpperCase();
					let mm = ("00" + parseInt(value.substr(5, 2)).toString(16)).slice(-2).toUpperCase();
					let dd = ("00" + parseInt(value.substr(8, 2)).toString(16)).slice(-2).toUpperCase();
					telegram += yy + " " + mm + " " + dd + " ";

					yy = parseInt(value.substr(13, 2)).toString(16).toUpperCase();
					mm = ("00" + parseInt(value.substr(16, 2)).toString(16)).slice(-2).toUpperCase();
					dd = ("00" + parseInt(value.substr(19, 2)).toString(16)).slice(-2).toUpperCase();
					telegram += yy + " " + mm + " " + dd;
					post(id, telegram);
				} catch (e) { adapter.log.error("wrong holiday period"); }
			}
			else {
				const offset = "09";
				let telegram = busid + " " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4) + " ";
				let hex = "00"; if (value.search("hc1") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc2") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc3") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc4") > -1) hex = "FF"; telegram += hex + " ";
				telegram += "00 00 00 00 ";
				hex = "00"; if (value.search("dhw1") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("dhw2") > -1) hex = "FF"; telegram += hex;
				post(id, telegram);
			}
		}
	} catch (e) { }
};


async function post(id, telegram) {
	const url = emsesp + "/api/system/send ";
	adapter.log.debug("write change to ems-esp raw telegram: " + id + "  -  " + telegram);

	try {
		await ems_put(url, telegram);
		//adapter.log.info(response);
	}
	catch (error) { adapter.log.error("error write change ems-esp raw error"); }

}

function init_switchTimes(src) {
	const switchTimes = [
		{
			"state": "thermostat.hc1.switchPrograms.A",
			"src": src,
			"typei": "01B9",
			"offseti": "13",
			"type1": "01C3",
			"type2": "0583",
			"polling": true
		},
		{
			"state": "thermostat.hc2.switchPrograms.A",
			"src": src,
			"typei": "01BA",
			"offseti": "13",
			"type1": "01C4",
			"type2": "0584",
			"polling": true
		},
		{
			"state": "thermostat.hc3.switchPrograms.A",
			"src": src,
			"typei": "01BB",
			"offseti": "13",
			"type1": "01C5",
			"type2": "0585",
			"polling": true
		},
		{
			"state": "thermostat.hc4.switchPrograms.A",
			"src": src,
			"typei": "01BC",
			"offseti": "13",
			"type1": "01C6",
			"type2": "0586",
			"polling": true
		},
		{
			"state": "thermostat.hc1.switchPrograms.B",
			"src": src,
			"typei": "01B9",
			"offseti": "13",
			"type1": "0349",
			"type2": "058D",
			"polling": true
		},
		{
			"state": "thermostat.hc2.switchPrograms.B",
			"src": src,
			"typei": "01BA",
			"offseti": "13",
			"type1": "034A",
			"type2": "058E",
			"polling": true
		},
		{
			"state": "thermostat.hc3.switchPrograms.B",
			"src": src,
			"typei": "01BB",
			"offseti": "13",
			"type1": "034B",
			"type2": "0590",
			"polling": true
		},
		{
			"state": "thermostat.hc4.switchPrograms.B",
			"src": src,
			"typei": "01BC",
			"offseti": "13",
			"type1": "034C",
			"type2": "0591",
			"polling": true
		},
		{
			"state": "thermostat.dhw1.switchPrograms.A",
			"src": src,
			"typei": "",
			"offseti": "",
			"type1": "01FF",
			"type2": "",
			"polling": true
		},
		{
			"state": "thermostat.dhw1.switchPrograms.cp",
			"src": src,
			"typei": "",
			"offseti": "",
			"type1": "0209",
			"type2": "",
			"polling": true
		}

	];
	return (switchTimes);
}


function init_own_states(src) {
	const devices = [
		{
			"state": "system.holidayModes.hm1",
			"src": src,
			"type": "0169",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "12",
			"multi": "",
			"signed": false,
			"state_type": "holidayModes",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "system.holidayModes.hm2",
			"src": src,
			"type": "016A",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "12",
			"multi": "",
			"signed": false,
			"state_type": "holidayModes",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "system.holidayModes.hm3",
			"src": src,
			"type": "016B",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "12",
			"multi": "",
			"signed": false,
			"state_type": "holidayModes",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "system.holidayModes.hm4",
			"src": src,
			"type": "016C",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "12",
			"multi": "",
			"signed": false,
			"state_type": "holidayModes",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "system.holidayModes.hm5",
			"src": src,
			"type": "016D",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "12",
			"multi": "",
			"signed": false,
			"state_type": "holidayModes",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		}
		
	];
	return devices;
}

// @ts-ignore
const unload = function (u) { unloaded = u; };
module.exports = { init, unload, state_change };