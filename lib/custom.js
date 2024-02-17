/* eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
const {default: axios} = require("axios");

let emsesp, ems_token = "";
const own_states = [];
let unloaded = false;

let adapter;
let state_suffix = "";

const init = async function (a, i) {
	adapter = a;
	let devices = adapter.config.devices;
	if (devices.length == 0) devices = init_own_states();

	try {
		for (let i = 0; i < devices.length; i++) {
			if (devices[i].state !== "" && devices[i].type !== "" && devices[i].offset !== "")
				if (devices[i].states != "") {
					try{devices[i].states = JSON.parse(devices[i].states);}
					catch(e) {adapter.log.error(devices[i].state + " JSON.parse error states-content: "+devices[i].states);}
				}
			own_states.push(devices[i]);
		}
	} catch (error) { adapter.log.error("error reading custom states"); }

	state_suffix = "";
	if (adapter.config.km200_active && adapter.config.km200_structure) state_suffix = "_";

	emsesp = adapter.config.emsesp_ip;
	if (emsesp.substr(0, 3) == "***") emsesp = emsesp.substr(3);
	if (emsesp.substr(0, 7) != "http://") emsesp = "http://" + emsesp;

	ems_token = adapter.config.ems_token.trim();

	await ems_poll();
	let count = 0;
	for (let i = 0; i < own_states.length; i++) {
		if (own_states[i].polling) {
			//state = own_states[i].state;
			adapter.log.info("extended entity found:" + own_states[i].state);
			count += 1;
		}
	}

	if (adapter.config.devices.length == 0 && count > 0) {
		const inst = "system.adapter." + adapter.namespace;
		const obj = await adapter.getForeignObjectAsync(inst);
		obj.native.devices = own_states;
		await adapter.setForeignObjectAsync(inst, obj);
		adapter.log.info("ems: extended entities configuration stored .... instance will restart");
	}

	if (count > 0) {
		adapter.log.info("extended entity poll for " + count + " states every 2 minutes");
		i.poll = setInterval(function () { ems_poll(); }, 120000); // 2 Minutes
	}
};


async function ems_poll() {
	const t1 = new Date().getTime();
	for (let i = 0; i < own_states.length; i++) {
		if (own_states[i].polling && !unloaded) {
			let telegram = "0B ";

			let hexValue = parseInt(own_states[i].src, 16);
			hexValue = hexValue + 0x80;
			const dest = hexValue.toString(16).toUpperCase();
			telegram += dest + " ";

			if (own_states[i].type.length > 2) {
				telegram += "FF ";
				telegram += own_states[i].offset + " ";
				telegram += own_states[i].bytes + " ";
				telegram += own_states[i].type.substr(0, 2) + " ";
				telegram += own_states[i].type.substr(2, 2) + " ";
			} else {
				telegram += own_states[i].type + " ";
				telegram += own_states[i].offset + " ";
				telegram += own_states[i].bytes;
			}

			let url = emsesp + "/api/system/send ";
			try { await ems_put(url, telegram); }
			catch (e) {
				//adapter.log.error("ems-esp polling: " + e);
				own_states[i].polling = false;
			}

			//if (own_states[i].polling) {
			let response = "";
			url = emsesp + "/api/system/response ";
			let r;
			const type = own_states[i].type;
			const offset = own_states[i].offset;
			try {
				for (let ii = 0; ii < 20; ii++) {
					await sleep(adapter.config.ems_poll_wait);
					response = await ems_get(url);
					let typer = "";
					let offsetr = "00";
					try {
						typer = type_to_raw(JSON.parse(response).type);
						offsetr = JSON.parse(response).offset;
					} catch (e) { typer = ""; offsetr = "00"; }
					if (type == typer && offset == offsetr) {
						//adapter.log.info(ii + ": " + type + " " + typer);
						break;
					}
				}
			} catch (e) { }

			try { if (JSON.parse(response).response == "") own_states[i].polling = false; } catch (e) { }
			//}

			if (own_states[i].polling) {
				try {
					r = JSON.parse(response).data;
					if (r == "<empty>") own_states[i].polling = false;
				}
				catch (error) { own_states[i].polling = false; }
			}
			let d;
			try {d = r.split(" ");} catch(e) {}

			if (own_states[i].polling) {

				const bytes = own_states[i].bytes;
				const bit = own_states[i].bit;
				let wb = "";

				switch (own_states[i].state_type) {
					case "switchPrograms":
						try {read_switchPrograms(own_states[i], d);}
						catch (error) { adapter.log.warn("no poll response for extended entity telegram " + own_states[i].state); }
						break;

					case "holidayModes":
						try {read_holidayModes(own_states[i], d);}
						catch (error) { adapter.log.warn("no poll response for extended entity telegram " + own_states[i].state); }
						break;

					case "number":
						if (own_states[i].bit == "") {
							for (let ii = 0; ii < bytes; ii++) {wb += d[ii];}
							const s = own_states[i].signed;
							let w = parseInt(wb, 16);
							if (s == true) w = hexToSignedInt(wb);
							let m = 1;
							if (own_states[i].multi !== "") m = own_states[i].multi;
							if (w == -1 && bytes == 1) m = 1;
							w = w / m;
							write_ownstate(own_states[i].state, w, own_states[i]);
						}
						else {
							let wbb = "";
							wb = d[0];
							wbb = parseInt(wb, 16).toString(2).padStart(8, "0");
							const w = parseInt(wbb.substr(7 - bit, 1));
							write_ownstate(own_states[i].state, w, own_states[i]);
						}
						break;

					case "string":
						for (let ii = 0; ii < bytes; ii++) {wb += d[ii];}
						write_ownstate(own_states[i].state, wb, own_states[i]);
						break;

					case "hex":
						for (let ii = 0; ii < bytes; ii++) {wb += d[ii] + " ";}
						write_ownstate(own_states[i].state, wb, own_states[i]);
						break;

					default:
						try {
							adapter.log.debug(own_states[i].state+ " " + own_states[i].state_type + " " + r);
						}
						catch (error) { adapter.log.warn("no poll response for extended entity telegram " + own_states[i].state); }
						break;
				}
			}
		}
	}
	const t2 = new Date().getTime();
	const t3 = (t2-t1) / 1000;

	if (adapter.config.statistics) {
		await adapter.setObjectNotExistsAsync("statistics.ems-own-read",{type: "state",
			common: {type: "number", name: "ems read time for own states polling", unit: "seconds", role: "value", read: true, write: true}, native: {}});
		adapter.setStateAsync("statistics.ems-own-read", {ack: true, val: t3});
	}
}



function type_to_raw(type) {
	let typer = type;
	if (type.length > 2) {
		let hexValue = parseInt(type, 16);
		hexValue = hexValue - 0x0100;
		typer = hexValue.toString(16).toUpperCase();
		if (typer.length == 3) typer = "0" + typer;
	}
	return typer;
}


async function ems_get(url)  {
	const options = {url: url, charset: "utf-8", method: "GET", status: [200], timeout: 5000, port: 80 };
	try {
		const b = await axios(options);
		if (b.data.message != undefined || b.data == {}) throw new Error("Request failed");
		const data = JSON.stringify(b.data);
		if (b.status == 200) return(data);
		else throw new Error(`Request failed with status ${b.status}`);
	} catch(e) {throw new Error(`ems-get request failed`);}
}



async function ems_put(url, value) {
	try {
		const data = {"value": value};
		const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
		const options = {"url": url, "headers": headers, "data": data, "method": "POST" };
		const r = (await axios(options)).data.message;
		return r;
	} catch(e) {
	//	adapter.log.error("post: "+ url + "  " +e);
	}
}


// Own states processing ---------------------------------------------------------------------------------------------------------------------------------

async function read_holidayModes(own_states, d) {
	if (d.length >= 18) {
		let wb = "",value;
		const j1 = parseInt(d[0], 16) + 2000;
		const m1 = parseInt(d[1], 16);
		const d1 = parseInt(d[2], 16);
		const j2 = parseInt(d[3], 16) + 2000;
		const m2 = parseInt(d[4], 16);
		const d2 = parseInt(d[5], 16);

		wb = j1 + "-" + ("00" + m1).slice(-2) + "-" + ("00" + d1).slice(-2) + "/";
		wb += j2 + "-" + ("00" + m2).slice(-2) + "-" + ("00" + d2).slice(-2);

		const own = {};
		own.src = own_states.src;
		own.type = own_states.type;
		own.state_type = "holidayPeriod";
		own.bytes = 6;
		own.bit = "";
		own.uom = "";
		own.multi = "";
		own.signed = false;
		own.writable = own_states.writable;
		own.offset = "00";
		own.states = "";
		write_ownstate(own_states.state + state_suffix + ".startStop", wb, own);

		own.bytes = 1;
		own.offset = "06";
		own.state_type = "number";
		own.min = 1;
		own.max = 4;
		value = parseInt(d[6], 16);
		own.states = { "1": "AUTO_SAT", "2": "FIX_TEMP", "3": "OFF", "4": "ECO" };
		if (value > 0 && value < 5 )write_ownstate(own_states.state + state_suffix + ".hcMode", value, own);

		own.bytes = 1;
		own.offset = "08";
		own.states = { "2": "OFF", "3": "TD_OFF" };
		own.min = 2;
		own.max = 3;
		value = parseInt(d[8], 16);
		if (value > 1 && value < 4 ) write_ownstate(own_states.state + state_suffix + ".dhwMode", value, own);

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
		write_ownstate(own_states.state + state_suffix + ".assignedTo", JSON.stringify(assignedTo), own);
	}
}


async function read_switchPrograms(own_states, d) {
	if (d.length > 80) {
		// Multiple days switchProgram long telegram
		const spa = telegram_to_switchProgram(d);
		write_ownstate(own_states.state + state_suffix, JSON.stringify(spa), own_states);
	}
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
				const m = (Math.round(min / 60) * 60 - min);
				let t;
				if (m == 0) t = Math.round(min / 60) + ":00";
				else t = Math.round((min - m) / 60) + ":" + m;
				const sp = {
					"dayOfWeek": day(d),
					"setpoint": setpoint(tt[i1]),
					"time": t
				};
				spa.push(sp);
			}
		}
	}
	return spa;
}


function switchProgram_to_telegram(spa) {
	let data = "",c = 0, h = 0, m = 0;
	try {
		for (let i = 0; i < spa.length; i++) {
			data += setpoint(spa[i].setpoint) + " ";

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
			if (h >= 24) {h = 24;m = 0;}
			if (m > 45) m= 45;

			const hex = ((h * 60 + m) / 15).toString(16);
			data += hex + " ";
			c = c + 1;

			if (i < spa.length - 1) {
				if (spa[i].dayOfWeek != spa[i + 1].dayOfWeek && c < 6) {
					for (let ii = 0; ii < 6 - c; ii++) { data += "03 FF "; }
					c = 0;
				}
			}
			else for (let ii = 0; ii < 6 - c; ii++) { data += "03 FF "; }
		}
	} catch (e) {
		adapter.log.error("switchProgram has wrong definition");
		adapter.log.error(e+":"+data);
		data= "";
	}
	return data;
}



function setpoint(hex) {
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
	return ("0x" + hex + " ?");
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

	if (adapter.config.km200_structure) {
		const array = statename.split(".");

		if (array[0] == "thermostat" && array[1] == "ww") {
			array[0] = "dhwCircuits";
			array[1] = "dhw1";
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
		statename = "";
		for (let i = 0; i < array.length; i++) {
			if (array[i] != "") statename += array[i];
			if (i < array.length - 1) statename += ".";
		}
		if (array[1] == "holidayModes") adapter.log.debug(statename + " " + value + " " + JSON.stringify(own));
	}

	const obj = { _id: statename, type: "state", common: {}, native: {} };
	obj.common.id = statename;
	obj.common.type = "mixed";
	if (own.state_type == "number") {
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

	if (own.states !== "") {try {obj.common.states = own.states;} catch(e) {adapter.log.error("own.states:" + own.states);}}

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
			let telegram = "0B " + obj.native.ems_src + " ";

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
			let telegram = "0B " + obj.native.ems_src + " ";

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
				adapter.log.debug(t);

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
					telegram = "0B " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4);

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
					let telegram = "0B " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4) + " ";
					let yy = parseInt(value.substr(2, 2)).toString(16).toUpperCase();
					let mm = ("00" + parseInt(value.substr(5, 2)).toString(16)).slice(-2).toUpperCase();
					let dd = ("00" + parseInt(value.substr(8, 2)).toString(16)).slice(-2).toUpperCase();
					telegram += yy + " " + mm + " " + dd + " ";

					yy = parseInt(value.substr(13, 2)).toString(16).toUpperCase();
					mm = ("00" + parseInt(value.substr(16, 2)).toString(16)).slice(-2).toUpperCase();
					dd = ("00" + parseInt(value.substr(19, 2)).toString(16)).slice(-2).toUpperCase();
					telegram += yy + " " + mm + " " + dd;
					post(id, telegram);
				} catch (e) {adapter.log.error("wrong holiday period");}
			}
			else {
				const offset = "09";
				let telegram = "0B " + src + " FF " + offset + " " + type.substring(0, 2) + " " + type.substring(2, 4) + " ";
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

function init_own_states() {

	const devices = [
		{
			"state": "thermostat.hc1.switchPrograms.A",
			"src": "10",
			"type": "01C3",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc1.switchPrograms.B",
			"src": "10",
			"type": "0349",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc2.switchPrograms.A",
			"src": "10",
			"type": "01C4",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc2.switchPrograms.B",
			"src": "10",
			"type": "034A",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc3.switchPrograms.A",
			"src": "10",
			"type": "01C5",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc3.switchPrograms.B",
			"src": "10",
			"type": "034B",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc4.switchPrograms.A",
			"src": "10",
			"type": "01C6",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.hc4.switchPrograms.B",
			"src": "10",
			"type": "034D",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.ww.switchPrograms.A",
			"src": "10",
			"type": "01FF",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "thermostat.ww.switchPrograms.cp",
			"src": "10",
			"type": "0209",
			"offset": "00",
			"polling": true,
			"bit": "",
			"bytes": "20",
			"multi": "",
			"signed": false,
			"state_type": "switchPrograms",
			"states": "",
			"min": "",
			"max": "",
			"uom": "",
			"writable": true
		},
		{
			"state": "system.holidayModes.hm1",
			"src": "10",
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
			"src": "10",
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
			"src": "10",
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
			"src": "10",
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
			"src": "10",
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
async function sleep(ms) { return new Promise(resolve => { setTimeout(() => !unloaded && resolve(), ms); }); }
const unload = function (u) { unloaded = u; };

module.exports = { init, unload, state_change };