let adapter;

const enums = async function(a,id) {
	adapter = a;
	const name = "ems-esp."+adapter.instance+"."+id;

	// search for old enum room attributes and delete it
	let res = await adapter.getEnumsAsync("rooms");
	let _result = res["enum.rooms"];
	for ( const room in _result) {
		for (const i in _result[room].common.members) {
			if (_result[room].common.members[i] == name && room != adapter.config.room){
				//adapter.log.info(name+"    "+i+ "   "+ room);
				_result[room].common.members.splice(i,1);
				await adapter.setForeignObjectAsync(room,_result[room]);
			}
		}
	}

	// search for old enum function attributes and delete it
	res = await adapter.getEnumsAsync("functions");
	_result = res["enum.functions"];
	for ( const func in _result) {
		for (const i in _result[func].common.members) {

			if (_result[func].common.members[i] == name && func != adapter.config.function){
				//adapter.log.info(name+"    "+i+ "   "+ func);
				_result[func].common.members.splice(i,1);
				await adapter.setForeignObjectAsync(func,_result[func]);
			}
		}
	}


	// add enums room and function attributes
	if (adapter.config.room != "" ) enum_add(adapter.config.room, name);
	if (adapter.config.function != "" )enum_add(adapter.config.function,name);
};


async function enum_add(enumName,id) {
	const enumn = enumName;
	try {
		const obj = await adapter.getForeignObjectAsync(enumn);
		let found = false;
		for (let i=0;i<obj.common.members.length;i++) {
			if (obj.common.members[i] == id) {found = true;break;}
		}

		if (!found) {
			obj.common.members.push(id);
			await adapter.setForeignObjectAsync(enumn,obj);
		}
	// eslint-disable-next-line no-empty
	} catch(e) {}
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