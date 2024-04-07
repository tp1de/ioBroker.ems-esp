/* eslint-disable prefer-const */
/* eslint-disable no-unused-vars */
/* eslint-disable no-empty */
/* eslint-disable no-mixed-spaces-and-tabs */
const Rijndael = require("rijndael-js");
const crypto = require("crypto");
const fs = require("fs");
const {default: axios} = require("axios");
const F = require("./functions.js");

const km200_crypt_md5_salt = new Uint8Array([
	0x86, 0x78, 0x45, 0xe9, 0x7c, 0x4e, 0x29, 0xdc,
	0xe5, 0x22, 0xb9, 0xa7, 0xd3, 0xa3, 0xe0, 0x7b,
	0x15, 0x2b, 0xff, 0xad, 0xdd, 0xbe, 0xd7, 0xf5,
	0xff, 0xd8, 0x42, 0xe9, 0x89, 0x5a, 0xd1, 0xe4
]);
//let datafields = [];
let datafields;
let km200_server,km200_gatewaypassword,km200_privatepassword,km200_key,km200_aeskey,cipher, km200_polling = 300;

// -------- energy recordings parameters ------------------------------------

let db = "sql.0", database = "iobroker", recordings=false;
let sum_month = 0;
// eslint-disable-next-line no-unused-vars
let r_multi = 1, r_month = true;

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Startup / Initialisation:

let unloaded = false;
let utils;
let adapter;
const init = async function(a,u,i) {
	adapter = a;
	utils = u;
	//aliveState =  "system.adapter."+adapter.namespace + ".alive";
	adapter.setState("info.connection_km200", false, true);

	km200_server = adapter.config.km200_ip;
	if (km200_server.substr(0,7) != "http://") km200_server = "http://" + km200_server;

	km200_polling = adapter.config.km200_polling;
	if (km200_polling < 90) km200_polling = 90;
	km200_gatewaypassword = adapter.config.gateway_pw.trim();
	km200_privatepassword = adapter.config.private_pw.trim();
	recordings = adapter.config.recordings;
	r_multi = adapter.config.r_multi;
	r_month = adapter.config.r_month;

	if (adapter.config.db.trim() == "" ) db = "";
	else db = adapter.config.db.trim()+"."+adapter.config.db_instance;

	if (db == "") adapter.log.info("KM200 no database instance selected for recordings");

	if (adapter.config.db.trim() == "influxdb") {
		const obj = await adapter.getForeignObjectAsync("system.adapter."+db);
		let adapterversion = "";try {adapterversion = obj.common.version;} catch(e) {}
		let dbversion = "";try {dbversion = obj.native.dbversion;} catch(e) {}
		if (dbversion == "2.x" && adapterversion < "4.0.2" && adapter.config.recordings) db = "";
	}

	if (db != "") {
		const state = await adapter.getForeignStateAsync("system.adapter."+db+".connected");
		if (state == undefined) {
			adapter.log.warn("KM200 database instance "+db+ "for recordings not existing");db = "";
		}
		else if ( state.val == false) {
			adapter.log.warn("KM200 database instance "+db+" for recordings not active");db = "";
		}
		try {
			const obj = await adapter.getForeignObjectAsync("system.adapter."+db);
			database = obj.native.dbname;
		} catch(e) {adapter.log.error("KM200 can't read database name");database = "iobroker";}
	}


	km200_key = km200_getAccesskey(km200_gatewaypassword,km200_privatepassword);
	km200_aeskey = Buffer.from(km200_key,"hex");
	cipher = new Rijndael(km200_aeskey, "ecb");

	const active = await km200_test();
	if (active) {
		adapter.setState("info.connection_km200", true, true);

		// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
		// Read csv-file:
		const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
		await fs.promises.mkdir(dataDir+"/ems-esp/"+adapter.instance, { recursive: true });

		const fn = dataDir+"ems-esp/"+adapter.instance+"/"+adapter.config.control_file;
		let data = "";

		if (adapter.config.control_file !== "" &&  adapter.config.control_file !== "*") {
			try {data = fs.readFileSync(fn, "utf8");}
			catch (err) {adapter.log.info(err);}
		}
		if (adapter.config.control_file !== "*" ) {
			datafields = read_file(data);
			if (adapter.config.states_reorg) await init_states_km200(datafields);
			else km200_read(datafields);
		}
		else {
			datafields = await read_km200structure();
			const fnw = dataDir+"ems-esp/"+adapter.instance+"/km200.csv";
			write_file(fnw,datafields);
			await init_states_km200(datafields);
		}

		if (!unloaded) {
			adapter.log.info("KM200: polling every " + km200_polling + " secs");
			i.km200 = setInterval(function() {km200_read(datafields);}, km200_polling*1000); // 90 sec
		}

		if (adapter.config.recordings && !unloaded) {
			await initrecs(datafields);
			await km200_recordings(datafields);
			adapter.log.info("KM200 recordings: polling every hour");
			i.recordings = setInterval(function() {km200_recordings(datafields);}, 3600000); // 1 hour = 3600 secs
		}
	}

	return i;
};

