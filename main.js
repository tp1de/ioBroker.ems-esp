//eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
//"use strict";
//"esversion":"6";

/*
 * ems-esp adapter version v0.9.9
 *
 * Created with @iobroker/create-adapter v1.33.0
 */

const utils = require("@iobroker/adapter-core");
const adapter = utils.adapter("ems-esp");
const fs = require("fs");
const request = require("request");
const Syslog = require("simple-syslog-server") ;

let datafields = [];
let own_states = [];


// ---------km200 en- and decryption parameters -----------------------------------------------------------------------------------------------------------------------
const Rijndael = require("rijndael-js");
const crypto = require("crypto");
const { config } = require("process");
const km200_crypt_md5_salt = new Uint8Array([
	0x86, 0x78, 0x45, 0xe9, 0x7c, 0x4e, 0x29, 0xdc,
	0xe5, 0x22, 0xb9, 0xa7, 0xd3, 0xa3, 0xe0, 0x7b,
	0x15, 0x2b, 0xff, 0xad, 0xdd, 0xbe, 0xd7, 0xf5,
	0xff, 0xd8, 0x42, 0xe9, 0x89, 0x5a, 0xd1, 0xe4
]);
let km200_server,km200_gatewaypassword,km200_privatepassword,km200_key,km200_aeskey,cipher, km200_polling = 300;
let emsesp,recordings=false, ems_token ="",ems_http_wait = 100, ems_polling = 60;
let ems_version = "V2",enable_syslog = false;

// -------- energy recordings parameters ------------------------------------
const root = "recordings.";
const avg12m = "actualPower.avg12m";
const avg12mdhw = "actualDHWPower.avg12m";

const hh = "actualPower._Hours", hhdhw= "actualDHWPower._Hours";
const dd = "actualPower._Days", dddhw= "actualDHWPower._Days";
const mm = "actualPower._Months", mmdhw= "actualDHWPower._Months";

const hhr = "actualPower.Hours.", hhdhwr= "actualDHWPower.Hours.";
const ddr = "actualPower.Days.", dddhwr= "actualDHWPower.Days.";
const mmr = "actualPower.Months.", mmdhwr= "actualDHWPower.Months.";

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
		if (km200_server.substr(0,7) != "http://") km200_server = "http://" + km200_server;

		km200_polling = this.config.km200_polling;
		if (km200_polling < 90) km200_polling = 90;
		km200_gatewaypassword = this.config.gateway_pw;
		km200_privatepassword = this.config.private_pw;
		recordings = this.config.recordings;
		db = this.config.database_instance;
		km200_structure= this.config.km200_structure;
		enable_syslog = this.config.syslog;

		emsesp = this.config.emsesp_ip ;
		if (emsesp.substr(0,7) != "http://") emsesp = "http://" + emsesp;

		ems_token = this.config.ems_token.trim();
		ems_http_wait = this.config.ems_http_wait;
		ems_polling = this.config.ems_polling;
		if (ems_polling < 15) ems_polling = 15;

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

		// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
		// Read own States for syslog-analysis
		try {
			for (let i = 0;i < this.config.devices.length;i++) {
				if (this.config.devices[i].state !== "" && this.config.devices[i].type !== "" && this.config.devices[i].offset !== "")
					own_states.push(this.config.devices[i]);
			}
		} catch(error) {}

		// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
		// Read csv-file:
		const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
		await fs.promises.mkdir(dataDir+"/ems-esp", { recursive: true });

		const fn = dataDir+"/ems-esp/"+this.config.control_file;
		let data = "";

		if (adapter.config.states_reorg == true) await delete_states_emsesp();

		if (enable_syslog == true) {
			await init_syslog();
			try {await syslog_server();}
			catch (err) {this.log.info(err);}
		}

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

		// Testing API Version
		if (this.config.emsesp_active) {
			const url = emsesp +  "/api/system";
			try {
				const data = await ems_get(url);
				ems_version = "V3";
			}
			catch(error) {ems_version = "V2";}
			this.log.info("API version identified " + ems_version);
		}

		const version = ems_version;

		if (this.config.emsesp_active) await init_states_emsesp(version);
		if (this.config.km200_active) await init_states_km200();

		await sleep(5000);
		if (version == "V2") v2_readwrite();

		await init_statistics();
		//await init_controls();
		

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
					enable_state(root+hh,0,0);
					enable_state(root+hhdhw,0,0);
					enable_state(root+dd,0,0);
					enable_state(root+dddhw,0);
					enable_state(root+mm,0,0);
					enable_state(root+mmdhw,0,0);
					adapter.setState(root+"created", {ack: true, val: true});
				}
			});
		}

		this.subscribeStates("*");

		// ems and km200 read schedule
		if (recordings && this.config.km200_active) km200_recordings();

		let interval1,interval2,interval3,interval4,interval5;

		if (this.config.emsesp_active) adapter.log.info("ems  :"+this.config.emsesp_active + " " + ems_polling + " secs");
		if (this.config.km200_active) adapter.log.info("km200:"+this.config.km200_active + " " + km200_polling + " secs");
		if (this.config.recordings) adapter.log.info("recordings:"+this.config.recordings+" hour");

		if (this.config.km200_active) interval1 = setInterval(function() {km200_read(datafields);}, km200_polling*1000); // 90 sec
		if (this.config.emsesp_active) interval2 = setInterval(function() {ems_read(version);}, ems_polling*1000);


		if (recordings && this.config.km200_active ) interval3 = setInterval(function() {km200_recordings();}, 3600000); // 1 hour = 3600 secs

		if (this.config.km200_active || this.config.emsesp_active) interval4 = setInterval(function() {read_statistics();}, 60000); // 60 sec
		if (this.config.eff_active) interval5 = setInterval(function() {read_efficiency();}, 60000); // 60 sec

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

