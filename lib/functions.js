let adapter;

const enums = async function(a,id) {
	adapter = a;
	// add enums room and function
	enum_add("rooms."+adapter.config.room,"ems-esp."+adapter.instance+"."+id);
	enum_add("functions."+adapter.config.function,"ems-esp."+adapter.instance+"."+id);
};


async function enum_add(enumName,id) {
	const enumn = "enum"+"."+enumName;
	const obj = await adapter.getForeignObjectAsync(enumn);
	let found = false;
	try {
		for (let i=0;i<obj.common.members.length;i++) {
			if (obj.common.members[i] == id) {found = true;break;}
		}
	// eslint-disable-next-line no-empty
	} catch(e) {}
	//adapter.log.info(enumn+ "  "+ id + " "+ JSON.stringify(obj.common.members));
	if (!found) {
		try {
			obj.common.members.push(id);
			await adapter.setForeignObjectAsync(enumn,obj);
		// eslint-disable-next-line no-empty
		}catch(e) {}
	}
}

const roles = function(a,device,type,uom,writable) {
	adapter = a;
	let role = "value"; if (writable == true) role = "level";
	if (uom == "°C" || uom == "C") role += ".temperature";

	if(type == "boolean" && writable == true) role = "switch.mode";
	if(type == "boolean" && writable == false) role = "indicator";
	return role;
};


module.exports ={enums,roles};