async function km200_test() {
	try {
		const data = await km200_get("gateway");
		if (data == undefined || data == "" || data == " ") {
			adapter.log.error("error reading KM200 gateway information (wrong passwords please re-enter) - stop km200 read");
			return(false);
		}
	} catch(error) {
		adapter.log.error("error reading KM200 gateway (wrong ip address) - stop KM200 read: "+km200_server);
		return(false);
	}
	return(true);
}


async function init_states_km200(datafields) {
	if (unloaded) return;
	adapter.log.info("start initializing KM200 states");
	for (let i=1; i < datafields.length; i++) {
		if (unloaded) break;
		const r = datafields[i];
		//adapter.log.info(JSON.stringify(r));
		if (r.km200 !== "") {
			let o;
			try {o = await km200_get(r.km200);}
			catch(error) {adapter.log.warn("http KM200 read error (gateway not responding):"+r.km200);}
			if (o != undefined) {
				try {
					const obj1 = km200_obj(r.km200,o);
					obj1._id = r.km200;
					obj1.common.name= "km200:"+r.km200;
					//obj1.native.source = "km200";
					obj1.native.ems_km200 = r.km200;
					//if (o.type != "yRecording") await adapter.setObjectNotExistsAsync(obj1._id, obj1);
					if (o.type != "yRecording") await adapter.setObjectAsync(obj1._id, obj1);
					else {
						if (adapter.config.recordings) await adapter.setObjectNotExistsAsync(obj1._id, obj1);
					}

					F.enums(adapter,obj1._id);

					let val = o.value;
					if (o.type == "stringValue" && o.allowedValues != undefined){val = o.allowedValues.indexOf(o.value);}
					if (o.type == "switchProgram" && o.switchPoints != undefined){val = JSON.stringify(o.switchPoints);}
					if (o.type == "arrayData" && o.values != undefined){val = JSON.stringify(o.values);}
					if (o.type == "errorList" && o.values != undefined){val = JSON.stringify(o.values);}
					if (o.type == "systeminfo" && o.values != undefined){val = JSON.stringify(o.values);}
					if (o.type == "yRecording" ){val = "";}
					//await adapter.setStateChangedAsync(r.km200, {ack: true, val: val});
					if (o.type != "yRecording") await adapter.setStateAsync(r.km200, {ack: true, val: val});
					else if (adapter.config.recordings) await adapter.setStateAsync(r.km200, {ack: true, val: val});
				}
				catch (error) {
					adapter.log.info("initializing KM200 states interrupted");
					unloaded = true;
					break;
				}
			}
		}
	}
	adapter.log.info("end of initializing KM200 states");
}


