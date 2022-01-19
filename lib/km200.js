const Rijndael = require("rijndael-js");
const crypto = require("crypto");
const fs = require("fs");
const request = require("request");

const km200_crypt_md5_salt = new Uint8Array([
	0x86, 0x78, 0x45, 0xe9, 0x7c, 0x4e, 0x29, 0xdc,
	0xe5, 0x22, 0xb9, 0xa7, 0xd3, 0xa3, 0xe0, 0x7b,
	0x15, 0x2b, 0xff, 0xad, 0xdd, 0xbe, 0xd7, 0xf5,
	0xff, 0xd8, 0x42, 0xe9, 0x89, 0x5a, 0xd1, 0xe4
]);
let datafields = [];
let km200_server,km200_gatewaypassword,km200_privatepassword,km200_key,km200_aeskey,cipher, km200_polling = 300;

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
let db = "sql.0", recordings=false;

let sum_month = 0, sum_month_dhw = 0;

// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Startup / Initialisation:

let unloaded = false;

let adapter;
const init = async function(a,u,i) {
	adapter = a;
	utils = u;
	aliveState =  "system.adapter."+adapter.namespace + ".alive";

	km200_server = adapter.config.km200_ip;
	if (km200_server.substr(0,7) != "http://") km200_server = "http://" + km200_server;

	km200_polling = adapter.config.km200_polling;
	if (km200_polling < 90) km200_polling = 90;
	km200_gatewaypassword = adapter.config.gateway_pw;
	km200_privatepassword = adapter.config.private_pw;
	recordings = adapter.config.recordings;
	db = adapter.config.database_instance;

	try {
		const o = await adapter.getForeignObjectAsync("system.config");
		km200_privatepassword = decrypt(o.native.secret, km200_privatepassword);}
	catch (e) {adapter.log.error("error reading secret from system.config");}
	km200_key = km200_getAccesskey(km200_gatewaypassword,km200_privatepassword);
	km200_aeskey = Buffer.from(km200_key,"hex");
	cipher = new Rijndael(km200_aeskey, "ecb");

	// -------------------------------------------------------------------------------------------------------------------------------------------------------------------
	// Read csv-file:
	const dataDir = utils.getAbsoluteDefaultDataDir(); // /opt/iobroker/iobroker-data
	await fs.promises.mkdir(dataDir+"/ems-esp/"+adapter.instance, { recursive: true });

	const fn = dataDir+"/ems-esp/"+adapter.instance+"/"+adapter.config.control_file;
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
		const fnw = dataDir+"/ems-esp/"+adapter.instance+"/km200.csv";
		write_file(fnw,datafields);
		await init_states_km200(datafields);
	}
	
	if (!unloaded) {
		adapter.log.info("km200:"+adapter.config.km200_active + " " + km200_polling + " secs");
		i.km200 = setInterval(function() {km200_read(datafields);}, km200_polling*1000); // 90 sec
	}

	if (adapter.config.recordings && !unloaded) {
		await initrecs();
		await km200_recordings();
		adapter.log.info("recordings:"+adapter.config.recordings+" hour");
		i.recordings = setInterval(function() {km200_recordings();}, 3600000); // 1 hour = 3600 secs
	}
	return i;
};

function decrypt(key, value) {
	let result = "";
	for (let i = 0; i < value.length; ++i) {
	 result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
	}
	return result;
}


async function init_states_km200(datafields) {
	if (unloaded) return;
	adapter.log.info("start initializing km200 states");
	for (let i=1; i < datafields.length; i++) {
		if (unloaded) break;
		const r = datafields[i];
		//adapter.log.info(JSON.stringify(r));
		if (r.ems_field !== "" && r.ems_device !=="") {	}
		else {
			if (r.km200 !== "") {
				let o;
				try {o = await km200_get(r.km200);}
				catch(error) {adapter.log.warn("http km200 datafield not existing:"+r.km200);}
				if (o != undefined) {
					try {
						const obj1 = km200_obj(r.km200,o);
						obj1._id = r.km200;
						obj1.common.name= "km200:"+r.km200;
						//obj1.native.source = "km200";
						obj1.native.ems_km200 = r.km200;
						await adapter.setObjectNotExistsAsync(obj1._id, obj1);
						let val = o.value;
						if (o.type == "stringValue" && o.allowedValues != undefined){val = o.allowedValues.indexOf(o.value);}
						if (o.type == "switchProgram" && o.switchPoints != undefined){val = JSON.stringify(o.switchPoints);}
						if (o.type == "arrayData" && o.values != undefined){val = JSON.stringify(o.values);}
						//await adapter.setStateChangedAsync(r.km200, {ack: true, val: val});
						adapter.setState(r.km200, {ack: true, val: val});
					}
					catch (error) {
						adapter.log.info("initializing km200 states interrupted");
						unloaded = true;
						    break;
					}
				}


			}
		}
	}
	adapter.log.info("end of initializing km200 states");
}

