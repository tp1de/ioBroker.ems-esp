/* eslint-disable no-mixed-spaces-and-tabs */
const Syslog = require("simple-syslog-server") ;
let server;
const request = require("request");

let emsesp,ems_token ="",ems_poll_wait = 500;

let own_states = [];
let telegrams = [], syslog = [];
let fsrc ="",fdest="",ftype="",fvalue="",fpolling=false;

let unloaded = false;

const separator = " ";
const output = true;
let active = false;
let active_old = false;
let data_long = "";
let data_pos = 0;

let adapter;
const init = async function(a,o,i) {
	adapter = a;
	own_states = o;
	emsesp = adapter.config.emsesp_ip ;
	ems_poll_wait = adapter.config.ems_poll_wait;
	if (emsesp.substr(0,7) != "http://") emsesp = "http://" + emsesp;
	ems_token = adapter.config.ems_token.trim();
	await init_syslog();
	i.poll = setInterval(function() {ems_poll();}, 60000); // 60 sec
	try {await syslog_server();}
	catch (err) {adapter.log.info(err);}
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
			//adapter.log.info(telegram);

			//var url = "http://ems-esp/api/system/send ";
			const url = emsesp + "/api/system/send " ;

			try {const response = await ems_put(url,telegram);}
			catch (error) { console.log(error);}
			await sleep(ems_poll_wait);
	    }
	}
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



async function syslog_server() {

	const options = {type: "udp4"} ;
	const address = "" ; // Any
	let port = 0;
	let state = await adapter.getStateAsync("syslog.server.port");
	if (state != null) port = state.val;
	if (port == 0) return;

	const listen = {host: address, port: port} ;
	server = Syslog.UDP(options);

	state = await adapter.getStateAsync("syslog.activated");
	if (state != null) active = state.val;

	const telegrams = [], syslog = [];
	adapter.setStateAsync("syslog.server.active",{ack: true, val: false});
	const fsrc ="",fdest="",ftype="",fvalue="",fpolling=false;
	
	// Start Syslog Server ---------------------------------------------------------------------------------------------------------------------------------

	server.on("msg", data => {

		if (!unloaded) sys(data);
		else {adapter.log.info("syslog server closed due to adapter stop");server.close();return;}

	})
		.on("error", err => {adapter.log.error("syslog error :" + err);server.close();return;})
		.listen(listen)
		.then(() => {adapter.log.info("syslog server now listening on port:" + port);})
		.catch(err => {});
}


// Anaylse syslog data stream ------------------------------------------------------------------------------------------------------------------------------