async function km200_read(result){
	if (unloaded) return;
	const t1 = new Date().getTime();
	for (let i=1; i < result.length; i++) {
		if (unloaded) break;
		if (result[i].km200 != "" && result[i].type != "yRecording" ) {
			let body;
			try {
				body = await km200_get(result[i].km200);
				adapter.setState("info.connection_km200", true, true);
			}
			catch(error) {
				adapter.log.debug("KM200 get error state:"+result[i].km200);
				adapter.setState("info.connection_km200", false, true);
			}
			if (body != undefined) {
				try {
					let val = body.value;
					if (body.type == "stringValue" && body.allowedValues != undefined){val = body.allowedValues.indexOf(body.value);}
					if (body.type == "switchProgram" && body.switchPoints != undefined){val = JSON.stringify(body.switchPoints);}
					if (body.type == "arrayData" && body.values != undefined){val = JSON.stringify(body.values);}
					if (body.type == "errorList" && body.values != undefined){val = JSON.stringify(body.values);}
					if (body.type == "systeminfo" && body.values != undefined){val = JSON.stringify(body.values);}
					if (body.type == "floatValue") {
						if (body.minValue != undefined && body.maxValue != undefined && body.state == undefined) {
							let update = false;
							if (val < body.minValue) {body.minvalue = val;update = true;}
							if( val > body.maxValue) {body.maxvalue = val;update = true;}
							if (update) {


							}
						}
					}

					if (!unloaded && val != "invalid") await adapter.setStateAsync(result[i].km200, {ack: true, val: val});
				}
				catch(error) {
					adapter.log.warn("KM200 read interrupted " + error);
					adapter.setState("info.connection_km200", false, true);
					unloaded = true;
					break;
				}
			}
		}
	}
	const t2 = new Date().getTime();
	const t3 = (t2-t1) / 1000;
	if (adapter.config.statistics) {
		adapter.setObjectNotExists("statistics.km200-read",{type: "state",
			common: {type: "number", name: "km200 read time for polling", unit: "seconds",  role: "value", read: true, write: true}, native: {}});
		await adapter.setStateAsync("statistics.km200-read", {ack: true, val: t3});
	}
}


function read_file(data) {
	const results =[];
	let km200_count = 0;
	// Eingelesenen Text in ein Array splitten (\r\n, \n und\r sind die Trennzeichen für verschiedene Betriebssysteme wie Windows, Linux, OS X)
	const textArray = data.split(/(\n|\r)/gm);

	for (let i = 1; i < textArray.length; i++) {
		if (textArray[i].length > 1) {
			const element ={};
			const separator = ";";
			const elementArray = textArray[i].split(separator);
			elementArray.splice(elementArray.length - 1, 1);
			element.km200=elementArray[0].trim();
			element.id=elementArray[1].trim();
			element.type=elementArray[2];
			if (element.km200 != "") km200_count += 1;
			results.push(element);

		} // End if
	} // End for
	adapter.log.info("End reading KM200 csv-file: " + km200_count + " km200-fields found");
	return results;
}

function write_file(fnw,datafields) {
	adapter.log.info("write KM200 file:" + fnw);

	let data = "km200 field;id;type;\n";
	for (let i = 0; i < datafields.length; i++) {
		data += datafields[i].km200 +";"+ datafields[i].id +";" + datafields[i].type + "; \n";
	}

	try { fs.writeFileSync(fnw, data, "utf8");} catch (err) {adapter.log.info(err);}

}



async function read_km200structure() {
	if (unloaded) return;
	adapter.log.info("start reading KM200 data-structure");
	const results = [];
	results.push({"km200":"","id":"","type":""});

	await tree("heatSources");
	await tree("dhwCircuits");
	await tree("heatingCircuits");
	await tree("system");
	await tree("notifications");
	await tree("gateway");
	await tree("solarCircuits");
	await tree("ventilation");
	await tree("recordings");
	//await tree(adapter.config.km200_entry);

	const c = results.length - 1;

	adapter.log.info(`End reading KM200 data-structure: ${c} fields found`);
	return results;


	async function tree(reference) {
		try {
			const data = await km200_get(reference);
			adapter.log.debug(JSON.stringify(data));
			if (data.type != "refEnum" && data != "") {
				const element=data.id.substring(1).split("/").join(".");
				results.push({"km200":element,"id":data.id.substring(1),"type":data.type});
			} else {
				if(data != "") await refEnum(data);
				//if(data == "") adapter.log.debug("not a valid KM200 entry point: "+reference);
			}
		} catch(error) {
			//adapter.log.warn("http error reading KM200 tree entry "+ reference + " : " + error);
		}
	}

	async function refEnum(data){
		let data1,field1,element;
		for (let i=0;i < data.references.length;i++){
			field1 =data.references[i].id.substring(1).split("/").join(".");
			try {data1 = await km200_get(field1);}
			catch(error) {data1 = "";}
			if (data1 != "" && data1 != undefined) {
				if (data1.type != "refEnum") {
					element=data1.id.substring(1).split("/").join(".");
					results.push({"km200":element,"id":data1.id.substring(1),"type":data1.type});
				}
				else {await refEnum(data1);}
			}
		}
	}
}

