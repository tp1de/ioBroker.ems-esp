/* eslint-disable no-mixed-spaces-and-tabs */
const Syslog = require("simple-syslog-server") ;
const fs = require("fs");

let server;
let telegrams = [], syslog = [];
let unloaded = false;

let active = false;
let active_old = false;

let adapter, utils, fn;

const init = async function(a,u) {
	adapter = a;
	utils = u;
	const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
	await fs.promises.mkdir(dataDir+"/ems-esp/"+adapter.instance, { recursive: true });
	fn = dataDir+"/ems-esp/"+adapter.instance+"/syslog";
	adapter = a;
	await init_syslog();
	try {await syslog_server();}
	catch (err) {adapter.log.info(err);}
};


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

	adapter.setStateAsync("syslog.server.active",{ack: true, val: false});

	// Start Syslog Server ---------------------------------------------------------------------------------------------------------------------------------

	server.on("msg", data => {

		if (!unloaded) sys(data);
		else {adapter.log.info("syslog server closed due to adapter stop");server.close();return;}

	})
		.on("error", err => {adapter.log.error("syslog error :" + err);server.close();return;})
		.listen(listen)
		.then(() => {adapter.log.info("syslog server now listening on port:" + port);})
		.catch(err => {adapter.log.error(err);});
}


// Anaylse syslog data stream ------------------------------------------------------------------------------------------------------------------------------

async function sys (data) {

	let fsrc ="",fdest="",ftype="",fpolling=false, fvalue="";
	adapter.getState("syslog.activated", function (err, state) { if (state != null) active = state.val;} );
	const state = await adapter.getStateAsync("syslog.activated");
	active = state.val;

	if (active_old == false && active == true) {
		telegrams = [];syslog = [];
		const time = new Date();
		const d = {"time" : time.toLocaleString(),"telegram": "Start"};
		telegrams.unshift(d);
		await adapter.setStateAsync("syslog.telegrams",{ack: true, val: JSON.stringify(telegrams)});
		await adapter.setStateAsync("syslog.telegram.dest",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.type",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.type_text",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.type_raw",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.data",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.offset",{ack: true, val: ""});
		await adapter.setStateAsync("syslog.telegram.telegram_raw",{ack: true, val: ""});
	}
	if (active_old == true && active == false) write_file(fn,telegrams);

	active_old = active;
	adapter.setStateAsync("syslog.server.active",{ack: true, val: true});

	adapter.setStateAsync("syslog.server.data",{ack: true, val: JSON.stringify(data)});
	s_list(syslog,data);

	let state1 = await adapter.getStateAsync("syslog.filter.src"); if (state1 != null) fsrc = state1.val;
	state1 = await adapter.getStateAsync("syslog.filter.dest"); if (state1 != null) fdest = state1.val;
	state1 = await adapter.getStateAsync("syslog.filter.type"); if (state1 != null) ftype = state1.val;
	state1 = await adapter.getStateAsync("syslog.filter.value"); if (state1 != null) fvalue = state1.val;
	state1 = await adapter.getStateAsync("syslog.filter.polling"); if (state1 != null) fpolling = state1.val;

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
		if ((type == "FF" || type == "F9")  && bit8 == "0") {
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
		if ((type == "FF" || type == "F9")  && bit8 == "1") {
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
	if(p1 && p2 && p3 && p4 && p5 && active && !unloaded) {

		await adapter.setStateAsync("syslog.telegram.telegram_raw",{ack: true, val: data.msg});
		await adapter.setStateAsync("syslog.telegram.src",{ack: true, val:src});
		await adapter.setStateAsync("syslog.telegram.dest",{ack: true, val:dest});
		await adapter.setStateAsync("syslog.telegram.type",{ack: true, val:type});
		await adapter.setStateAsync("syslog.telegram.type_text",{ack: true, val:typet});
		await adapter.setStateAsync("syslog.telegram.type_raw",{ack: true, val:typer});
		await adapter.setStateAsync("syslog.telegram.offset",{ack: true, val:offset});
		await adapter.setStateAsync("syslog.telegram.data",{ack: true, val:tdata});

		if (tdata != "<empty>" && tdata != ""  ) t_list(telegrams,data.msg);
	}

}

function write_file(fn,telegrams) {
	const fnw = fn+"_"+Date.now()+".txt";
	let data = "";
	for (let i = 0; i < telegrams.length; i++) {
		data += JSON.stringify(telegrams[i]) + " \n";
	}

	try { fs.writeFileSync(fnw, data, "utf8");
	}
	catch (err) {adapter.log.info(err);}

}

function t_list(telegrams,t) {
	const max = 1000;
	const time = new Date();
	const d = {"time" : time.toLocaleString(),"telegram": t};
	telegrams.unshift(d);
	if (telegrams.length > max) telegrams.pop();
	adapter.setStateAsync("syslog.telegrams",{ack: true, val:JSON.stringify(telegrams)});
}

function s_list(syslog,s) {
	const max = 1000;
	syslog.unshift(s);
	if (syslog.length > max) syslog.pop();
	adapter.setStateAsync("syslog.server.syslog",{ack: true, val:JSON.stringify(syslog)});
}


async function init_syslog() {
	await adapter.setObjectNotExistsAsync("syslog.filter.src",{type: "state",
		common: {type: "string", name: "syslog source filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.src", function(err,state){if (state == null) adapter.setStateAsync("syslog.filter.src", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.dest",{type: "state",
		common: {type: "string", name: "syslog destination filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.dest", function(err,state){if (state == null) adapter.setStateAsync("syslog.filter.dest", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.type",{type: "state",
		common: {type: "string", name: "syslog type filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.type", function(err,state){if (state == null) adapter.setStateAsync("syslog.filter.type", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.value",{type: "state",
		common: {type: "string", name: "syslog value filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.value", function(err,state){if (state == null) adapter.setStateAsync("syslog.filter.value", {ack: true, val: ""});});

	await adapter.setObjectNotExistsAsync("syslog.filter.polling",{type: "state",
		common: {type: "boolean", name: "syslog polling filter", role: "value", read: true, write: true}, native: {}});
	adapter.getState("syslog.filter.polling", function(err,state){if (state == null) adapter.setStateAsync("syslog.filter.polling", {ack: true, val: false});});

	await adapter.setObjectNotExistsAsync("syslog.server.active",{type: "state",
		common: {type: "boolean", name: "syslog server active?", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.server.data",{type: "state",
		common: {type: "object", name: "syslog data", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("syslog.server.port",{type: "state",
		common: {type: "number", name: "syslog port number", role: "value", read: true, write: true}, native: {}});
	await adapter.setStateAsync("syslog.server.port", {ack: true, val: adapter.config.syslog_port});

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
	adapter.getState("syslog.activated", function(err,state){if (state == null) adapter.setStateAsync("syslog.activated", {ack: true, val: false});});

	await adapter.setObjectNotExistsAsync("syslog.telegrams",{type: "state",
		common: {type: "json", name: "telegrams json-list", role: "value", read: true, write: true}, native: {}});

}

const unload = function (u) {
	unloaded = u;
	adapter.log.info("syslog server closed due to adapter stop");
	server.close();
};

module.exports ={init,unload};