async function sys (data) {

	//let fsrc ="",fdest="",ftype="",fpolling=false;
	//adapter.getState("syslog.activated", function (err, state) { if (state != null) active = state.val;} );
	const state = await adapter.getStateAsync("syslog.activated");
	active = state.val;

	if (active_old == false && active == true) {
		telegrams = [];syslog = [];
		const time = new Date();
		const d = {"time" : time.toLocaleString(),"telegram": "Start"};
		telegrams.unshift(d);
		adapter.setState("syslog.telegrams",{ack: true, val: JSON.stringify(telegrams)});
		adapter.setState("syslog.telegram.dest",{ack: true, val: ""});
		adapter.setState("syslog.telegram.type",{ack: true, val: ""});
		adapter.setState("syslog.telegram.type_text",{ack: true, val: ""});
		adapter.setState("syslog.telegram.type_raw",{ack: true, val: ""});
		adapter.setState("syslog.telegram.data",{ack: true, val: ""});
		adapter.setState("syslog.telegram.offset",{ack: true, val: ""});
		adapter.setState("syslog.telegram.telegram_raw",{ack: true, val: ""});
	}
	active_old = active;
	adapter.setStateAsync("syslog.server.active",{ack: true, val: true});

	adapter.setStateAsync("syslog.server.data",{ack: true, val: JSON.stringify(data)});
	s_list(syslog,data);
	adapter.getState("syslog.filter.src", function (err, state) { if (state != null) fsrc = state.val;} );
	adapter.getState("syslog.filter.dest", function (err, state) { if (state != null) fdest = state.val;} );
	adapter.getState("syslog.filter.type", function (err, state) { if (state != null) ftype = state.val;} );
	adapter.getState("syslog.filter.value", function (err, state) { if (state != null) fvalue = state.val;} );
	adapter.getState("syslog.filter.polling", function (err, state) { if (state != null) fpolling = state.val;} );
	let p1= false,p2=false,p3=false,p4=false,p5=false,src="",dest="",type="",typet="",typer="",offset="",tdata="",tg=[];

	if (data.msg.substr(0,3) == "Rx:") {
		const pos1 = data.msg.indexOf(":");
		if (pos1 > -1) data.msg = data.msg.substring(pos1+2);
		tg = data.msg.split(" ");
		src = tg[0];
		dest = tg[1];
		type = tg[2];
		typer = type;
		offset = tg[3];
		tdata = "";
		for (let i = 4; i < tg.length-1; i++) {
			if (i == 4) tdata = tg[i];
			else tdata += " " + tg[i];
		}

		if (fsrc == src || fsrc == "") p1 =true;
		if (fdest == dest || fdest == "") p2 =true;
		const bits = ("00000000" + (parseInt(dest, 16)).toString(2)).substr(-8);
		const bit8 = bits.substring(0,1);
		p3 = true;
		if ( bit8 == "1" && fpolling == false) p3 = false;
		if (type == "FF" && bit8 == "0") {
			typer = tg[4]+tg[5];
			//if (typer.substr(0,1) == "0") typer = typer.substr(1,3);
			let hexValue = parseInt(typer , 16);
			hexValue = hexValue + 0x0100;
			type = hexValue.toString(16).toUpperCase();
			tdata = "";
			for (let i = 6; i < tg.length-1; i++) {
				if (i == 6) tdata = tg[i];
				else tdata += " " + tg[i];
			}
		}
		if (type == "FF"  && bit8 == "1") {
			typer = tg[5]+tg[6];
			//if (typer.substr(0,1) == "0") typer = typer.substr(1,3);
			let hexValue = parseInt(typer , 16);
			hexValue = hexValue + 0x0100;
			type = hexValue.toString(16).toUpperCase();
			tdata = tg[4];
		}


		if (ftype == type || ftype == "" || ftype == typer) p4 =true;
		p5 = false;
		if (fvalue == "") p5=true;
		if (fvalue != "" && tdata.indexOf(fvalue) >= 0) p5=true;

	}
	const m1 = data.msg.search("->");
	const m2 = data.msg.search("<-");
	if (m1>  -1 || m2 > -1) {
		p3 = true;
		if (m2 > -1 && fpolling == false) p3 = false;
		let d = data.msg;
		let p11 = d.search(/\(/);
		let p12 = d.search(/\)/);
		src = d.substring(p11+3,p12);
		if (fsrc == src || fsrc == "") p1 =true;
		d = d.substring(p12 + 1);

		p11 = d.search(/\(/);
		p12 = d.search(/\)/);
		dest = d.substring(p11+3,p12);
		if (m2 > -1) {
			if (dest == "08") dest = "88";
			if (dest == "10") dest = "90";
		}
		if (fdest == dest || fdest == "") p2 =true;
		d = d.substring(p12 + 1);

		p11 = d.search(/\(/);
		typet = d.substring(2,p11);
		p12 = d.search(/\)/);
		type = d.substring(p11+3,p12);
		typer = type;
		if (typer.length >= 3) {
			let hexValue = parseInt(typer , 16);
			hexValue = hexValue - 0x0100;
			typer = hexValue.toString(16).toUpperCase();
			if (typer.length == 3) {
				typer = "0"+typer;
			}
		}


		if (ftype == type || ftype == "" || ftype == typer || ftype == typet) p4 =true;
		d = d.substring(p12 + 1);

		p11 = d.search(/\(/);
		p12 = d.search(/\)/);
		offset = "00";
		if (p11> -1 && p12 > -1) offset = d.substring(p11+8,p12);
		const offn = parseInt(offset);
		offset = offn.toString(16);

		if (p11 == -1) tdata = d.substring(8);
		if (p11 > -1)  tdata = d.substring(8,p11);

		p5 = false;
		if (fvalue == "") p5=true;
		if (fvalue != "" && tdata.indexOf(fvalue) >= 0) p5=true;

	}

	if (typet == "?" && adapter.config.states_undefined == true)  {
		let index = -1;
		for (let i=0;i < own_states.length;i++){
			if (typer == own_states[i].type && src == own_states[i].src && dest < "80") {index = i;break;}
		}
		if (index == -1) write_undefinedstate(src,typer,offset,tdata);
	}

	// look for own states
	read_own_states(src,dest,offset,type,typer,tdata,own_states);

	if(p1 && p2 && p3 && p4 && p5 && active && !unloaded) {
		adapter.setState("syslog.telegram.telegram_raw",{ack: true, val: data.msg});
		adapter.setState("syslog.telegram.src",{ack: true, val:src});
		adapter.setState("syslog.telegram.dest",{ack: true, val:dest});
		adapter.setState("syslog.telegram.type",{ack: true, val:type});
		adapter.setState("syslog.telegram.type_text",{ack: true, val:typet});
		adapter.setState("syslog.telegram.type_raw",{ack: true, val:typer});
		adapter.setState("syslog.telegram.offset",{ack: true, val:offset});
		adapter.setState("syslog.telegram.data",{ack: true, val:tdata});

		t_list(telegrams,data.msg);
	}


}


