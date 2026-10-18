/**
 * If iCloud Photos is showing an alert dialog (e.g. "Unable to Delete Items ... server error"),
 * click its OK button and return its text. Returns null if there's no alert.
 * @param Frame frame The iCloud Photos iframe.
 * @returns Promise<string|null>
 */
export async function dismissAlert(frame){
	return frame.evaluate(()=>{
		const pane = document.querySelector('ui-pane.PhotosAlert, ui-pane.for-ui-alert');
		if(!pane) return null;
		const buttons = [...pane.querySelectorAll('button, ui-button, [role="button"]')];
		// The message without the buttons' labels.
		const message = pane.cloneNode(true);
		message.querySelectorAll('button, ui-button, [role="button"]').forEach(b=>b.remove());
		const text = [...message.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>e.textContent.trim()).filter(Boolean).join(' ')
			|| message.textContent.replace(/\s+/g, ' ').trim();
		const ok = buttons.find(b=>/^(ok|close|dismiss)$/i.test(b.innerText.trim())) || buttons[buttons.length - 1];
		if(ok) ok.click();
		return text || 'iCloud showed an alert';
	}).catch(()=>null);
}
