import fs from "fs";
import path from "path";
import { clickElement } from "./clickElement.js";
import { withTimeout } from "./withTimeout.js";
import { sleep } from "./sleep.js";
import { debug_dir } from "./errorHandler.js";

const countSelected = frame => frame.$$eval('.PhotoItemView.is-selected', els=>els.length);
const isSelected = item=>item.evaluate(el=>el.matches('.is-selected') || !!el.querySelector('.is-selected')).catch(()=>false);

// Thrown when the batch isn't (fully) selected before the download starts. Harmless, so we just select again.
class SelectionLost extends Error {
	constructor(selected, wanted){
		super();
		this.selected = selected;
		this.wanted = wanted;
	}
}

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
		// Start from the top of the grid each time, so the batch is the first photos.
		await frame.evaluate(()=>document.querySelector('.grid-scroll')?.scrollTo(0, 0));
		await sleep(500);
		const items = (await frame.$$('.grid-item')).slice(0, count);
		try{
			await selectOnce(page, frame, items, onStep);
			return items;
		}catch(e){
			if(!(e instanceof SelectionLost)) throw e;
			const problem = e.selected
				? `only ${e.selected} of ${e.wanted} photos got selected`
				: `iCloud cleared the selection`;
			if(attempt >= max_attempts){
				throw new Error(`Couldn't select the batch: ${problem} (${max_attempts} tries). Nothing from this batch was downloaded or deleted.\n${await saveDebugInfo(page, frame, items[0])}`);
			}
			onStep(`${problem}, selecting again (try ${attempt+1} of ${max_attempts})`);
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
	if(state === 'lost') throw new SelectionLost(0, items.length);

	// The download takes whatever is selected, so make sure that's exactly this batch.
	const states = await Promise.all(items.map(isSelected));
	if(!states.every(Boolean) || await countSelected(frame) !== items.length){
		throw new SelectionLost(await countSelected(frame), items.length);
	}
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
 * Whether exactly these grid items, and nothing else, are still selected. iCloud keeps track of the
 * selection itself and Download downloads exactly that selection, so if this is true right before
 * deleting, the delete removes exactly what was downloaded.
 * @param Frame frame The iCloud Photos iframe.
 * @param ElementHandle[] items
 * @returns Promise<bool>
 */
export async function isStillSelected(frame, items){
	const states = await Promise.all(items.map(isSelected));
	return states.every(Boolean) && await countSelected(frame) === items.length;
}
