import fs from "fs";
import path from "path";
import { clickElement } from "./clickElement.js";
import { withTimeout } from "./withTimeout.js";
import { sleep } from "./sleep.js";
import { debug_dir } from "./errorHandler.js";

const countSelected = frame => frame.$$eval('.PhotoItemView.is-selected', els=>els.length);
const isSelected = item=>item.evaluate(el=>el.matches('.is-selected') || !!el.querySelector('.is-selected')).catch(()=>false);

// Thrown when iCloud clears the selection before the download starts. Harmless, so we just select again.
class SelectionLost extends Error {}

async function shiftClickEach(page, items, click){
	await page.keyboard.down('Shift');
	try{
		for(const item of items){
			// Shift-clicking an already selected item would deselect it.
			if(await isSelected(item)) continue;
			await click(item);
			await sleep(500);
		}
	}finally{
		await page.keyboard.up('Shift');
	}
	await sleep(500);
}

/**
 * Wait until the photo grid stops moving (e.g. while iCloud shuffles items up after a delete), since
 * iCloud tends to clear any selection made while it's still re-arranging. Gives up after timeout ms.
 */
export async function waitForGridToSettle(frame, timeout = 15000){
	const layout = ()=>frame.$$eval('.grid-item', els=>els.length + '|' + els.slice(0, 30).map(e=>e.style.transform + e.innerHTML.length).join(',')).catch(()=>null);
	const started = Date.now();
	let last = await layout(), stable_for = 0;
	while(stable_for < 3 && Date.now() - started < timeout){
		await sleep(500);
		const now = await layout();
		stable_for = now === last ? stable_for + 1 : 0;
		last = now;
	}
}

/**
 * Shift-click the first `count` grid items and wait until they're selected and loaded. If iCloud
 * clears the selection along the way (nothing has been downloaded yet, so that's harmless), wait for
 * the grid to settle and select again, up to 3 times. If clicking doesn't select anything at all,
 * save details to debug/ (the error handler saves a screenshot) and throw an error describing what went wrong.
 * @param Page page
 * @param Frame frame The iCloud Photos iframe.
 * @param int count
 * @param function onStep Called with a description of what's happening.
 * @returns Promise<ElementHandle[]> The selected grid items.
 */
export async function selectGridItems(page, frame, count, onStep){
	const max_attempts = 3;
	for(let attempt=1; ; attempt++){
		const items = (await frame.$$('.grid-item')).slice(0, count);
		try{
			await selectOnce(page, frame, items, onStep);
			return items;
		}catch(e){
			if(!(e instanceof SelectionLost)) throw e;
			if(attempt >= max_attempts){
				throw new Error(`iCloud kept clearing the selection before the download could start (${max_attempts} tries). Nothing from this batch was downloaded or deleted.\n${await saveDebugInfo(page, frame, items[0])}`);
			}
			onStep(`iCloud cleared the selection, selecting again (try ${attempt+1} of ${max_attempts})`);
			await waitForGridToSettle(frame);
		}
	}
}

async function selectOnce(page, frame, items, onStep){
	await shiftClickEach(page, items, item=>clickElement(page, item));

	if(!await countSelected(frame)){
		onStep('selection didn\'t register, retrying');
		await shiftClickEach(page, items, item=>withTimeout(item.click(), 15000));
		if(!await countSelected(frame)){
			throw new Error(`Clicking the photos didn't select them.\n${await saveDebugInfo(page, frame, items[0])}`);
		}
	}

	// Wait for the .has-asset class to indicate that the items are loaded, noticing if the selection is lost meanwhile.
	onStep(`waiting for the ${items.length} selected items to load`);
	let state;
	try{
		state = await (await frame.waitForFunction(()=>{
			if(!document.querySelector('.PhotoItemView.is-selected')) return 'lost';
			return document.querySelector('.PhotoItemView.is-selected.has-asset') ? 'loaded' : false;
		}, {timeout: 60000})).jsonValue();
	}catch(e){
		throw new Error(`${await countSelected(frame)} items were selected but never finished loading.\n${await saveDebugInfo(page, frame, items[0])}`);
	}
	if(state === 'lost') throw new SelectionLost();

	// The download takes whatever is selected, so make sure that's exactly this batch.
	const states = await Promise.all(items.map(isSelected));
	if(!states.every(Boolean) || await countSelected(frame) !== items.length) throw new SelectionLost();
}

/**
 * Save a description of the first grid item and what's under it.
 * @returns Promise<string> A summary to print.
 */
async function saveDebugInfo(page, frame, item){
	const info = {url: page.url(), viewport: page.viewport()};
	try{
		info.box = await item.boundingBox();
		info.item = await item.evaluate(el=>{
			const describe = e=>e ? `<${e.tagName.toLowerCase()} class="${e.className}">` : null;
			const rect = el.getBoundingClientRect();
			// What would actually receive a click at the item's center (e.g. an overlay or dialog).
			const at_center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
			return {
				element: describe(el),
				child: describe(el.querySelector('.PhotoItemView')),
				at_center: describe(at_center),
				center_is_inside_item: el.contains(at_center),
				dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, .sheet')].map(describe),
			};
		});
		if(info.box){
			// What the mouse hits at the main-page level; should be the Photos iframe.
			info.page_at_click = await page.evaluate(({x, y})=>{
				const e = document.elementFromPoint(x, y);
				return e ? `<${e.tagName.toLowerCase()} class="${e.className}">` : null;
			}, {x: info.box.x + info.box.width / 2, y: info.box.y + info.box.height / 2});
		}
	}catch(e){
		info.error = e.message;
	}

	fs.mkdirSync(debug_dir, {recursive: true});
	const stamp = new Date().toISOString().replaceAll(':', '-');
	const info_path = path.join(debug_dir, `${stamp}.json`);
	fs.writeFileSync(info_path, JSON.stringify(info, null, '\t'));

	return `Debug info (also saved to ${info_path}):\n${JSON.stringify(info, null, 2)}`;
}