async function km200_read(result){
	if (unloaded) return;
	const t1 = new Date().getTime();
	for (let i=1; i < result.length; i++) {
		if (unloaded) break;
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

					if (!unloaded) await adapter.setStateChangedAsync(result[i].km200, {ack: true, val: val});
				}
				catch(error) {
					adapter.log.warn("km200 read interrupted");
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
		adapter.setState("statistics.km200-read", {ack: true, val: t3});
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
	if (unloaded) return;
	adapter.log.info("start reading km200 data-structure");
	const results = [];
	results.push({"km200":"","ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});

	await tree("heatSources");
	await tree("dhwCircuits");
	await tree("heatingCircuits");
	await tree("system");
	await tree("notifications");
	await tree("gateway");
	await tree("solarCircuits");

	const c = results.length - 1;

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
			if (data1 != "" && data1 != undefined) {
				if (data1.type != "refEnum") {
					element=data1.id.substring(1).split("/").join(".");
					results.push({"km200":element,"ems_device_new":"","ems_device":"","ems_id":"","ems_field":""});
				}
				else {await refEnum(data1);}
			}
		}
	}

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
	request.put({headers: {"Accept": '"application/json',"User-Agent": "TeleHeater/2.2.3"},url: urls, body: data},
		function(error, response){
			if (error) {return reject(error);}
			resolve(response);});
});
}