// Own states processing ---------------------------------------------------------------------------------------------------------------------------------

function read_own_states(src,dest,offset,type,typer,tdata,own_states) {

	let index = -1;
	for (let i=0;i < own_states.length;i++){
		if (typer == own_states[i].type && src == own_states[i].src && dest < "80") {
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

						if(state_type == "number" & bit == "") {
							let wb = "";
							for (let i = 0;i < bytes;i++) {
								wb += d[o2-o1+i];
							}
							const s = own_states[index].signed;
							let w = parseInt(wb,16);
							if (s == true) w = hexToSignedInt(wb);
							let m = 1;
							if ( own_states[index].multi !== "") m = own_states[index].multi;
							w = w / m;
							write_ownstate(own_states[index].state,w,own_states[index]);
						}

						if(state_type == "number" & bit != "") {
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

						if(own_states[index].state_type == "holidayModes" && d.length > 17) {
							let wb = "";
							//adapter.log.info("hm "+d.length);

							const j1 = parseInt(d[0],16) + 2000;
							const m1 = parseInt(d[1],16);
							const d1 = parseInt(d[2],16);

							const j2 = parseInt(d[3],16) + 2000;
							const m2 = parseInt(d[4],16);
							const d2 = parseInt(d[5],16);
							wb = d1 + "." + m1 + "." + j1 + "-" + d2 + "." + m2 + "." +j2;
							const own = own_states[index];
							write_ownstate(own_states[index].state+".startStop",wb,own_states[index]);
							own.state_type ="number";
							own.states ="1:AUTO_SAT;2:FIX_TEMP;3:OFF;4:ECO";
							write_ownstate(own_states[index].state+".hcMode",parseInt(d[6],16),own);
							own.states ="2:OFF;3:TD_OFF";
							write_ownstate(own_states[index].state+".dhwMode",parseInt(d[8],16),own);
							own.state_type ="string";
							wb = d[9] + " " + d[10] + " " + d[11]+ " " + d[12];
							write_ownstate(own_states[index].state+".assignedToHc",wb,own);
							wb = d[17] + " " + d[18];
							write_ownstate(own_states[index].state+".assignedToDhw",wb,own);
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


function telegram_to_switchProgram(data){
	//adapter.log.info(data_long);
	const tt = data.split(" ");

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



function t_list(telegrams,t) {
	const max = 250;
	const time = new Date();
	const d = {"time" : time.toLocaleString(),"telegram": t};
	telegrams.unshift(d);
	if (telegrams.length > max) telegrams.pop();
	adapter.setStateAsync("syslog.telegrams",{ack: true, val:JSON.stringify(telegrams)});
}

function s_list(syslog,s) {
	const max = 250;
	syslog.unshift(s);
	if (syslog.length > max) syslog.pop();
	adapter.setStateAsync("syslog.server.syslog",{ack: true, val:JSON.stringify(syslog)});
}


async function init_syslog() {
	await adapter.setObjectNotExistsAsync("syslog.filter.src",{type: "state",
		common: {type: "string", name: "syslog source filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.src", function(err,state){if (state == null) adapter.setState("syslog.filter.src", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.dest",{type: "state",
		common: {type: "string", name: "syslog destination filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.dest", function(err,state){if (state == null) adapter.setState("syslog.filter.dest", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.type",{type: "state",
		common: {type: "string", name: "syslog type filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.type", function(err,state){if (state == null) adapter.setState("syslog.filter.type", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.value",{type: "state",
		common: {type: "string", name: "syslog value filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.value", function(err,state){if (state == null) adapter.setState("syslog.filter.value", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.polling",{type: "state",
		common: {type: "boolean", name: "syslog polling filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.polling", function(err,state){if (state == null) adapter.setState("syslog.filter.polling", {ack: true, val: false});});

	await adapter.setObjectNotExistsAsync("syslog.server.active",{type: "state",
		common: {type: "boolean", name: "syslog server active?", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.server.data",{type: "state",
		common: {type: "object", name: "syslog data", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.server.port",{type: "state",
		common: {type: "number", name: "syslog port number", role: "value", read: true, write: true}, native: {}});
	adapter.setState("syslog.server.port", {ack: true, val: adapter.config.syslog_port});

	await adapter.setObjectNotExistsAsync("syslog.server.syslog",{type: "state",
		common: {type: "json", name: "syslog json-list", role: "value", read: true, write: true}, native: {}});

	await adapter.setObjectNotExistsAsync("syslog.telegram.src",{type: "state",
		common: {type: "string", name: "telegram source", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.dest",{type: "state",
		common: {type: "string", name: "telegram destination", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.type",{type: "state",
		common: {type: "string", name: "telegram type-id", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.type_text",{type: "state",
		common: {type: "string", name: "telegram type-id text", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.offset",{type: "state",
		common: {type: "mixed", name: "telegram offset", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.data",{type: "state",
		common: {type: "string", name: "telegram data", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.type_raw",{type: "state",
		common: {type: "string", name: "telegram type raw (as in telegram)", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.telegram.telegram_raw",{type: "state",
		common: {type: "string", name: "telegram", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.activated",{type: "state",
		common: {type: "boolean", name: "syslog telegram analysis active?", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.activated", function(err,state){if (state == null) adapter.setState("syslog.activated", {ack: true, val: false});});

	await adapter.setObjectNotExistsAsync("syslog.telegrams",{type: "state",
		common: {type: "json", name: "telegrams json-list", role: "value", read: true, write: true}, native: {}});

}



// own state write  --------------------------------------------------------------------------------------------------------------------------

async function write_ownstate(statename,value,own) {
	if (unloaded) return;

	if (adapter.config.km200_structure) {
		const array = statename.split(".");

		if (array[0] == "thermostat") array[0] = "heatingCircuits";
		if (array[0] == "thermostat" && array[1].substring(0,2) == "ww") {array[0] = "dhwCircuits";}
		if (array[0] == "mixer") array[0] = "heatingCircuits";
		if (array[0] == "solar") array[0] = "solarCircuits.sc1";
		if (array[0] == "boiler") {
			array[0] = "heatSources.hs1";
			if (array[1].substring(0,2) == "ww" || array[1].substring(0,2) == "wW" ) {
				array[0] = "dhwCircuits.dhw1";
			}
		}
		statename = "";
		for (let i = 0;i < array.length;i++) {
			if (array[i] != "") statename += array[i];
			if (i < array.length-1) statename += ".";
		}
	}

	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "own ems:"+statename;
	obj.common.type = "mixed";
	if (own.state_type == "number") obj.common.type = own.state_type;
	if (own.state_type == "string") obj.common.type = own.state_type;
	if (own.state_type == "switchPrograms") obj.common.type = "json";
	//if (own.state_type == "holidayModes") obj.common.type = "json";
	if (own.states !== "") obj.common.states = own.states;
	if (own.min !== "") obj.common.min = own.min;
	if (own.max !== "") obj.common.max = own.max;

	obj.common.unit = own.uom;
	obj.common.read = true;
	obj.common.write = false;
	if (own.writable === true) obj.common.write = true;
	obj.common.role = "value";
	if (own.state_type == "switchPrograms") obj.common.role = "switchPrograms";
	if (own.state_type == "holidayModes") obj.common.role = "holidayModes";

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


	// @ts-ignore
	await adapter.setObjectNotExistsAsync(statename, obj);

	adapter.getState(statename, function(err, state) {
		if(state == null) {adapter.setState(statename, {ack: true, val: value});}
		else {if (state.val != value) adapter.setState(statename, {ack: true, val: value});} });

}

async function write_undefinedstate(src,typer,offset,tdata) {

	//adapter.log.info("*** undefined " + src+" " +typer+"   "+offset+" "+tdata);
	const d  = tdata.split(" ");

	for (let i = 0;i< d.length;i++) {
		const index = i + parseInt(offset);
		let statename = "";
		if (index < 10) statename = "undefined."+src+"."+typer+".0"+index;
		else statename = "undefined."+src+"."+typer+"."+index;
		const obj={_id:statename,type:"state",common:{},native:{}};
		obj.common.id = statename;
		obj.common.name= statename;
		obj.common.type = "mixed";
		obj.common.read = true;
		obj.common.write = false;
		await adapter.setObjectNotExistsAsync(statename, obj);

		//try {const dec = parseInt(d[i],16);adapter.setState(statename, {ack: true, val: dec});}
		//catch(error) {adapter.setState(statename, {ack: true, val: d[i]});}
		adapter.setStateAsync(statename, {ack: true, val: d[i]});
	}
}


// own state change  --------------------------------------------------------------------------------------------------------------------------

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

			//adapter.log.info(type + " " + type.length + " " + telegram);

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

	} catch(e) {}
};





async function sleep(ms) {
	return new Promise(resolve => {setTimeout(() => !unloaded && resolve(), ms);});
}

const unload = function (u) {
	unloaded = u;
	adapter.log.info("syslog server closed due to adapter stop");
	server.close();
};

module.exports ={init,unload,state_change};