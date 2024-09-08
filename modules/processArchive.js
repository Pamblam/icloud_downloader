import unzip from 'unzip-stream';
import fs from "fs";
import path from "path";
import { uniquifyFilePath } from './uniquifyFilePath.js';

export function processArchive(src, dest, onEach) {
	return new Promise(resolve=>{
		let promises = [];
		fs.createReadStream(src)
			.pipe(unzip.Parse())
			.on('finish', async ()=>{
				let extracted = await Promise.all(promises);
				resolve(extracted);
			})
			.on('entry', function (entry) {
				promises.push(new Promise(entryComplete=>{
					let filename = path.basename(entry.path);
					let dest_path = uniquifyFilePath(path.join(dest, filename));
					entry.pipe(fs.createWriteStream(dest_path)).on('finish', ()=>{
						entry.autodrain();
						if(onEach) onEach(dest_path);
						entryComplete(dest_path);
					});
				}));
			});
	});
}