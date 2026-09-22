const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.children = [];
        this.classes = new Set();
        this.classList = {
            add: (...names)=>names.forEach(name=>this.classes.add(name)),
            remove: (...names)=>names.forEach(name=>this.classes.delete(name)),
            contains: (name)=>this.classes.has(name),
        };
        this.offsetWidth = tagName === 'button' ? 44 : 240;
        this.offsetHeight = tagName === 'button' ? 44 : 180;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
    dispatch(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
    setAttribute(name, value) { this.attributes[name] = value; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = undefined; }
    get offsetLeft() { return Number.parseFloat(this.style.left) || 0; }
    get offsetTop() { return Number.parseFloat(this.style.top) || 0; }
    getBoundingClientRect() {
        return {
            left: this.offsetLeft,
            top: this.offsetTop,
            right: this.offsetLeft + this.offsetWidth,
            bottom: this.offsetTop + this.offsetHeight,
        };
    }
}

const elements = [];
const document = {
    body: new Element('body'),
    createElement(tagName) {
        const element = new Element(tagName);
        elements.push(element);
        return element;
    },
};
const mediaListeners = [];
const media = { matches: true, addEventListener: (_name, listener)=>mediaListeners.push(listener) };
const window = {
    innerWidth: 390,
    innerHeight: 844,
    listeners: {},
    matchMedia: ()=>media,
    addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); },
    dispatch(name) { for (const listener of this.listeners[name] ?? []) listener(); },
};
const extension_settings = {};
let saves = 0;
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
vm.runInNewContext(source, {
    document,
    window,
    extension_settings,
    saveSettingsDebounced: ()=>saves++,
    eventSource: { on: ()=>{} },
    event_types: { GENERATION_STARTED: 'generation', WORLD_INFO_ACTIVATED: 'world-info' },
    SlashCommandParser: { addCommandObject: ()=>{} },
    SlashCommand: { fromProps: value=>value },
    setTimeout,
    clearTimeout,
    console,
});

const trigger = elements.find(element=>element.classList.contains('stwii--trigger'));
const panel = elements.find(element=>element.id === 'stwii--active-panel');
const configPanel = elements.find(element=>element !== panel && element.classList.contains('stwii--panel'));
assert.equal(trigger.offsetLeft, 338, 'mobile default starts on the right');
assert.ok(trigger.offsetTop > 250 && trigger.offsetTop < 400, 'mobile default avoids the composer');

const pointer = (x, y)=>({ button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
trigger.dispatch('pointerdown', pointer(350, 350));
trigger.dispatch('pointermove', pointer(120, 300));
trigger.dispatch('pointerup', pointer(120, 300));
trigger.dispatch('click');
assert.equal(panel.classList.contains('stwii--isActive'), false, 'drag must not open the panel');
assert.equal(saves, 1, 'drag persists the new location');
assert.ok(extension_settings.worldInfoInfo.triggerPositions.mobile.x < 0.5);

trigger.dispatch('click');
assert.equal(panel.classList.contains('stwii--isActive'), true, 'tap opens the panel');
assert.equal(trigger.attributes['aria-expanded'], 'true');
assert.ok(Number.parseFloat(panel.style.left) >= 8, 'panel stays on screen');
const options = elements.find(element=>element.classList.contains('stwii--options'));
options.dispatch('click');
assert.equal(configPanel.classList.contains('stwii--isActive'), true, 'gear opens mobile-accessible options');
assert.equal(panel.classList.contains('stwii--isActive'), false);

trigger.dispatch('pointerdown', pointer(120, 300));
trigger.dispatch('contextmenu', { preventDefault() {} });
trigger.dispatch('pointerup', pointer(120, 300));
trigger.dispatch('click');
assert.equal(configPanel.classList.contains('stwii--isActive'), false, 'touch context menu opens or closes options only once');
assert.equal(panel.classList.contains('stwii--isActive'), false, 'long press does not also open entries');

window.innerWidth = 260;
window.innerHeight = 420;
window.dispatch('resize');
assert.ok(trigger.offsetLeft >= 8 && trigger.offsetLeft + trigger.offsetWidth <= 252);
assert.ok(trigger.offsetTop >= 8 && trigger.offsetTop + trigger.offsetHeight <= 412);

media.matches = false;
mediaListeners.forEach(listener=>listener());
assert.equal(trigger.offsetLeft, 8, 'desktop has a separate left-side default');
assert.equal(trigger.offsetTop, 368, 'desktop retains its bottom-side default');
console.log('Floating trigger interactions OK');