//------- km200 functions ------------------------------------------------------------------------------------------

async function km200_get(url) {
	let data,b;
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

	try {b = await axios(options);} catch(e) {await sleep(500);b = await axios(options);}
	if (b.status == 403 || b.status == 404) return(" ");

	if (b.status == 200) {
		try {
			const body = b.data;
			data= km200_decrypt(body);
			return(data);
		} catch(decrypt) {data = " ";
		}
	}
}


async function km200_put(url,value,type) {
	if (unloaded) return;
	let data;
	switch (type) {
		case "switchProgram":
			data = km200_encrypt( Buffer.from(value));
			break;
		case "arrayData":
			data = '{"values":' + value +"}";
			data = km200_encrypt( Buffer.from(data) );
			break;
		default:
			data =km200_encrypt( Buffer.from(JSON.stringify({value: value })) );
	}

	const urls = km200_server +"/" + url.split(".").join("/");
	try {
		let res = await axios({
			method: "put",
			url: urls,
			data: data,
			headers: {
				timeout: 10000,
				encoding: "utf8",
				port: 80,
				"Accept": "application/json",
				"User-Agent": "TeleHeater/2.2.3"
			}
		});

		let r = res.status;
		return(r);

	} catch(e) {adapter.log.error("axios put: "+ url + "  " +e);}

}


function km200_decrypt(input) {
	// Decrypt
	let output;
	try {
		let s = Buffer.from(cipher.decrypt(Buffer.from(input,"base64"),16)).toString("utf8");
		while (s.charCodeAt(s.length - 1) === 0) s = s.slice(0, s.length - 1);
		output = JSON.parse(s);
	} catch(d) {output = " ";}
	return output;
}

function km200_encrypt(input) {
	// Encrypt
	let output;
	try {output = Buffer.from(cipher.encrypt(input,16)).toString("base64");}
	catch(e) {}
	return output;
}


// -----km200-recordings------------------------------------------------------------------------------------------------------------------------------------------------

async function km200_recordings(result){
	const adapt = adapter.namespace+".";
	const temp = false;

	for (let i=1; i < result.length; i++) {
		if (unloaded) break;
		if (result[i].type == "yRecording" ) {
			sum_month = 0;
			await hours(result[i]);
			await days(result[i]);
			await months(result[i]);
		}
	}
}

