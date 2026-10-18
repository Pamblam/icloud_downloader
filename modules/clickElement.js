import { sleep } from "./sleep.js";

/**
 * Move the mouse to the center of an element (in any frame) without using ElementHandle.hover()/click().
 * Those wait on an IntersectionObserver, which never fires in headless mode or in a backgrounded
 * frame, and hang until Runtime.callFunctionOn times out.
 * @param Page page
 * @param ElementHandle handle
 * @returns Promise<{x, y}>
 */
export async function hoverElement(page, handle){
	// If the element's center is off screen or covered (e.g. by a sticky header the grid scrolled
	// under), scroll it to the middle so the click actually lands on it.
	const scrolled = await handle.evaluate(el=>{
		const reachable = ()=>{
			const r = el.getBoundingClientRect();
			const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return !!hit && (hit === el || el.contains(hit));
		};
		if(reachable()) return false;
		el.scrollIntoView({block: 'center', inline: 'center'});
		return true;
	});
	if(scrolled) await sleep(200); // Let the grid render after scrolling.
	const box = await handle.boundingBox();
	if(!box) throw new Error('Element is not visible, unable to click it.');
	const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
	await page.mouse.move(point.x, point.y);
	return point;
}

/**
 * Click an element with real mouse events, so held keys (e.g. Shift) still apply.
 * @param Page page
 * @param ElementHandle handle
 */
export async function clickElement(page, handle){
	const {x, y} = await hoverElement(page, handle);
	await sleep(50);
	await page.mouse.click(x, y);
}
