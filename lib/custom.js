/* eslint-disable no-mixed-spaces-and-tabs */
const request = require("request");

let emsesp,ems_token ="",ems_poll_wait = 6000;

let own_states = [];

let unloaded = false;

const separator = " ";
const output = true;
let active = false;
let active_old = false;
let data_long = "";
let data_pos = 0;
let adapter;
let state_suffix = "";

const init = async function(a,o,i) {
	adapter = a;
	own_states = o;

	if (adapter.config.km200_active && adapter.config.km200_structure) state_suffix = "_";

	emsesp = adapter.config.emsesp_ip ;
	if (emsesp.substr(0,3) == "***") emsesp = emsesp.substr(3);
	if (emsesp.substr(0,7) != "http://") emsesp = "http://" + emsesp;

	ems_poll_wait = adapter.config.ems_poll_wait;
	ems_token = adapter.config.ems_token.trim();

	await ems_poll();
	let count = 0;
	for (let i=0;i < own_states.length;i++){
		if (own_states[i].polling) {
			adapter.log.info("custom entity found:" + own_states[i].state);
			count += 1;
		}
	}
    if (count > 0) adapter.log.info("custom entity poll for " + count + " states every 5 minutes");

	i.poll = setInterval(function() {ems_poll();}, 300000); // 5 Minutes

};