function decrypt(key, value) {
	let result = "";
	for (let i = 0; i < value.length; ++i) {
	 result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
	}
	return result;
}



function enable_state(stateid,retention,interval) {
	const id =  adapter.namespace  + "." + stateid;
	adapter.sendTo(db, "enableHistory", {id: id, options:
		{changesOnly: false,debounce: 0,retention: retention,changesRelogInterval: interval,
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

	// Testing API Version

	//ems_version = "V2";
	//const url1 = emsesp +  "/api/system";
	//try {const data = await ems_get(url1);ems_version = "V3";} catch(error) {}

	ems_version = obj.native.ems_api;

	
	if (ems_version == "raw") {
		let vc = "";

		if (obj.native.ems_multi != "") {			
			let multi = 1 / obj.native.ems_multi;
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

		let url = emsesp + "/api/system/send ";
		adapter.log.info("write change to ems-esp raw telegram: "+ id + ": "+value);

		const headers = {"Content-Type": "application/json","Authorization": "Bearer " + ems_token};
		const body =JSON.stringify({"value": telegram});

		request.post({url, headers: headers, body}, function(error,response) {
			const status= JSON.parse(response.body).statusCode;
			const resp= JSON.parse(response.body).message;
			if (resp != "OK") adapter.log.error("ems-esp http write error: " + status + " " + resp + "  " + url);
		});


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


	} else {
		if (obj.native.ems_km200 != null) {
			adapter.log.info("write change to km200: "+ id + ": "+value);
			try {
				if(typeof obj.native.km200.allowedValues != "undefined" && obj.native.km200.type == "stringValue" ) value= obj.native.km200.allowedValues[value];				
				const resp = await km200_put(obj.native.ems_km200 , value, obj.native.km200.type);
				if (resp.statusCode != 200 && resp.statusCode != 204) {adapter.log.warn("km200 http write error " + resp.statusCode + ":" + obj.native.ems_km200);}
			}
			catch(error) {adapter.log.warn("km200 http write error "+ error + ":" + obj.native.ems_km200);}
		}
	}

}

async function init_controls() {

	await adapter.setObjectNotExistsAsync("controls.optimize_takt",{type: "state",
		common: {type: "boolean", name: "optimization of takting time", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.use_heatingdemand",{type: "state",
		common: {type: "boolean", name: "use calculated heating demand for boiler control", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.minimum_boilerpower",{type: "state",
		common: {type: "number", name: "minimum boiler power (min modulation x boiler power)", unit: "kW", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("controls.heatingdemand",{type: "state",
		common: {type: "number", name: "heating demand from external source", unit: "kW", role: "value", read: true, write: true}, native: {}});

}


async function init_statistics() {

	await adapter.setObjectNotExistsAsync("statistics.ems-read",{type: "state",
		common: {type: "number", name: "ems read time for polling", unit: "seconds", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.km200-read",{type: "state",
		common: {type: "number", name: "km200 read time for polling", unit: "seconds",  role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-on-1h",{type: "state",
		common: {type: "number", name: "percentage boiler on per hour", unit: "%", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-starts-1h",{type: "state",
		common: {type: "number", name: "boiler starts per hour", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.boiler-starts-24h",{type: "state",
		common: {type: "number", name: "boiler starts per 24 hours", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.ww-starts-1h",{type: "state",
		common: {type: "number", name: "ww starts per hour (EMS-ESP only)", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.ww-starts-24h",{type: "state",
		common: {type: "number", name: "ww starts per 24 hours (EMS-ESP only)", unit: "", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync("statistics.efficiency",{type: "state",
		common: {type: "number", name: "boiler efficiency", unit: "%", role: "value", read: true, write: true}, native: {}});
	await adapter.setObjectNotExists("statistics.created",{type: "state",
		common: {type: "boolean", name: "Database (mySQL/InfluxDB) enabled for fields needed for statistics", unit: "", role: "value", read: true, write: true}, native: {}});

	adapter.getState("statistics.created", function(err, state) {
		if(state == null || state.val === false) {
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("heatSources.hs1.burnstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.burnstarts",86400,60);
			if (adapter.config.km200_active) enable_state("heatSources.numberOfStarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("dhwCircuits.dhw1.wwstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.wwstarts",86400,60);
			if (adapter.config.emsesp_active && adapter.config.km200_structure) enable_state("heatSources.hs1.burngas",86400,15);
			if (adapter.config.emsesp_active && adapter.config.km200_structure === false) enable_state("boiler.burngas",86400,15);
			if (adapter.config.km200_active) enable_state("heatSources.hs1.flameStatus",86400,15);
			adapter.setState("statistics.created", {ack: true, val: true});
		}
	});
}

async function syslog_server() {

	const separator = " ";
	const output = true;
	let active = false;
	let active_old = false;

	const options = {type: "udp4"} ;
	const address = "" ; // Any
	let port = 0;
	let state = await adapter.getStateAsync("syslog.server.port");
	if (state != null) port = state.val;
	if (port == 0) return;

	const listen = {host: address, port: port} ;
	const server = Syslog.UDP(options);

	state = await adapter.getStateAsync("syslog.activated");
	if (state != null) active = state.val;

	let telegrams = [], syslog = [];
	adapter.setStateAsync("syslog.server.active",false);
	let fsrc ="",fdest="",ftype="",fvalue="",fpolling=false;


	server.on("msg", data => {
		//let fsrc ="",fdest="",ftype="",fpolling=false;
		adapter.getState("syslog.activated", function (err, state) { if (state != null) active = state.val;} );
		if (active_old == false && active == true) {
			telegrams = [];syslog = [];
			const time = new Date();
			const d = {"time" : time.toLocaleString(),"telegram": "Start"};
			telegrams.unshift(d);
			adapter.setStateAsync("syslog.telegrams",JSON.stringify(telegrams));
			adapter.setStateAsync("syslog.telegram.dest","");
			adapter.setStateAsync("syslog.telegram.type","");
			adapter.setStateAsync("syslog.telegram.type_text","");
			adapter.setStateAsync("syslog.telegram.type_raw","");
			adapter.setStateAsync("syslog.telegram.data","");
			adapter.setStateAsync("syslog.telegram.offset","");
			adapter.setStateAsync("syslog.telegram.telegram_raw","");
		}
		active_old = active;
		adapter.setStateAsync("syslog.server.active",true);
		//if (active) {
		if (true) {	
			adapter.setStateAsync("syslog.server.data",JSON.stringify(data));
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
				for (let i = 4; i < tg.length-1; i++) {tdata += tg[i]+" ";}

				if (fsrc == src || fsrc == "") p1 =true;
				if (fdest == dest || fdest == "") p2 =true;
				const bits = ("00000000" + (parseInt(dest, 16)).toString(2)).substr(-8);
				const bit8 = bits.substring(0,1);
				p3 = true;
				if ( bit8 == "1" && fpolling == false) p3 = false;
				if (type == "FF" && bit8 == 0) {
					typer = tg[4]+tg[5];
					//if (typer.substr(0,1) == "0") typer = typer.substr(1,3);
					let hexValue = parseInt(typer , 16);
					hexValue = hexValue + 0x0100;
					type = hexValue.toString(16).toUpperCase();
					tdata = "";
					for (let i = 6; i < tg.length-1; i++) {tdata += tg[i]+" ";}
				}
				if (type == "FF" && bit8 == 1) {
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
				offset = 0;
				if (p11> -1 && p12 > -1) offset = d.substring(p11+8,p12);

				if (p11 == -1) tdata = d.substring(8);
				if (p11 > -1)  tdata = d.substring(8,p11);

				p5 = false;
				if (fvalue == "") p5=true;
				if (fvalue != "" && tdata.indexOf(fvalue) >= 0) p5=true;

			}

			adapter.setStateAsync("syslog.telegram.telegram_raw",data.msg);
			adapter.setStateAsync("syslog.telegram.src",src);
			adapter.setStateAsync("syslog.telegram.dest",dest);
			adapter.setStateAsync("syslog.telegram.type",type);
			adapter.setStateAsync("syslog.telegram.type_text",typet);
			adapter.setStateAsync("syslog.telegram.type_raw",typer);
			adapter.setStateAsync("syslog.telegram.offset",offset);
			adapter.setStateAsync("syslog.telegram.data",tdata);


			if (typet == "?" && adapter.config.states_undefined == true)  write_undefinedstate(src,typer,offset,tdata);

			// look for own states

			let index = -1;
			for (let i=0;i < own_states.length;i++){
				if (typer == own_states[i].type && src == own_states[i].src) {
					index = i;
					try {
						if (index !== -1) {
							let o1 = parseInt(offset,16);
							let o2 = parseInt(own_states[index].offset,16);
							let d  = tdata.split(" ");
		
							if (o1 <= o2 && (o1+d.length) >= o2) {
								//adapter.log.info(data.msg);
		
								let bytes = own_states[index].bytes;
								let bit = own_states[index].bit;
								let state_type = own_states[index].state_type;
		
								if(state_type == "number" & bit == "") {
									let wb = "";
									for (let i = 0;i < bytes;i++) {
										wb += d[o2-o1+i]
									}	
									let s = own_states[index].signed;
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
									wbb = parseInt(wb, 16).toString(2).padStart(8, '0');
									let w = parseInt(wbb.substr(7-bit,1));
									//adapter.log.info(w+"   "+wbb);
									write_ownstate(own_states[index].state,w,own_states[index]);
								}
		
								if(own_states[index].state_type != "number") {
									let wb = "";
									if (bytes == 1) wb = d[o2-o1];
									for (let i = 0;i < bytes;i++) {
										wb += d[o2-o1+i]
									}				
									write_ownstate(own_states[index].state,wb,own_states[index]);
								}
		
							}
						}
					} catch(error) {}				
				}
			}



			if(p1 && p2 && p3 && p4 && p5 && active) {
				//console.log(data.msg);
				t_list(telegrams,data.msg);
			}

		}
	})
		.on("error", err => {adapter.log.error("Syslog error :" + err);server.close();return;})
		.listen(listen)
		.then(() => {adapter.log.info("syslog server now listening on port:" + port);})
		.catch(err => {})
}





function hexToSignedInt(hex) {
    if (hex.length % 2 != 0) {
        hex = "0" + hex;
    }
    let num = parseInt(hex, 16);
    let maxVal = Math.pow(2, hex.length / 2 * 8);
    if (num > maxVal / 2 - 1) {
        num = num - maxVal
    }
    return num;
}



function t_list(telegrams,t) {
	const max = 250;
	const time = new Date();
	const d = {"time" : time.toLocaleString(),"telegram": t};
	telegrams.unshift(d);
	if (telegrams.length > max) telegrams.pop();
	adapter.setStateAsync("syslog.telegrams",JSON.stringify(telegrams));
}

function s_list(syslog,s) {
	const max = 250;
	syslog.unshift(s);
	if (syslog.length > max) syslog.pop();
	adapter.setStateAsync("syslog.server.syslog",JSON.stringify(syslog));
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



async function read_efficiency() {
	let value = 0, power = 0,temp = 0,tempr = 0, tempavg = 0;

	if (adapter.config.emsesp_active && adapter.config.km200_structure){
		try {
			adapter.getState("heatSources.hs1.curburnpow", function (err, state) { if (state != null) power = state.val;} );
			adapter.getState("heatSources.hs1.curflowtemp", function (err, state) {if (state != null) temp = state.val;} );
			adapter.getState("heatSources.hs1.rettemp", function (err, state) {if (state != null) tempr = state.val;} );
		}
		catch (err) {adapter.log.error("error read efficiency:"+err);}
	}
	if (adapter.config.emsesp_active && adapter.config.km200_structure === false){
		try {
			adapter.getState("boiler.curburnpow", function (err, state) { if (state != null) power = state.val;} );
			adapter.getState("boiler.curflowtemp", function (err, state) {if (state != null) temp = state.val;} );
			adapter.getState("boiler.rettemp", function (err, state) {if (state != null) tempr = state.val;} );
		}
		catch (err) {adapter.log.error("error read efficiency:"+err);}
	}

	if (adapter.config.emsesp_active === false && adapter.config.km200_active){
		try {
			adapter.getState("heatSources.hs1.actualModulation", function (err, state) { if (state != null) power = state.val;} );
			adapter.getState("heatSources.actualSupplyTemperature", function (err, state) {if (state != null) temp = state.val;} );
			tempr = 0;
		}
		catch (err) {adapter.log.error("error read efficiency:"+err);}
	}

	await sleep(1000);
	//adapter.log.info(power+ " "+ temp + " " +tempr);
	if (power > 0) {
		if (tempr == 0) tempr = temp - 10; // when return flow temp is not available

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

	await adapter.setStateAsync("statistics.efficiency", {ack: true, val: value});
}

async function read_statistics() {

	let id = "";
	const end = Date.now();

	if (adapter.config.km200_active) {id = adapter.namespace + ".heatSources.numberOfStarts";}
	if (adapter.config.emsesp_active && adapter.config.km200_structure) {id = adapter.namespace + ".heatSources.hs1.burnstarts";}
	if (adapter.config.emsesp_active && adapter.config.km200_structure === false) {id = adapter.namespace + ".boiler.burnstarts";}

	stat(db,id,1,"statistics.boiler-starts-1h");
	stat(db,id,24,"statistics.boiler-starts-24h");

	if (adapter.config.emsesp_active) {
		id = adapter.namespace + ".boiler.wwstarts";
		if (adapter.config.km200_structure) id = adapter.namespace + ".dhwCircuits.dhw1.wwstarts";

		stat(db,id,1,"statistics.ww-starts-1h");
		stat(db,id,24,"statistics.ww-starts-24h");
	}


	if (adapter.config.km200_active) {id = adapter.namespace + ".heatSources.hs1.flameStatus";}
	if (adapter.config.emsesp_active && adapter.config.km200_structure ) {id = adapter.namespace + ".heatSources.hs1.burngas";}
	if (adapter.config.emsesp_active && adapter.config.km200_structure === false ) {id = adapter.namespace + ".boiler.burngas";}

	adapter.sendTo(db, "getHistory", {	id: id,	options: {start: end - 3600000, end: end, aggregate: "none"}
	}, function (result) {
		const count = result.result.length;
		let on = 0;
		for (let i = 0; i < result.result.length; i++) {if (result.result[i].val == 1) on += 1;}
		let value = 0;
		if (count !== 0 && count != undefined) value = on / count * 100;
		value = Math.round(value*10)/10;
		adapter.setStateAsync("statistics.boiler-on-1h", {ack: true, val: value});
	});

}


async function stat(db,id,hour,state) {
	const end = Date.now();
	adapter.sendTo(db, "getHistory", {	id: id,	options: {start: end - (hour*3600000), end: end, aggregate: "none"}
	}, function (result) {
		let value = 0;
		const c = result.result.length;
		if (c == 0) value = 0;
	    if (c == 1) value = 1;
		if (c > 1 && result.result[0].val == result.result[1].val) value = result.result[c-1].val-result.result[0].val;
		if (c > 1 && result.result[0].val != result.result[1].val) value = result.result[c-1].val-result.result[0].val + 1;
		adapter.setStateAsync(state, {ack: true, val: value});
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
					try {obj1._id = r.km200;
						obj1.common.name= "km200:"+r.km200;
						//obj1.native.source = "km200";
						obj1.native.ems_km200 = r.km200;
						await adapter.setObjectNotExistsAsync(obj1._id, obj1);
					} catch (error) {adapter.log.error(r.km200+":"+error);}

					let val = o.value;
					if (o.type == "stringValue" && o.allowedValues != undefined){val = o.allowedValues.indexOf(o.value);}
					if (o.type == "switchProgram" && o.switchPoints != undefined){val = JSON.stringify(o.switchPoints);}
					if (o.type == "arrayData" && o.values != undefined){val = JSON.stringify(o.values);}
					try {adapter.setStateChangedAsync(r.km200, {ack: true, val: val});}
					catch (error) {adapter.log.error(r.km200+":"+error);}
				}
			}
		}
	}
	adapter.log.info("end of initializing km200 states");
}


async function delete_states_emsesp() {

	const pattern = adapter.namespace + ".*";
	const states = await adapter.getStatesAsync(pattern);

	for (let id in states) {
		const obj = await adapter.getObjectAsync(id);
		if (obj.common.custom == undefined) adapter.delObjectAsync(id);
	}

}

async function init_states_emsesp(version) {
	adapter.log.info("start initializing ems states");
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
		const devices = JSON.parse(data).Devices;
		const status = JSON.parse(data).Status;
		const system = JSON.parse(data).System;
		const network = JSON.parse(data).Network;

		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		//for (const [key, value] of Object.entries(network)) {
		//	if (typeof value !== "object") write_state("esp."+key,value,"");
		//}

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

	adapter.log.info("end of initializing ems states");
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
							adapter.setObjectAsync(id,obj);
						}
						if (resp == "OK") {
							obj.common.write = true;
							obj.native.write = true;
							adapter.setObjectAsync(id,obj);
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
		const devices = JSON.parse(data).Devices;
		const status = JSON.parse(data).Status;
		const system = JSON.parse(data).System;
		const network = JSON.parse(data).Network;

		for (const [key, value] of Object.entries(status)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(system)) {
			if (typeof value !== "object") write_state("esp."+key,value,"");
		}

		for (const [key, value] of Object.entries(network)) {
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
		adapter.setStateAsync("statistics.ems-read", {ack: true, val: t3});
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
					if (body.type == "arrayData" && body.values != undefined){
						val = JSON.stringify(body.values);
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

async function ems_apiversion(emsesp) {
	let ems_version;
	try {const data = await ems_get(emsesp+"/api/system");ems_version = "V3";}catch(error) {ems_version = "V2";}
	return(ems_version);
}

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

	let c = results.length - 1;

	adapter.log.info(`End reading km200 data-structure: ${c} fields found`);
	return results;


	async function tree(reference) {
		try {
			const data = await km200_get(reference);
			if (data.type != "refEnum") {
				const element=data.id.substring(1).split("/").join(".");
				results.push({"km200":element,"ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});
			} else await refEnum(data);
		} catch(error) {adapter.log.warn("http error reading km200 tree entry "+ reference + " : " + error);}
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

async function write_ownstate(statename,value,own) {
	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "own ems:"+statename;
	obj.common.type = "mixed";
	if (own.state_type !== "") obj.common.type = own.state_type;
	if (own.states !== "") obj.common.states = own.states;
	if (own.min !== "") obj.common.min = own.min;
	if (own.max !== "") obj.common.max = own.max;

	obj.common.unit = own.uom;
	obj.common.read = true;
	obj.common.write = false;
	if (own.writable === true) obj.common.write = true;
	obj.common.role = "value";

	obj.native.ems_command = "own";
	obj.native.ems_api = "raw";
	obj.native.ems_src = own.src;
	obj.native.ems_type = own.type;
	obj.native.ems_offset = own.offset;
	obj.native.ems_multi = own.multi;

 	
	// @ts-ignore
	await adapter.setObjectNotExistsAsync(statename, obj);

	await adapter.getStateAsync(statename, function(err, state) {
		if(state == null) {adapter.setStateAsync(statename, {ack: true, val: value});}
		else {if (state.val != value) adapter.setStateAsync(statename, {ack: true, val: value});} });
		
}

async function write_undefinedstate(src,typer,offset,tdata) {

	//adapter.log.info("*** undefined " + src+" " +typer+"   "+offset+" "+tdata);
	let d  = tdata.split(" ");

	for (let i = 0;i< d.length;i++) {
		let index = i + parseInt(offset);
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
		
		try {let dec = parseInt(d[i],16);adapter.setStateAsync(statename, {ack: true, val: dec});}
		catch(error) {adapter.setStateAsync(statename, {ack: true, val: d[i]});    }


		//adapter.setStateAsync(statename, {ack: true, val: d[i]});	

	}

}

async function write_state_rec(statename,value) {
	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "recordings: "+statename;
	obj.common.type = "json";
	obj.common.unit = "";
	obj.common.read = true;
	obj.common.write = false;
	obj.common.role = "value";
	await adapter.setObjectNotExistsAsync(statename, obj);
	adapter.setStateAsync(statename, {ack: true, val: value});

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
	await adapter.setObjectNotExistsAsync(statename1, obj);

	if (def != "" && def != "Invalid" && ems_version == "V3") {
		const defj = JSON.parse(def);
		await adapter.setObjectAsync(statename1, obj);
		if (obj.native.ems_command == "seltemp") {
			obj.common.min = -1;
			await adapter.setObjectAsync(statename1, obj); // reset min value for seltemp
		}
	}

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

async function km200_put(url,value,type) {return new Promise(function(resolve,reject) {
	let data;
	switch (type) {
		case "switchProgram":
			data = km200_encrypt( Buffer.from(value));
			break;
		case "arrayData":
			data = '{"values":' + value +'}';
			data = km200_encrypt( Buffer.from(data) );  
			break;
		default:
			data =km200_encrypt( Buffer.from(JSON.stringify({value: value })) );
	}

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
		await sleep(2000);
	}
	if (db.substring(0,8) == "influxdb" ) {
		const query = 'drop series from "' +  field + '";';
		await adapter.sendToAsync(db, "query", query);
		await sleep(2000);
	}

	for (let i = 0; i < daten.length;i++){
		await adapter.sendToAsync(db,"storeState", daten[i]);
		await sleep(50);
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

			if (i == 0) statename = adapt+root+hhr+"today";
			if (i == 1) statename = adapt+root+hhr+"yesterday";
			if (i == 2) statename = adapt+root+hhr+"2days_before";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + ((ii) * 3600000 );
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

			if (i == 0) statename = adapt+root+hhdhwr+"today";
			if (i == 1) statename = adapt+root+hhdhwr+"yesterday";
			if (i == 2) statename = adapt+root+hhdhwr+"2days_before";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const wert = Math.round(data.recording[ii].y / 6) / 10;
					const ts = ut1 + ((ii) * 3600000 );
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

			if (i == 0) statename = adapt+root+ddr+"actual_month";
			if (i == 1) statename = adapt+root+ddr+"last_month";
			if (i == 2) statename = adapt+root+ddr+"2months_ago";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

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

			if (i == 0) statename = adapt+root+dddhwr+"actual_month";
			if (i == 1) statename = adapt+root+dddhwr+"last_month";
			if (i == 2) statename = adapt+root+dddhwr+"2months_ago";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

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

			if (i == 0) statename = adapt+root+mmr+"actual_year";
			if (i == 1) statename = adapt+root+mmr+"last_year";
			if (i == 2) statename = adapt+root+mmr+"2years_ago";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

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

			if (i == 0) statename = adapt+root+mmdhwr+"actual_year";
			if (i == 1) statename = adapt+root+mmdhwr+"last_year";
			if (i == 2) statename = adapt+root+mmdhwr+"2years_ago";
			await write_state_rec(statename,JSON.stringify(data));
			//adapter.log.info(statename + " " + JSON.stringify(data));

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
			//w = false;
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
