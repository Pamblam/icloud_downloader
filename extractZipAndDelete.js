import AdmZip from "adm-zip";
import {uniquifyFilePath} from './uniquifyFilePath.js';
import fs from "fs";
import path from "path";

export function extractZipAndDelete(zip_source, destination_path, callback){
	const zip = new AdmZip(zip_source);
	var zipEntries = zip.getEntries();
	for(let i=0; i<zipEntries.length; i++){
		let dest = uniquifyFilePath(`${destination_path}/${zipEntries[i].name}`);
		let dest_dir = path.dirname(dest);
		let dest_name = path.basename(dest);
		zip.extractEntryTo(zipEntries[i].entryName, dest_dir, false, false, false, dest_name);
		callback(zipEntries[i].name);
	}
	fs.unlinkSync(zip_source);
}