async function ems_poll() {
	for (let i=0;i < own_states.length;i++){
		if (own_states[i].polling && !unloaded) {
			let telegram = "0B ";
			if (own_states[i].src == "10") telegram += "90 ";
			if (own_states[i].src == "08") telegram += "88 ";

			if (own_states[i].type.length > 2) {
				telegram += "FF ";
				telegram += own_states[i].offset + " ";
				telegram += own_states[i].bytes + " ";
				telegram += own_states[i].type.substr(0,2) + " ";
				telegram += own_states[i].type.substr(2,2) + " ";
			} else {
				telegram += own_states[i].type + " ";
				telegram += own_states[i].offset + " ";
				telegram += own_states[i].bytes ;
			}

			let url = emsesp + "/api/system/send " ;
			try {await ems_put(url,telegram);}
			catch (e) {}
			let response = "";
			await sleep(ems_poll_wait);
			url = emsesp + "/api/system/response " ;
			let r;
			response = await ems_get(url);
			try {if (JSON.parse(response).response == "") own_states[i].polling = false;} catch(e) {}

			if (own_states[i].polling) {
				try {
					r = JSON.parse(response).data;
					if (r == "<empty>") own_states[i].polling = false;
				}
				catch (error) {own_states[i].polling = false;}
			}


			if (own_states[i].polling && own_states[i].state_type == "switchPrograms") {
				try {
					const d = r.split(" ");
					read_switchPrograms(own_states[i],d);
				}
				catch (error) {adapter.log.warn("no poll response for custom telegram " + own_states[i].state);}
			}

			if (own_states[i].polling && own_states[i].state_type == "holidayModes") {
				try {
					const d = r.split(" ");
					//adapter.log.info("response " + own_states[i].state + ":" + d);
					read_holidayModes(own_states[i],d);
				}
				catch (error) {adapter.log.warn("no poll response for custom telegram " + own_states[i].state);}
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
});
}

async function ems_put(url,value) {return new Promise(function(resolve,reject) {
	const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
	const body =JSON.stringify({"value": value});

	request.post({url, headers: headers, body}, function(error,response) {
		try {
			const resp= JSON.parse(response.body).message;
			if (response.statusCode == 200) {resolve (resp);}
			else return reject (response.statusCode + ":" + resp);
		} catch(e) {reject(e);}
	});
});
}


// Own states processing ---------------------------------------------------------------------------------------------------------------------------------

async function read_holidayModes(own_states,d) {
	if (d.length == 18) {
		let wb = "";

		const j1 = parseInt(d[0],16) + 2000;
		const m1 = parseInt(d[1],16);
		const d1 = parseInt(d[2],16);

		const j2 = parseInt(d[3],16) + 2000;
		const m2 = parseInt(d[4],16);
		const d2 = parseInt(d[5],16);
		wb = j1 + "-" + ("00" + m1).slice(-2) + "-" + ("00" + d1).slice(-2) + "/";
		wb += j2 + "-" + ("00" + m2).slice(-2) + "-" +("00" + d2).slice(-2);

		const own = {};
		own.src = own_states.src;
		own.type = own_states.type;
		own.state_type ="holidayPeriod";
		own.bytes = 6;
		own.bit = "";
		own.uom = "";
		own.multi = "";
		own.signed = false;
		own.writable = own_states.writable;
		own.offset = "00";
		own.states = "";
		write_ownstate(own_states.state+".startStop",wb,own);

		own.bytes = 1;
		own.offset = "06";
		own.state_type ="number";
		own.min = 1;
		own.max = 4;
		own.states = {"1":"AUTO_SAT","2":"FIX_TEMP","3":"OFF","4":"ECO"};
		write_ownstate(own_states.state+".hcMode",parseInt(d[6],16),own);

		own.bytes = 1;
		own.offset = "08";
		own.states = {"2":"OFF","3":"TD_OFF"};
		own.min = 2;
		own.max = 3;
		write_ownstate(own_states.state+".dhwMode",parseInt(d[8],16),own);

		own.bytes = 10;
		own.offset = "09";
		own.state_type ="holidayModes";
		const assignedTo = [];

		if (j1 > 2020)  {
			if (d[9] == "FF") assignedTo.push("hc1");
			if (d[10] == "FF") assignedTo.push("hc2");
			if (d[11] == "FF") assignedTo.push("hc3");
			if (d[12] == "FF") assignedTo.push("hc4");
			if (d[17] == "FF") assignedTo.push("dhw1");
			if (d[18] == "FF") assignedTo.push("dhw2");
		}
		own.states ="";
		write_ownstate(own_states.state+".assignedTo",JSON.stringify(assignedTo),own);
	}
}


async function read_switchPrograms(own_states,d) {
	if (d.length > 80) {
		// Multiple days switchProgram long telegram
		const spa = telegram_to_switchProgram(d);
		write_ownstate(own_states.state,JSON.stringify(spa),own_states);
	}
}

function read_own_states(src,dest,offset,type,typer,tdata,own_states) {

	let index = -1;
	for (let i=0;i < own_states.length;i++){
		//if (typer == own_states[i].type && src == own_states[i].src && dest < "80") {
		if (typer == own_states[i].type && dest < "80") {
			index = i;
			try {
				if (index !== -1) {
					const o1 = parseInt(offset,16);
					const o2 = parseInt(own_states[index].offset,16);
					const d  = tdata.split(" ");

					if (o1 <= o2 && (o1+d.length) >= o2) {

						const bytes = own_states[index].bytes;
						const bit = own_states[index].bit;
						const state_type = own_states[index].state_type;

						if(state_type == "number" && bit == "") {
							let wb = "";
							for (let i = 0;i < bytes;i++) {
								wb += d[o2-o1+i];
							}
							const s = own_states[index].signed;
							let w = parseInt(wb,16);
							if (s == true) w = hexToSignedInt(wb);
							let m = 1;
							if ( own_states[index].multi !== "") m = own_states[index].multi;
							if (w == -1 && bytes == 1) m = 1;
							w = w / m;

							write_ownstate(own_states[index].state,w,own_states[index]);
						}

						if(state_type == "number" && bit != "") {
							let wb = "";
							let wbb ="";
							wb = d[o2-o1];
							wbb = parseInt(wb, 16).toString(2).padStart(8, "0");
							const w = parseInt(wbb.substr(7-bit,1));
							if (!unloaded) write_ownstate(own_states[index].state,w,own_states[index]);
						}


						if(own_states[index].state_type == "string") {
							let wb = "";
							for (let i = 0;i < bytes;i++) {
								wb += d[o2-o1+i];
							}
							write_ownstate(own_states[index].state,wb,own_states[index]);
						}

						if(own_states[index].state_type == "hex") {
							let wb = "";
							for (let i = 0;i < bytes;i++) {
								wb += d[o2-o1+i];
							}
							write_ownstate(own_states[index].state,wb,own_states[index]);
						}

						if(own_states[index].state_type == "holidayModes" && d.length > 17) {
							let wb = "";

							const j1 = parseInt(d[0],16) + 2000;
							const m1 = parseInt(d[1],16);
							const d1 = parseInt(d[2],16);

							const j2 = parseInt(d[3],16) + 2000;
							const m2 = parseInt(d[4],16);
							const d2 = parseInt(d[5],16);
							wb = j1 + "-" + ("00" + m1).slice(-2) + "-" + ("00" + d1).slice(-2) + "/";
							wb += j2 + "-" + ("00" + m2).slice(-2) + "-" +("00" + d2).slice(-2);

							const own = {};
							own.src = own_states[index].src;
							own.type = own_states[index].type;
							own.state_type ="holidayPeriod";
							own.bytes = 6;
							own.bit = "";
							own.uom = "";
							own.multi = "";
							own.signed = false;
							own.writable = own_states[index].writable;
							own.offset = "00";
							own.states = "";
							write_ownstate(own_states[index].state+".startStop",wb,own);

							own.bytes = 1;
							own.offset = "06";
							own.state_type ="number";
							own.min = 1;
							own.max = 4;
							own.states ="1:AUTO_SAT;2:FIX_TEMP;3:OFF;4:ECO";
							write_ownstate(own_states[index].state+".hcMode",parseInt(d[6],16),own);

							own.bytes = 1;
							own.offset = "08";
							own.states ="2:OFF;3:TD_OFF";
							own.min = 2;
							own.max = 3;
							write_ownstate(own_states[index].state+".dhwMode",parseInt(d[8],16),own);

							own.bytes = 10;
							own.offset = "09";
							own.state_type ="holidayModes";
							const assignedTo = [];

							if (j1 > 2020)  {
								if (d[9] == "FF") assignedTo.push("hc1");
								if (d[10] == "FF") assignedTo.push("hc2");
								if (d[11] == "FF") assignedTo.push("hc3");
								if (d[12] == "FF") assignedTo.push("hc4");
								if (d[17] == "FF") assignedTo.push("dhw1");
								if (d[18] == "FF") assignedTo.push("dhw2");
							}
							own.states ="";
							write_ownstate(own_states[index].state+".assignedTo",JSON.stringify(assignedTo),own);
						}
					}

					if(own_states[index].state_type == "switchPrograms" && d.length == 12) {
						// One day switchProgram telegram
						let wb = "";
						for (let i = 0;i < d.length;i++) {
							if (d[i] != "" && i == 0) wb += d[i];
							if (d[i] != "" && i > 0) wb += "-"+d[i];
						}

						adapter.getState(own_states[index].state, function(err, state) {
							let spa = JSON.parse(state.val);
							const t = switchProgram_to_telegram(spa);
							const tt = t.split(" ");
							for (let i = 0;i < 12;i++) {
								tt[i+o1] = d[i];
							}
							let ttt="";
							for (i=0;i<tt.length;i++) {
								if (i == 0) ttt= tt[i];
								else ttt += " "+tt[i];
							}
							spa = telegram_to_switchProgram(ttt);
							write_ownstate(own_states[index].state,JSON.stringify(spa),own_states[index]);
						});
					}


					if (own_states[index].state_type == "switchPrograms" && d.length != 12) {
						// Multiple days switchProgram long telegram
						let wb = "";
						for (let i = 0;i < d.length;i++) {
							if (d[i] != "" && i == 0) wb += d[i];
							if (d[i] != "" && i > 0) wb += " "+d[i];
						}
						if (o1 == 0 && data_pos == 0) {data_long = wb; data_pos = 25;}
						if (o1 == 25 && data_pos == 25) {data_long += " "+wb; data_pos = 50;}
						if (o1 == 50 && data_pos == 50) {data_long += " "+wb; data_pos = 75;}
						if (o1 == 75 && data_pos == 75) {
							data_long += " "+wb;
							const spa = telegram_to_switchProgram(data_long);
							write_ownstate(own_states[index].state,JSON.stringify(spa),own_states[index]);
							data_pos = 0;
							data_long = "";
						}
					}
				}
			} catch(error) {}
		}
	}
}


function telegram_to_switchProgram(tt){

	const sp = {"dayOfWeek": 0,"setpoint": "","time": 0};
	const spa = [], time = 0;

	for (let d = 0;d < 7;d++ ) {
		for (let ii=0;ii<6;ii++) {
			const i1 = d*6 + ii*2;
			const i2 = i1+1;
			if (tt[i2] != "FF") {
				const min = parseInt(tt[i2],16) * 15;
				const m = (min - parseInt(min/60)*60);
				let t;
				if ( m == 0) t = parseInt(min/60) + ":00";
				else t = parseInt(min/60) + ":" + m;
				const sp = {
					"dayOfWeek" :day(d),
					"setpoint": setpoint(tt[i1]),
					"time": t
				};
				spa.push(sp);
			}
		}
	}
	return spa;
}


function switchProgram_to_telegram(spa){
	let data = "";
	let c = 0,h,m;
	for (let i=0;i < spa.length;i++) {
		data += setpoint(spa[i].setpoint) + " ";

		if (spa[i].time.length == 4) {
			h = parseInt(spa[i].time.substring(0,1));
			m = parseInt(spa[i].time.substring(2,4));
		}
		if (spa[i].time.length == 5) {
			h = parseInt(spa[i].time.substring(0,2));
			m = parseInt(spa[i].time.substring(3,5));
		}
		const hex = ((h * 60 + m) / 15).toString(16);
		data += hex + " ";
		c += 1;

		if (i < spa.length -1) {
			if (spa[i].dayOfWeek != spa[i+1].dayOfWeek && c < 6) {
				for (let ii = 0;ii < 5-c;ii++) {data += "03 FF ";}
			}
			c=0;
		}
		else {
			for (let ii = 0;ii < 5-c;ii++) {data += "03 FF ";}
		}
	}
	return data;
}



function setpoint(hex) {
	switch (hex) {
		case "03" : return("comfort");
		case "02" : return("high");
		case "01" : return("eco/low");
		case "comfort" : return("03");
		case "high" : return("02");
		case "eco/low" : return("01");
	}
	return("?");
}


function day(d) {
	let dd = "";
	switch (d) {
		case 0: dd = "Mo";break;
		case 1: dd = "Tu";break;
		case 2: dd = "We";break;
		case 3: dd = "Th";break;
		case 4: dd = "Fr";break;
		case 5: dd = "Sa";break;
		case 6: dd = "Su";break;
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

async function write_ownstate(statename,value,own) {
	if (unloaded) return;

	if (adapter.config.km200_structure) {
		const array = statename.split(".");

		if (array[0] == "thermostat" && array[1] == "ww") {
			array[0] = "dhwCircuits";
			array[1] = "dhw1";
		}
		if (array[0] == "thermostat" && array[1].substring(0,2) == "ww") {array[0] = "dhwCircuits";}

		if (array[0] == "thermostat") array[0] = "heatingCircuits";

		if (array[0] == "mixer") array[0] = "heatingCircuits";
		if (array[0] == "solar") array[0] = "solarCircuits.sc1";
		if (array[0] == "boiler") {
			array[0] = "heatSources.hs1";
			if (array[1].substring(0,2) == "ww" || array[1].substring(0,2) == "wW" ) {
				array[0] = "dhwCircuits";
				array[1] = "dhw1";
			}
		}
		statename = "";
		for (let i = 0;i < array.length;i++) {
			if (array[i] != "") statename += array[i];
			if (i < array.length-1) statename += ".";
		}
		//if (array[1] == "holidayModes") adapter.log.info(statename + " " + value + " " + JSON.stringify(own));
	}

	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.type = "mixed";
	if (own.state_type == "number") {
		obj.common.type = "number";
		if (typeof(value) != "number") value = Number(value);
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

	obj.common.name = "ems: " + statename;


	// @ts-ignore
	await adapter.setObjectAsync(statename, obj);
	adapter.setState(statename, {ack: true, val: value});
}

// own state change  --------------------------------------------------------------------------------------------------------------------------

const state_change = async function (id,state,obj) {
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

			if (type.substring(0,2) == "0x") type = type.substring(2);
			let telegram = "0B " + obj.native.ems_src + " ";

			if (type.length == 2) {
				telegram += type + " " + obj.native.ems_offset + " " + vc;
			}
			if (type.length == 3) {
				telegram += "FF " + obj.native.ems_offset + " 0" + type.substring(0,1);
				telegram += " " + type.substring(1,2) + " " + vc;
			}
			if (type.length == 4) {
				telegram += "FF " + obj.native.ems_offset + " " + type.substring(0,2);
				telegram += " " + type.substring(2,4) + " " + vc;
			}
			post(id,telegram);
		}

		if (obj.common.role == "value" && obj.native.ems_state_type == "hex") {
			const bytes = obj.native.ems_bytes;
			let type = obj.native.ems_type;

			if (type.substring(0,2) == "0x") type = type.substring(2);
			let telegram = "0B " + obj.native.ems_src + " ";

			if (type.length == 2) {
				telegram += type + " " + obj.native.ems_offset + " " + value;
			}
			if (type.length == 3) {
				telegram += "FF " + obj.native.ems_offset + " 0" + type.substring(0,1);
				telegram += " " + type.substring(1,2) + " " + value;
			}
			if (type.length == 4) {
				telegram += "FF " + obj.native.ems_offset + " " + type.substring(0,2);
				telegram += " " + type.substring(2,4) + " " + value;
			}

			post(id,telegram);
		}


		if (obj.common.role == "switchPrograms") {

			const spa = JSON.parse(value);
			const t = switchProgram_to_telegram(spa);
			const tt = t.split(" ");

			let type = obj.native.ems_type;
			const src = obj.native.ems_src;
			if (type.substring(0,2) == "0x") type = type.substring(2);
			if (type.length == 3) type = "0"+type;

			let offset = "00";
			let telegram = "";

			for (let i=0;i<7;i++) {
				offset = (i*12).toString(16).toUpperCase();
				if (offset.length == 1) offset = "0"+offset;
				telegram = "0B " + src + " FF " +  offset + " " + type.substring(0,2)+ " " + type.substring(2,4);

				for (let ii=0;ii<12;ii++) {
					telegram += " " + tt[(i*12)+ii];
				}
				post(id,telegram);
			}
		}


		if (obj.common.role == "holidayModes") {
			let type = obj.native.ems_type;
			const src = obj.native.ems_src;
			if (type.substring(0,2) == "0x") type = type.substring(2);
			if (type.length == 3) type = "0"+type;

			if (obj.native.ems_state_type == "holidayPeriod") {

				const offset = "00";
				let telegram = "0B " + src + " FF " +  offset + " " + type.substring(0,2)+ " " + type.substring(2,4) + " ";
				let yy = parseInt(value.substr(2,2)).toString(16).toUpperCase();
				let mm = ("00" + parseInt(value.substr(5,2)).toString(16)).slice(-2).toUpperCase();
				let dd = ("00" + parseInt(value.substr(8,2)).toString(16)).slice(-2).toUpperCase();
				telegram += yy + " " + mm + " " + dd + " ";

				yy = parseInt(value.substr(13,2)).toString(16).toUpperCase();
				mm = ("00" + parseInt(value.substr(16,2)).toString(16)).slice(-2).toUpperCase();
				dd = ("00" + parseInt(value.substr(19,2)).toString(16)).slice(-2).toUpperCase();
				telegram += yy + " " + mm + " " + dd;
				post(id,telegram);
			}
			else {
				const offset = "09";
				let telegram = "0B " + src + " FF " +  offset + " " + type.substring(0,2)+ " " + type.substring(2,4) + " ";
				let hex = "00"; if (value.search("hc1") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc2") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc3") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("hc4") > -1) hex = "FF"; telegram += hex + " ";
				telegram += "00 00 00 00 ";
				hex = "00"; if (value.search("dhw1") > -1) hex = "FF"; telegram += hex + " ";
				hex = "00"; if (value.search("dhw2") > -1) hex = "FF"; telegram += hex;
				post(id,telegram);
			}
		}
	} catch(e) {}
};


async function post(id,telegram) {
	const url = emsesp + "/api/system/send ";
	adapter.log.info("write change to ems-esp raw telegram: "+ id+ "  -  "+telegram);

	try {
		await ems_put(url,telegram);
		//adapter.log.info(response);
	}
	catch (error) { adapter.log.error("error write change ems-esp raw error");}

}


async function sleep(ms) {return new Promise(resolve => {setTimeout(() => !unloaded && resolve(), ms);});}
const unload = function (u) {unloaded = u;};

module.exports ={init,unload,state_change};