import unzip from 'unzip-stream';
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uniquifyFilePath } from './uniquifyFilePath.js';

/**
 * Extract every file in the zip at src into the dest folder. If an identical file is already there
 * (e.g. it was downloaded by an earlier run that crashed before deleting it from iCloud), skip it.
 * A different file with the same name gets a " (2)" etc. added to its name.
 * @param string src
 * @param string dest
 * @param function onEach Called with (path, skipped) for each file; path is the existing copy when skipped.
 * @returns Promise<string[]>
 */
export function processArchive(src, dest, onEach) {
	return new Promise((resolve, reject)=>{
		let promises = [];
		let entry_count = 0;
		// Decide on and move files into place one at a time, so two files with the same name in one
		// zip can't both claim the same destination (or skip-check against a half-moved file).
		let finalize_queue = Promise.resolve();
		fs.createReadStream(src)
			.pipe(unzip.Parse())
			.on('error', reject)
			.on('finish', async ()=>{
				try{
					resolve(await Promise.all(promises));
				}catch(e){
					reject(e);
				}
			})
			.on('entry', function (entry) {
				// Folders in the zip aren't files to save.
				if(entry.type === 'Directory'){
					entry.autodrain();
					return;
				}
				promises.push(new Promise((entryComplete, entryFailed)=>{
					let filename = path.basename(entry.path);
					let target_path = path.join(dest, filename);
					// Write to a hidden temp file next to the destination, then decide whether to keep it.
					// Numbered, since a zip can contain more than one file with the same name.
					let temp_path = path.join(dest, `.${filename}.${process.pid}-${++entry_count}.icloud-downloader-partial`);
					entry.pipe(fs.createWriteStream(temp_path)).on('finish', ()=>{
						entry.autodrain();
						finalize_queue = finalize_queue.then(async ()=>{
							let existing = await findIdenticalFile(temp_path, target_path);
							let final_path;
							if(existing){
								fs.unlinkSync(temp_path);
								final_path = existing;
							}else{
								final_path = uniquifyFilePath(target_path);
								fs.renameSync(temp_path, final_path);
							}
							if(onEach) onEach(final_path, !!existing);
							entryComplete(final_path);
						}).catch(e=>{
							try{ fs.unlinkSync(temp_path); }catch(_){}
							entryFailed(e);
						});
					}).on('error', entryFailed);
				}));
			});
	});
}

/**
 * Look for a file identical to new_path at target_path or its " (2)", " (3)"... variants.
 * @returns Promise<string|null> The identical file's path, or null.
 */
async function findIdenticalFile(new_path, target_path){
	const {dir, name, ext} = path.parse(target_path);
	const size = fs.statSync(new_path).size;
	let new_hash = null;

	// uniquifyFilePath numbers copies from 2 up, so stop at the first number that doesn't exist.
	for(let i=1; ; i++){
		const candidate = i === 1 ? target_path : path.join(dir, `${name} (${i})${ext}`);
		if(!fs.existsSync(candidate)){
			if(i === 1) continue; // The original may have been removed while copies remain.
			return null;
		}
		if(fs.statSync(candidate).size !== size) continue;
		new_hash ??= await hashFile(new_path);
		if(await hashFile(candidate) === new_hash) return candidate;
	}
}

function hashFile(file_path){
	return new Promise((resolve, reject)=>{
		const hash = crypto.createHash('sha256');
		fs.createReadStream(file_path)
			.on('error', reject)
			.on('data', chunk=>hash.update(chunk))
			.on('end', ()=>resolve(hash.digest('hex')));
	});
}
