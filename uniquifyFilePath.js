import path from "path";
import fs from "fs";

export function uniquifyFilePath(target_path){
	let path_parts = path.parse(target_path);
	let incrementor_match = path_parts.name.match(/\((\d+)\)$/);
	let incrementor = incrementor_match ? parseInt(incrementor_match[1]) : 1;
	let basename = path_parts.name.replace(/ \(\d+\)$/, '');
	while(fs.existsSync(target_path)){
		incrementor++;
		target_path = `${path_parts.dir}/${basename} (${incrementor})${path_parts.ext}`;
	}
	return target_path;
} 