/**
 * Describe which photo each grid item is showing: its image URLs (without query strings, which can
 * change as better thumbnails load) and its text labels (without words about selection/focus state).
 * Also keeps every raw attribute, only for debug output. Used to make sure we only delete what we downloaded.
 * @param ElementHandle[] items
 * @returns Promise<object[]> {images, labels, raw}, or null for an item that's no longer on the page.
 */
export async function fingerprintItems(items){
	return Promise.all(items.map(item=>item.evaluate(el=>{
		if(!el.isConnected) return null;
		const images = new Set(), labels = new Set(), raw = [];
		const addImage = url=>{
			url = url.trim().split(/\s+/)[0].replace(/[?#].*$/, '');
			if(url) images.add(url);
		};
		for(const e of [el, ...el.querySelectorAll('*')]){
			for(const attr of e.attributes){
				raw.push(`${e.tagName.toLowerCase()}.${attr.name}=${attr.value}`);
				if(attr.name === 'src') addImage(attr.value);
				if(attr.name === 'srcset') attr.value.split(',').forEach(addImage);
				if(['aria-label', 'title', 'alt'].includes(attr.name)){
					const label = attr.value.replace(/\b(not )?(selected|focused|checked|highlighted)\b/gi, '').replace(/[\s,]+/g, ' ').trim();
					if(label) labels.add(label);
				}
			}
			const bg = e.style?.backgroundImage?.match(/url\(["']?([^"')]+)/);
			if(bg) addImage(bg[1]);
		}
		return {images: [...images], labels: [...labels].sort(), raw};
	}).catch(()=>null)));
}

/**
 * Whether two fingerprints are the same photo: they share an image URL, or have the same labels.
 */
function samePhoto(before, now){
	if(!before || !now) return false;
	if(before.images.some(url=>now.images.includes(url))) return true;
	return before.labels.length > 0 && before.labels.join('|') === now.labels.join('|');
}

/**
 * Wait (up to timeout ms) for the thumbnails of the selected items to load, so fingerprintItems() has
 * an image to identify each one by. They often haven't loaded yet when the items are first selected.
 */
export async function waitForThumbnails(frame, count, timeout = 15000){
	try{
		await frame.waitForFunction(
			n=>document.querySelectorAll('.PhotoItemView.is-selected img[src]').length >= n,
			{timeout}, count
		);
	}catch(e){} // Without thumbnails we just can't reselect safely if iCloud drops the selection.
}

/**
 * Before deleting, make sure exactly the items we downloaded are selected. iCloud sometimes drops the
 * selection while the download is running; if so, reselect them, but only if we can confirm they're
 * still the same photos. Throws (without deleting anything) if that can't be confirmed.
 * @param ElementHandle[] items The grid items that were downloaded.
 * @param string[] fingerprints fingerprintItems(items) from when they were downloaded.
 */
export async function ensureSelectedForDelete(page, frame, items, fingerprints, onStep){
	const cant_delete = reason=>new Error(`${reason} To be safe, nothing from this batch was deleted from iCloud. The files were already saved; the next run will download them again and skip them as duplicates.`);

	const checkSameItems = async ()=>{
		const now = await fingerprintItems(items);
		const mismatched = fingerprints.map((f, i)=>i).filter(i=>!samePhoto(fingerprints[i], now[i]));
		if(mismatched.length){
			const info_path = saveFingerprintDiff(mismatched.map(i=>({item: i+1, before: fingerprints[i], now: now[i]})));
			throw cant_delete(`iCloud lost the selection, and the script can't confirm that item ${mismatched.map(i=>i+1).join(', ')} of the batch still show the photos it downloaded, so it won't reselect them. Details saved to ${info_path}.`);
		}
	};

	// iCloud keeps track of the selection itself, and Download downloaded exactly that selection. If
	// it's all still selected, it's the photos we downloaded, however the tiles have re-rendered since.
	let states = await Promise.all(items.map(isSelected));
	if(states.every(Boolean) && await countSelected(frame) === items.length) return;

	if(await countSelected(frame) > states.filter(Boolean).length){
		throw cant_delete(`Photos other than the ones just downloaded are selected.`);
	}

	// The selection was (partly) lost. Only reselect if we can confirm the tiles still show the same photos.
	await checkSameItems();

	onStep('iCloud lost the selection, reselecting the downloaded items');
	await page.keyboard.down('Shift');
	try{
		for(let i=0; i<items.length; i++){
			if(states[i]) continue;
			await clickElement(page, items[i]);
			await sleep(500);
		}
	}finally{
		await page.keyboard.up('Shift');
	}
	await sleep(500);

	await checkSameItems();
	states = await Promise.all(items.map(isSelected));
	if(!states.every(Boolean) || await countSelected(frame) !== items.length){
		throw cant_delete(`iCloud lost the selection and reselecting the downloaded photos didn't work.`);
	}
}

function saveFingerprintDiff(diffs){
	fs.mkdirSync(debug_dir, {recursive: true});
	const info_path = path.join(debug_dir, `${new Date().toISOString().replaceAll(':', '-')}-grid-changed.json`);
	fs.writeFileSync(info_path, JSON.stringify(diffs, null, '\t'));
	return info_path;
}