async function recsw(field,d,t) {
	if ( d.length == 0) return;

	if (db.substring(0,3) == "sql" ) {

		const id = await getid(field,db);
		const src = await getsource(db);

		if (id == 0) {
			adapter.log.info("KM200 recordings first init: " + field);
			for (let i = 0; i < d.length;i++){
				try {await adapter.sendToAsync(db,"storeState", d[i]);}
				catch(e) {}
			}
		}
		else {
			for (let i = 0; i < d.length;i++){
				let values = "", command = "";
				if ( t == "hh" || t == "dd" || d[i].state.val > 0 ) {
					values = "("+id+","+d[i].state.val+","+d[i].state.ts+",1,"+src+",0)";
					command = "INSERT INTO " + database + ".ts_number (id, val, ts, ack, _from, q) VALUES "+ values;
					command += "ON DUPLICATE KEY UPDATE val=values(val)" +";";
					await adapter.sendToAsync(db,"query", command);
				}
			}
		}

	}

	if (db.substring(0,8) == "influxdb" ) {
		let id;
		try {id = d[0].id.substring(10);}
		catch(e) {adapter.log.error("recsw data:" + JSON.stringify(d));return;}

		const objx = await adapter.getForeignObjectAsync("system.adapter."+db);

		let retention = 1;try {retention = objx.native.retention;} catch(e) {}
		if (retention == -1) retention = objx.native.customRetentionDuration*24*60*60;

		let ts = Date.now();
		if (retention == 0) retention = ts;else retention = retention * 1000;
		let tsmin = ts - retention;
		await adapter.sendToAsync(db,"deleteAll", [{id:id}]);

		for (let i = 0; i < d.length;i++){
			if (!unloaded ) {
				if (d[i].state.ts > tsmin) {
					//adapter.log.info(ts+"---"+retention +"--->"+JSON.stringify(d[i]));
					await adapter.sendToAsync(db,"storeState", d[i]);
				}
			}
		}
	}


	if (db.substring(0,7) == "history" ) {
		//await adapter.sendToAsync(db,"deleteAll",[{id:field}]);
		for (let i = 0; i < d.length;i++){
			if (!unloaded ) {
				let status;
				try {status = await adapter.sendToAsync(db,"update", d[i]);} catch(e) {}
				if (status.success == false) try {status = await adapter.sendToAsync(db,"storeState", d[i]);} catch(e) {}
			}
		}
	}

	let end = Date.now() + + 24 * 15 * 3600000;

	const v = [];
	for (let i = 0; i < d.length;i++){
		if (d[i].state.ts <= end) v.push({ts: d[i].state.ts, val: d[i].state.val});
	}

	function SortArray(x, y){
		if (x.ts < y.ts) {return 1;}
		if (x.ts > y.ts) {return -1;}
		return 0;
	}
	const s = v.sort(SortArray);

	const ss = [],sss = [];
	for (let i = 0; i < s.length;i++){
		const date = new Date(s[i].ts);
		const m = date.getMonth()+1;
		let mm = m.toString();
		if ( m < 10) mm = "0"+mm;
		const d = date.getDate();
		let dd = d.toString();
		if ( d < 10) dd = "0"+dd;

		let ddd = "";
		if (t == "hh") ddd = date.getFullYear() + "-" + mm + "-" + dd +" "+date.getHours()+" hrs";
		if (t == "dd") ddd = date.getFullYear() + "-" + mm + "-" + dd;
		if (t == "mm") ddd = date.getFullYear() + "-" + mm;
		ss.push({date:ddd, val:s[i].val});
		sss.push(s[i].val);
	}

	let field1 = field.replace(/_Days/g, "Days");
	field1 = field1.replace(/_Hours/g, "Hours");
	field1 = field1.replace(/_Months/g, "Months");

	if (adapter.config.recordings_format == 0) await adapter.setStateAsync(field1, {ack:true, val:JSON.stringify(sss)});
	if (adapter.config.recordings_format == 1) await adapter.setStateAsync(field1, {ack:true, val:JSON.stringify(s)});
	if (adapter.config.recordings_format == 2) await adapter.setStateAsync(field1, {ack:true, val:JSON.stringify(ss)});
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


async function hours(r) {
	const adapt = adapter.namespace+".";
	let statename = "";

	const datum= new Date();
	let daten = [], data;
	const field = adapt+r.km200+"._Hours";
	const feld = r.km200 + "?interval=";

	for (let i=0;i<3;i++) {
		const url1 = feld + datum.getFullYear()+"-"+ (datum.getMonth()+1) +"-"+datum.getDate();
		try {data = await km200_get(url1);}
		catch(error) {adapter.log.error("KM200 error reading recordings on hour " + error);data = " "; }
		if (data != " ") {

			if (i == 0) statename = adapt+r.km200+".km200.Hours.today";
			if (i == 1) statename = adapt+r.km200+".km200.Hours.yesterday";
			if (i == 2) statename = adapt+r.km200+".km200.Hours.2days_before";

			//const ut1 = new Date(data.interval).getTime();
			let ut1 = new Date(data.interval).getTime();
			let offset = new Date(data.interval).getTimezoneOffset();
			ut1 = ut1 + offset * 60000;


			await write_state_rec(statename,JSON.stringify(data));

			try {
				for (let ii = 0; ii < data.recording.length; ii++){
					if (data.recording[ii].c != 0){
						let multi = 1;
						let wert = 0;
						if (data.recording[ii].c > 0 && adapter.config.r_c) multi = 60 / data.recording[ii].c;

						if (r.uom == "C" || r.uom == "°C") {
							wert =  data.recording[ii].y / data.recording[ii].c;
							wert = Math.round(wert * 10) / 10;
						}
						else {
							wert = data.recording[ii].y * multi * r_multi;
							wert = Math.round(wert / 6) / 10;
						}
						const ts = ut1 + ((ii+1) * 3600000 );
						daten.push({id: field,state: {ts: ts ,val: wert,ack: true}});
					}
				}
			} catch(e) {}
		}
		datum.setDate(datum.getDate() - 1);
	}
	await recsw(field,daten,"hh");
}



async function days(r) {
	const adapt = adapter.namespace+".";
	let statename = "";
	const datum= new Date();
	let daten = [], data;
	const field = adapt+r.km200+"._Days";
	const feld = r.km200 + "?interval=";
	let jahr = datum.getFullYear();
	let monat = datum.getMonth() + 1;

	for (let i=0;i<3;i++) {
		const url1 = feld + jahr + "-" + monat;
		try {data = await km200_get(url1);}
		catch(error) {adapter.log.error("KM200 error reading recordings on days "+ error);data = " "; }
		if (data != " ") {

			if (i == 0) statename = adapt+r.km200+".km200.Days.actual_month";
			if (i == 1) statename = adapt+r.km200+".km200.Days.last_month";
			if (i == 2) statename = adapt+r.km200+".km200.Days.2months_ago";
			await write_state_rec(statename,JSON.stringify(data));

			const ut1 = new Date(data.interval).getTime();
			try {
				for (let ii = 0; ii < data.recording.length; ii++){
					if (data.recording[ii].c != 0){
						let multi = 1;
						let wert = 0;

						if (adapter.config.r_c) {
							if (data.recording[ii].c > 0) multi = 60*24 / data.recording[ii].c;

							if (i == 0 && ii < data.recording.length -2) {
								if (data.recording[ii+1].c == 0) multi = 1;
							}
							if (i == 0 && ii == data.recording.length -1) multi = 1;
						}

						if (r.uom == "C" || r.uom == "°C") {
							wert =  data.recording[ii].y / data.recording[ii].c;
							wert = Math.round(wert * 10) / 10;
						}
						else {
							wert = data.recording[ii].y * multi * r_multi;
							wert = Math.round(wert / 6) / 10;
							if (i==0) sum_month += wert;
						}
						const ts = ut1 + 60000 + (ii * 3600000 * 24);
						daten.push({id: field,state: {ts: ts ,val: wert,ack: true}});
					}
				}
			} catch(e) {}
		}
		if (monat == 1) {jahr = jahr-1;monat=12;}
		else if (monat > 1) {monat = monat-1;}
	}
	await recsw(field,daten,"dd");
}



async function months(r) {
	const adapt = adapter.namespace+".";
	let statename = "";

	const datum= new Date();
	let daten = [], data;
	const field = adapt+r.km200+"._Months";
	const feld = r.km200 + "?interval=";
	let jahr = datum.getFullYear();
	const ja = jahr;
	const ma = datum.getMonth() + 1;
	const da = datum.getDate();
	let sum = 0;

	for (let i=0;i<3;i++) {
		const url1 = feld + jahr ;
		try {data = await km200_get(url1);}
		catch(error) {adapter.log.error("KM200 error reading recordings on months "+ error);data = " "; }
		if (data != " ") {

			if (i == 0) statename = adapt+r.km200+".km200.Months.actual_year";
			if (i == 1) statename = adapt+r.km200+".km200.Months.last_year";
			if (i == 2) statename = adapt+r.km200+".km200.Months.2years_ago";
			await write_state_rec(statename,JSON.stringify(data));

			try {
				for (let ii = 0; ii < data.recording.length; ii++){

					const m = ii+1;
					const t = jahr + "-" + m.toString() +"-15" ;
					const ts = new Date(t).getTime();
					const tsa = new Date();

					const days = new Date(jahr, m, 0).getDate();
					let multi = 1;
					let wert = 0;

					if (adapter.config.r_c) {
						if (data.recording[ii].c > 0) multi = 60*24*days / data.recording[ii].c;
					}

					if ((r.uom == "C" || r.uom == "°C") && data.recording[ii].c > 0) {
						wert =  data.recording[ii].y / data.recording[ii].c;
						wert = Math.round(wert * 10) / 10;
					}
					else {
						wert = data.recording[ii].y * multi * r_multi;
						wert = Math.round(wert / 6) / 10;
						if(jahr == ja && m < ma ) sum+=wert;
						if(jahr == ja-1 && m >= ma ) sum+=wert;
					}

					if (i == 0 && ma == m && r.uom != "C" && r.uom != "°C") {
						multi = 1;
						wert = Math.round(sum_month * 10) / 10;
						data.recording[ii].c = 1;
					}

					daten.push({id: field,state: {ts: ts ,val: wert,ack: true}});

					//if (data.recording[ii].c != 0 || ts < tsa){
					//	daten.push({id: field,state: {ts: ts ,val: wert,ack: true}});
					//}
				}
			} catch(e) {}
		}
		jahr = jahr-1;
	}
	await recsw(field,daten,"mm");

	if (r.uom == "kWh") {
		sum = Math.round(sum) ;
		statename = adapt+r.km200+".last12m";
		write_state_sum(statename,r.km200,sum);
	}
}


async function write_state_sum(statename,field,value) {
	const obj={_id:statename,type:"state",common:{},native:{}};
	obj.common.id = statename;
	obj.common.name= "kWh total for last 12 months";
	obj.common.type = "number";
	obj.common.unit = "kWh";
	obj.common.read = true;
	obj.common.write = false;
	obj.common.role = "value";
	await adapter.setObjectNotExistsAsync(statename, obj);
	F.enums(adapter,statename);
	adapter.setStateAsync(statename, {ack: true, val: value});
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
	let states = false, s = {};
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
				states = true;
				s = {};
				for (let ii = 0; ii < o.allowedValues.length; ++ii)
					s[ii] = o.allowedValues[ii];
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
			// w = false;
			break;
		case "yRecording":
			v = o.values;
			o.valIs = "values";
			t = "string";
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

	if (states) {
		c.common.states = s;
		c.common.min = 0;
		c.common.max = o.allowedValues.length - 1;
	}
	if (typeof o.minValue !== "undefined") c.common.min = o.minValue;
	if (typeof o.maxValue !== "undefined") c.common.max = o.maxValue;

	try {
		if (o.state != undefined){
			for (const [key, value] of Object.entries(o.state)) {
				for (let ii in value) {
					v = parseFloat(value[ii]);
					if (v < c.common.min)  c.common.min = v;
					if (v > c.common.max)  c.common.max = v;
				}
			}
		}
	} catch(e) {}

	c.native.km200 = o;
	return c;
}



async function initrecs(r) {

	for (let i=1; i < r.length; i++) {
		if (r[i].type == "yRecording" ) {
			let obj,f;
			let uom = "";
			r[i].uom = "";

			try {
				obj = await adapter.getObjectAsync(r[i].km200);
				f = obj.native.km200.recordedResource.id.substring(1).split("/").join(".");
				obj = await adapter.getObjectAsync(f);
			} catch(e) {
				adapter.log.debug("KM200 can't read recordings reference object: "+f);
			}
			try { uom = obj.native.km200.unitOfMeasure;} catch(e) {
				adapter.log.debug("KM200 can't read uom of reference object: "+f);
			}
			if (uom == "C" || uom == "°C") uom = "°C";
			else uom = "kWh";
			r[i].uom = uom;

			if (db.trim() != "") {
				await adapter.setObjectAsync(r[i].km200+"._Hours",{type: "state",common: {name: "db hourly recordings",type: "number", role: "value", read: true, write: true, unit: uom}, native: {}});
				await adapter.setObjectAsync(r[i].km200+"._Days",{type: "state",common: {name: "db daily recordings",type: "number", role: "value", read: true, write: true, unit: uom}, native: {}});
				await adapter.setObjectAsync(r[i].km200+"._Months",{type: "state",common: {name: "db monthly recordings",type: "number", role: "value", read: true, write: true, unit: uom}, native: {}});
			}

			await adapter.setObjectAsync(r[i].km200+".Hours",{type: "state",common: {name: "recordings hours",type: "json", role: "value", read: true, write: true, unit: uom}, native: {}});
			await adapter.setObjectAsync(r[i].km200+".Days",{type: "state",common: {name: "recordings days",type: "json", role: "value", read: true, write: true, unit: uom}, native: {}});
			await adapter.setObjectAsync(r[i].km200+".Months",{type: "state",common: {name: "recordings months",type: "json", role: "value", read: true, write: true, unit: uom}, native: {}});
		}
	}

	for (let i=1; i < r.length; i++) {
		if (r[i].type == "yRecording" ) {
			enable_state(r[i].km200+"._Hours",0,0);
			enable_state(r[i].km200+"._Days",0,0);
			enable_state(r[i].km200+"._Months",0,0);
		}
	}
}


async function enable_state(stateid,retention,interval) {
	if (unloaded) return;
	const id =  adapter.namespace  + "." + stateid;
	const obj = await adapter.getObjectAsync(stateid);
	try {
		//if (obj.common.custom == undefined) {
		adapter.sendTo(db, "enableHistory", {id: id, options:
				{changesOnly: false,debounce: 0,retention: retention,changesRelogInterval: interval,
					maxLength: 3, changesMinDelta: 0, aliasId: "" } },
		function (result) {
			if (result.error) { adapter.log.error("KM200 enable state error: " + stateid+ "  " + result.error);}
			if (result.success) {}
		});
		//}
	} catch(e) {}
}

const state_change = async function (id,state,obj) {
	if (unloaded) return;
	let value = state.val;
	adapter.log.debug("KM200 write change: "+ id + ": "+value);
	try {
		if(typeof obj.native.km200.allowedValues != "undefined" && obj.native.km200.type == "stringValue" )
			value= obj.native.km200.allowedValues[value];
		const resp = await km200_put(obj.native.ems_km200 , value, obj.native.km200.type);
		if (resp != 200 && resp != 204) adapter.log.warn("KM200 http write error " + resp + ":" + obj.native.ems_km200);
	}
	catch(error) {adapter.log.warn("KM200 http write error "+ error + ":" + obj.native.ems_km200);}
};

async function getsource(db) {
	return new Promise(function(resolve) {
		const query = "select id from " + database + '.sources where name = "system.adapter.ems-esp.' + adapter.instance + '";';
		adapter.sendTo(db, "query", query, function (result) {
			if (result.error  || result.result[0] == null)
			{
				resolve(0);
			} else {
				resolve(result.result[0].id);
			}
		});
	});
}

async function getid(field,db) {
	return new Promise(function(resolve) {
		const query = "select id from " + database + '.datapoints where name = "' + field + '";';
		adapter.sendTo(db, "query", query, function (result,reject) {
			if (result.error || result.result[0] == null)
			{
				resolve(0);
			} else {
				resolve(result.result[0].id);
			}
		});
	});
}

async function sleep(ms) {
	if (unloaded) return;
	return new Promise(resolve => {
		setTimeout(() => !unloaded && resolve(true), ms);
	});
}


const unload = function (u) {unloaded = u;};

module.exports ={init,state_change,unload};