function km200_decrypt(input) {
	// Decrypt
	let output;
	try {
		let s = Buffer.from(cipher.decrypt(Buffer.from(input,"base64"),16)).toString("utf8");
		while (s.charCodeAt(s.length - 1) === 0) s = s.slice(0, s.length - 1);
		output = JSON.parse(s);
	} catch(e) {}
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

async function km200_recordings(){
	const adapt = adapter.namespace+".";
	if (!unloaded) await hours();
	if (!unloaded) await days();
	if (!unloaded) await months();
	sum_month = 0;
	sum_month_dhw = 0;
}

async function recsw(field,d) {
	if (db.substring(0,3) == "sql" ) {
		await adapter.sendToAsync(db, "deleteAll", {id: field});
		await sleep(2000);
	} else {
		//await adapter.sendToAsync(db,"DELETE FROM '"+adapter.namespace+"."+field + "'"); // only Influxdb < V2
		//await sleep(1000);
	}

	for (let i = 0; i < d.length;i++){
		try {adapter.sendTo(db,"storeState", d[i]);}
		catch(e) {}
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

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60 / data.recording[ii].c;
					let wert = data.recording[ii].y * multi;
					wert = Math.round(wert / 6) / 10;
					const ts = ut1 + ((ii+1) * 3600000 );
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});

				}
			}
		}
		datum.setDate(datum.getDate() - 1); 
	}
	await recsw(field,daten);

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

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60 / data.recording[ii].c;
					let wert = data.recording[ii].y * multi;
					wert = Math.round(wert / 6) / 10;
					const ts = ut1 + ((ii+1) * 3600000 );
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		datum.setDate(datum.getDate() - 1);
	}
	await recsw(field,daten);
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

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii].c != 0){
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60*24 / data.recording[ii].c;

					if (i == 0 && ii < data.recording.length -2) {
						if (data.recording[ii+1].c == 0) multi = 1;
					}
					if (i == 0 && ii == data.recording.length -1) multi = 1;

					let wert = data.recording[ii].y * multi;
					if (i==0) sum_month += wert;

					wert = Math.round(wert / 6) / 10;
					const ts = ut1 + 60000 + (ii * 3600000 * 24);
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		if (monat == 1) {jahr = jahr-1;monat=12;}
		else if (monat > 1) {monat = monat-1;}
	}
	await recsw(field,daten);

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

			const ut1 = new Date(data.interval).getTime();
			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii].c != 0){
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60*24 / data.recording[ii].c;

					if (i == 0 && ii < data.recording.length -2) {
						if (data.recording[ii+1].c == 0) multi = 1;
					}
					if (i == 0 && ii == data.recording.length -1) multi = 1;

					let wert = data.recording[ii].y * multi;
					if (i==0) sum_month_dhw += wert;
					wert = Math.round(wert / 6) / 10;
					
					const ts = ut1 + 60000 + (ii * 3600000 * 24);
					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		if (monat == 1) {jahr = jahr-1;monat=12;}
		else if (monat > 1) {monat = monat-1;}
	}
	await recsw(field,daten);
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

			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){
					const m = ii+1;
					const t = jahr + "-" + m.toString() +"-15" ;
					const ts = new Date(t).getTime();

					const days = new Date(jahr, m, 0).getDate();
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60*24*days / data.recording[ii].c;
	
					if (i == 0 && ii < data.recording.length -2) {
						if (data.recording[ii+1].c == 0) {
							multi = 1;
							data.recording[ii].y = sum_month;
						}
					}
					if (i == 0 && ii == data.recording.length -1) {
						multi = 1;
						data.recording[ii].y = sum_month;
					}

					let wert = data.recording[ii].y * multi;
					wert = Math.round(wert / 6) / 10;
					if(jahr == ja && m < ma ) sum+=wert;
					if(jahr == ja-1 && m >= ma ) sum+=wert;

					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		jahr = jahr-1;
	}
	await recsw(field,daten);
	sum = Math.round(sum) ;
	adapter.setState(root+avg12m, {ack: true, val: sum});

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

			for (let ii = 0; ii < data.recording.length; ii++){
				if (data.recording[ii] !== null){

					const m = ii+1;
					const t = jahr + "-" + m.toString() +"-15" ;

					const ts = new Date(t).getTime();

					const days = new Date(jahr, m, 0).getDate();
					let multi = 1;
					if (data.recording[ii].c > 0) multi = 60*24*days / data.recording[ii].c;
					
					if (i == 0 && ii < data.recording.length -2) {
						if (data.recording[ii+1].c == 0) {
							multi = 1;
							data.recording[ii].y = sum_month_dhw;
						}
					}
					if (i == 0 && ii == data.recording.length -1) {
						multi = 1;
						data.recording[ii].y = sum_month_dhw;
					}

					let wert = data.recording[ii].y * multi;
					wert = Math.round(wert / 6) / 10;
					if(jahr == ja && m < ma ) sum+=wert;
					if(jahr == ja-1 && m >= ma ) sum+=wert;

					daten.push({id: field,state: {ts: + ts ,val: wert,ack: true}});
				}
			}
		}
		jahr = jahr-1;
	}
	await recsw(field,daten);
	sum = Math.round(sum/12) ;
	adapter.setState(root+avg12mdhw, {ack: true, val: sum});
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

async function initrecs() {
	await adapter.setObjectNotExistsAsync(root+"created",{type: "state",common: {type: "boolean", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+hh,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+hhdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+dd,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+dddhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+mm,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+mmdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+avg12m,{type: "state",common: {type: "number", read: true, write: true}, native: {}});
	await adapter.setObjectNotExistsAsync(root+avg12mdhw,{type: "state",common: {type: "number", read: true, write: true}, native: {}});

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

function enable_state(stateid,retention,interval) {
	if (unloaded) return;
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

const state_change = async function (id,state,obj) {
	if (unloaded) return;
	let value = state.val;
	adapter.log.info("write change to km200: "+ id + ": "+value);
	try {
		if(typeof obj.native.km200.allowedValues != "undefined" && obj.native.km200.type == "stringValue" )
			value= obj.native.km200.allowedValues[value];
		const resp = await km200_put(obj.native.ems_km200 , value, obj.native.km200.type);
		if (resp.statusCode != 200 && resp.statusCode != 204) {
			adapter.log.warn("km200 http write error " + resp.statusCode + ":" + obj.native.ems_km200);
		}
	}
	catch(error) {adapter.log.warn("km200 http write error "+ error + ":" + obj.native.ems_km200);}
};


async function sleep(ms) {
	return new Promise(resolve => {
		setTimeout(() => !unloaded && resolve(), ms);
	});
}

const unload = function (u) {unloaded = u;};

module.exports ={init,state_change,unload};