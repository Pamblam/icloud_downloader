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
	await handle.evaluate(el=>el.scrollIntoView({block: 'nearest', inline: 'nearest'}));
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
