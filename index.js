import { chat, chat_metadata, event_types, eventSource, main_api, saveSettingsDebounced } from '../../../../script.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings } from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { delay } from '../../../utils.js';
import { world_info_position } from '../../../world-info.js';

const strategy = {
    constant: '🔵',
    normal: '🟢',
    vectorized: '🔗',
};
const getStrategy = (entry)=>{
    if (entry.constant === true) {
        return 'constant';
    } else if (entry.vectorized === true) {
        return 'vectorized';
    } else {
        return 'normal';
    }
};

let generationType;
eventSource.on(event_types.GENERATION_STARTED, (genType)=>generationType = genType);

const init = ()=>{
    const trigger = document.createElement('button'); {
        trigger.type = 'button';
        trigger.classList.add('stwii--trigger');
        trigger.classList.add('fa-solid', 'fa-fw', 'fa-book-atlas');
        trigger.title = 'Active WI\n---\nDrag to move; right click or long press for options';
        trigger.setAttribute('aria-label', 'Active World Info; drag to move');
        trigger.setAttribute('aria-controls', 'stwii--active-panel');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', ()=>{
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            togglePanel(panel);
        });
        trigger.addEventListener('contextmenu', (evt)=>{
            evt.preventDefault();
            if (Date.now() < ignoreContextMenuUntil) return;
            if (dragState && !dragState.moved) {
                clearTimeout(longPressTimer);
                dragState.longPressed = true;
                suppressClick = true;
                ignoreContextMenuUntil = Date.now() + 1000;
            }
            togglePanel(configPanel);
        });
        document.body.append(trigger);
    }
    const panel = document.createElement('div'); {
        panel.id = 'stwii--active-panel';
        panel.classList.add('stwii--panel');
        const toolbar = document.createElement('div');
        toolbar.classList.add('stwii--toolbar');
        const heading = document.createElement('span');
        heading.textContent = 'Active World Info';
        toolbar.append(heading);
        const options = document.createElement('button');
        options.type = 'button';
        options.classList.add('stwii--options', 'fa-solid', 'fa-gear');
        options.title = 'Options';
        options.setAttribute('aria-label', 'World Info options');
        options.addEventListener('click', ()=>togglePanel(configPanel));
        toolbar.append(options);
        panel.append(toolbar);
        document.body.append(panel);
    }
    const panelContent = document.createElement('div'); {
        panelContent.classList.add('stwii--panelContent');
        panelContent.textContent = '?';
        panel.append(panelContent);
    }
    const configPanel = document.createElement('div'); {
        configPanel.classList.add('stwii--panel');
        configPanel.setAttribute('aria-label', 'World Info options');
        document.body.append(configPanel);
    }

    const togglePanel = (target)=>{
        const shouldOpen = !target.classList.contains('stwii--isActive');
        panel.classList.remove('stwii--isActive');
        configPanel.classList.remove('stwii--isActive');
        if (shouldOpen) {
            target.classList.add('stwii--isActive');
            positionPanel(target);
        }
        trigger.setAttribute('aria-expanded', String(panel.classList.contains('stwii--isActive')));
    };

    const mobileQuery = window.matchMedia('(max-width: 800px)');
    const margin = 8;
    const clamp = (value, min, max)=>Math.min(Math.max(value, min), Math.max(min, max));
    const viewport = ()=>({ width: window.innerWidth, height: window.innerHeight });
    const positionKey = ()=>mobileQuery.matches ? 'mobile' : 'desktop';
    const setTriggerPosition = (left, top)=>{
        const { width, height } = viewport();
        trigger.style.left = `${clamp(left, margin, width - trigger.offsetWidth - margin)}px`;
        trigger.style.top = `${clamp(top, margin, height - trigger.offsetHeight - margin)}px`;
        trigger.style.right = 'auto';
        trigger.style.bottom = 'auto';
        for (const openPanel of [panel, configPanel]) positionPanel(openPanel);
    };
    const restoreTriggerPosition = ()=>{
        const { width, height } = viewport();
        const saved = extension_settings.worldInfoInfo?.triggerPositions?.[positionKey()];
        const availableWidth = Math.max(0, width - trigger.offsetWidth - margin * 2);
        const availableHeight = Math.max(0, height - trigger.offsetHeight - margin * 2);
        const x = Number.isFinite(saved?.x) ? saved.x : (mobileQuery.matches ? 1 : 0);
        const y = Number.isFinite(saved?.y) ? saved.y : (mobileQuery.matches ? 0.42 : 1);
        setTriggerPosition(margin + clamp(x, 0, 1) * availableWidth, margin + clamp(y, 0, 1) * availableHeight);
    };
    const saveTriggerPosition = ()=>{
        const { width, height } = viewport();
        const settings = extension_settings.worldInfoInfo ??= {};
        const positions = settings.triggerPositions ??= {};
        positions[positionKey()] = {
            x: clamp((trigger.offsetLeft - margin) / Math.max(1, width - trigger.offsetWidth - margin * 2), 0, 1),
            y: clamp((trigger.offsetTop - margin) / Math.max(1, height - trigger.offsetHeight - margin * 2), 0, 1),
        };
        saveSettingsDebounced();
    };
    function positionPanel(target) {
        if (!target.classList.contains('stwii--isActive')) return;
        const { width, height } = viewport();
        const button = trigger.getBoundingClientRect();
        const gap = 10;
        const panelWidth = target.offsetWidth;
        const panelHeight = target.offsetHeight;
        const right = button.right + gap;
        const left = button.left - panelWidth - gap;
        const panelLeft = right + panelWidth <= width - margin ? right : left >= margin ? left : button.left;
        target.style.left = `${clamp(panelLeft, margin, width - panelWidth - margin)}px`;
        target.style.top = `${clamp(button.top, margin, height - panelHeight - margin)}px`;
    }

    let dragState = null;
    let suppressClick = false;
    let ignoreContextMenuUntil = 0;
    let longPressTimer;
    trigger.addEventListener('pointerdown', (evt)=>{
        if (evt.button !== 0 || !evt.isPrimary) return;
        const bounds = trigger.getBoundingClientRect();
        dragState = { id: evt.pointerId, x: evt.clientX, y: evt.clientY, left: bounds.left, top: bounds.top, moved: false, longPressed: false };
        trigger.setPointerCapture(evt.pointerId);
        longPressTimer = setTimeout(()=>{
            if (!dragState || dragState.moved) return;
            dragState.longPressed = true;
            suppressClick = true;
            ignoreContextMenuUntil = Date.now() + 1000;
            togglePanel(configPanel);
        }, 650);
    });
    trigger.addEventListener('pointermove', (evt)=>{
        if (!dragState || dragState.id !== evt.pointerId || dragState.longPressed) return;
        const dx = evt.clientX - dragState.x;
        const dy = evt.clientY - dragState.y;
        if (!dragState.moved && Math.hypot(dx, dy) < 6) return;
        dragState.moved = true;
        clearTimeout(longPressTimer);
        evt.preventDefault();
        setTriggerPosition(dragState.left + dx, dragState.top + dy);
    });
    const endDrag = (evt)=>{
        if (!dragState || dragState.id !== evt.pointerId) return;
        clearTimeout(longPressTimer);
        if (dragState.moved) {
            saveTriggerPosition();
            suppressClick = true;
        }
        if (suppressClick) setTimeout(()=>suppressClick = false, 500);
        if (trigger.hasPointerCapture(evt.pointerId)) trigger.releasePointerCapture(evt.pointerId);
        dragState = null;
    };
    trigger.addEventListener('pointerup', endDrag);
    trigger.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', restoreTriggerPosition);
    mobileQuery.addEventListener('change', restoreTriggerPosition);
    restoreTriggerPosition();
        const rowGroup = document.createElement('label'); {
            rowGroup.classList.add('stwii--configRow');
            rowGroup.title = 'Group entries by World Info book';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.group ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.group = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                rowGroup.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Group by book';
                rowGroup.append(lbl);
            }
            configPanel.append(rowGroup);
        }
        const orderRow = document.createElement('label'); {
            orderRow.classList.add('stwii--configRow');
            orderRow.title = 'Show in insertion depth / order instead of alphabetically';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.order ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.order = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                orderRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Show in order';
                orderRow.append(lbl);
            }
            configPanel.append(orderRow);
        }
        const mesRow = document.createElement('label'); {
            mesRow.classList.add('stwii--configRow');
            mesRow.title = 'Indicate message history (only when ungrouped and shown in order)';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.mes ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.mes = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                mesRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Show messages';
                mesRow.append(lbl);
            }
            configPanel.append(mesRow);
        }

    let entries = [];

    let count = -1;
    const updateBadge = async(newEntries)=>{
        if (count != newEntries.length) {
            if (newEntries.length == 0) {
                trigger.classList.add('stwii--badge-out');
                await delay(510);
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                trigger.classList.remove('stwii--badge-out');
            } else if (count == 0) {
                trigger.classList.add('stwii--badge-in');
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                await delay(510);
                trigger.classList.remove('stwii--badge-in');
            } else {
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                trigger.classList.add('stwii--badge-bounce');
                await delay(1010);
                trigger.classList.remove('stwii--badge-bounce');
            }
            count = newEntries.length;
        } else if (new Set(newEntries).difference(new Set(entries)).size > 0) {
            trigger.classList.add('stwii--badge-bounce');
            await delay(1010);
            trigger.classList.remove('stwii--badge-bounce');
        }
        entries = newEntries;
    };
    let currentEntryList = [];
    let currentChat = [];
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async(entryList)=>{
        panelContent.textContent = 'Updating...';
        updateBadge(entryList.map(it=>`${it.world}§§§${it.uid}`));
        for (const entry of entryList) {
            entry.type = 'wi';
            entry.sticky = parseInt(/**@type {string}*/(await SlashCommandParser.commands['wi-get-timed-effect'].callback(
                {
                    effect: 'sticky',
                    format: 'number',
                    file: `${entry.world}`,
                    _scope: null,
                    _abortController: null,
                },
                entry.uid,
            )));
        }
        currentEntryList = [...entryList];
        updatePanel(entryList, true);
    });


    const updatePanel = (entryList, newChat = false)=>{
        const isGrouped = extension_settings.worldInfoInfo?.group ?? true;
        const isOrdered = extension_settings.worldInfoInfo?.order ?? true;
        const isMes = extension_settings.worldInfoInfo?.mes ?? true;
        panelContent.replaceChildren();
        let grouped;
        if (isGrouped) {
            grouped = Object.groupBy(entryList, (it,idx)=>it.world);
        } else {
            grouped = {
                'WI Entries': [...entryList],
            };
        }
        const depthPos = [world_info_position.ANBottom, world_info_position.ANTop, world_info_position.atDepth];
        for (const [world, entries] of Object.entries(grouped)) {
            for (const e of entries) {
                e.depth = e.position == world_info_position.atDepth ? e.depth : (chat_metadata[metadata_keys.depth] + (e.position == world_info_position.ANTop ? 0.1 : 0));
            }
            const w = document.createElement('div'); {
                w.classList.add('stwii--world');
                w.textContent = world;
                panelContent.append(w);
                entries.sort((a,b)=>{
                    if (isOrdered) {
                        // order by strategy / depth / order
                        if (!depthPos.includes(a.position) && !depthPos.includes(b.position)) return a.position - b.position;
                        if (depthPos.includes(a.position) && !depthPos.includes(b.position)) return 1;
                        if (!depthPos.includes(a.position) && depthPos.includes(b.position)) return -1;
                        if ((a.depth ?? Number.MAX_SAFE_INTEGER) < (b.depth ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if ((a.depth ?? Number.MAX_SAFE_INTEGER) > (b.depth ?? Number.MAX_SAFE_INTEGER)) return -1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) > (b.order ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) < (b.order ?? Number.MAX_SAFE_INTEGER)) return -1;
                        return (a.comment ?? a.key.join(', ')).toLowerCase().localeCompare((b.comment ?? b.key.join(', ')).toLowerCase());
                    } else {
                        // order alphabetically
                        return (a.comment?.length ? a.comment : a.key.join(', '))
                            .toLowerCase()
                            .localeCompare(b.comment?.length ? b.comment : b.key.join(', '))
                        ;
                    }
                });
                if (!isGrouped && isOrdered && isMes) {
                    const an = chat_metadata[metadata_keys.prompt];
                    const ad = chat_metadata[metadata_keys.depth];
                    if (an?.length) {
                        const idx = entries.findIndex(e=>depthPos.includes(e.position) && e.depth <= ad);
                        entries.splice(idx, 0, {
                            type: 'note',
                            position: world_info_position.ANBottom,
                            depth: ad,
                            text: an,
                        });
                    }
                    if (newChat) {
                        currentChat = [...chat];
                        if (generationType == 'swipe') currentChat.pop();
                    }
                    const segmenter = new Intl.Segmenter('en', { granularity:'sentence' });
                    let currentDepth = currentChat.length - 1;
                    let isDumped = false;
                    for (let i = entries.length - 1; i >= -1; i--) {
                        if (i < 0 && currentDepth < 0) continue;
                        if (isDumped) continue;
                        if ((i < 0 && currentDepth >= 0) || !depthPos.includes(entries[i].position)) {
                            // anything not @D is considered as "before chat"
                            isDumped = true;
                            const depth = -1;
                            const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                            const text = mesList
                                .map(it=>it.mes)
                                .map(it=>it
                                    .replace(/```.+```/gs, '')
                                    .replace(/<[^>]+?>/g, '')
                                    .trim()
                                    ,
                                )
                                .filter(it=>it.length)
                                .join('\n')
                            ;
                            const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                            entries.splice(i + 1, 0, {
                                type: 'mes',
                                count: mesList.length,
                                from: depth + 1,
                                to: currentDepth,
                                first: sentences.at(0),
                                last: sentences.length > 1 ? sentences.at(-1) : null,
                            });
                            currentDepth = -1;
                            continue;
                        }
                        let depth = Math.max(-1, currentChat.length - entries[i].depth - 1);
                        if (depth >= currentDepth) continue;
                        depth = Math.ceil(depth);
                        if (depth == currentDepth) continue;
                        const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                        const text = mesList
                            .map(it=>it.mes)
                            .map(it=>it
                                .replace(/```.+```/gs, '')
                                .replace(/<[^>]+?>/g, '')
                                .trim()
                                ,
                            )
                            .filter(it=>it.length)
                            .join('\n')
                        ;
                        const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                        entries.splice(i + 1, 0, {
                            type: 'mes',
                            count: mesList.length,
                            from: depth + 1,
                            to: currentDepth,
                            first: sentences.at(0),
                            last: sentences.length > 1 ? sentences.at(-1) : null,
                        });
                        currentDepth = depth;
                    }
                }
                for (const entry of entries) {
                    const e = document.createElement('div'); {
                        e.classList.add('stwii--entry');
                        const wipChar = [world_info_position.before, world_info_position.after];
                        const wipEx = [world_info_position.EMTop, world_info_position.EMBottom];
                        // not needed after all?
                        if (false && [...wipChar, ...wipEx].includes(entry.position)) {
                            if (main_api == 'openai') {
                                const pm = promptManager.getPromptCollection().collection;
                                if (wipChar.includes(entry.position) && !pm.find(it=>it.identifier == 'charDescription')) {
                                    e.classList.add('stwii--isBroken');
                                    e.title = '⚠️ Not sent because position anchor is missing (Char Description)!\n';
                                } else if (wipEx.includes(entry.position) && !pm.find(it=>it.identifier == 'dialogueExamples')) {
                                    e.classList.add('stwii--isBroken');
                                    e.title = '⚠️ Not sent because position anchor is missing (Example Messages)!\n';
                                }
                            }
                        } else {
                            e.title = '';
                        }
                        if (entry.type == 'mes') e.classList.add('stwii--messages');
                        if (entry.type == 'note') e.classList.add('stwii--note');
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            if (entry.type == 'wi') {
                                strat.textContent = strategy[getStrategy(entry)];
                            } else if (entry.type == 'mes') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-comments');
                                strat.setAttribute('data-stwii--count', entry.count.toString());
                            } else if (entry.type == 'note') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-note-sticky');
                            }
                            e.append(strat);
                        }
                        const title = document.createElement('div'); {
                            title.classList.add('stwii--title');
                            if (entry.type == 'wi') {
                                title.textContent = entry.comment?.length ? entry.comment : entry.key.join(', ');
                                e.title += `[${entry.world}] ${entry.comment?.length ? entry.comment : entry.key.join(', ')}\n---\n${entry.content}`;
                            } else if (entry.type == 'mes') {
                                const first = document.createElement('div'); {
                                    first.classList.add('stwii--first');
                                    first.textContent = entry.first;
                                    title.append(first);
                                }
                                if (entry.last) {
                                    e.title = `Messages #${entry.from}-${entry.to}\n---\n${entry.first}\n...\n${entry.last}`;
                                    const sep = document.createElement('div'); {
                                        sep.classList.add('stwii--sep');
                                        sep.textContent = '...';
                                        title.append(sep);
                                    }
                                    const last = document.createElement('div'); {
                                        last.classList.add('stwii--last');
                                        last.textContent = entry.last;
                                        title.append(last);
                                    }
                                } else {
                                    e.title = `Message #${entry.from}\n---\n${entry.first}`;
                                }
                            } else if (entry.type == 'note') {
                                title.textContent = 'Author\'s Note';
                                e.title = `Author's Note\n---\n${entry.text}`;
                            }
                            e.append(title);
                        }
                        const sticky = document.createElement('div'); {
                            sticky.classList.add('stwii--sticky');
                            sticky.textContent = entry.sticky ? `📌 ${entry.sticky}` : '';
                            sticky.title = `Sticky for ${entry.sticky} more rounds`;
                            e.append(sticky);
                        }
                        panelContent.append(e);
                    }
                }
            }
        }
        positionPanel(panel);
    };

    //! HACK: no event when no entries are activated, only a debug message
    const original_debug = console.debug;
    console.debug = function(...args) {
        const triggers = [
            '[WI] Found 0 world lore entries. Sorted by strategy',
            '[WI] Adding 0 entries to prompt',
        ];
        if (triggers.includes(args[0])) {
            panelContent.textContent = 'No active entries';
            updateBadge([]);
            currentEntryList = [];
        }
        return original_debug.bind(console)(...args);
    };
    const original_log = console.log;
    console.log = function(...args) {
        const triggers = [
            '[WI] Found 0 world lore entries. Sorted by strategy',
            '[WI] Adding 0 entries to prompt',
        ];
        if (triggers.includes(args[0])) {
            panelContent.textContent = 'No active entries';
            updateBadge([]);
            currentEntryList = [];
        }
        return original_log.bind(console)(...args);
    };

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'wi-triggered',
        callback: (args, value)=>{
            return JSON.stringify(currentEntryList);
        },
        returns: 'list of triggered WI entries',
        helpString: 'Get the list of World Info entries triggered on the last generation.',
    }));
};
init();
