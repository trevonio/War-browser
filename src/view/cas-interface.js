import { CasMap } from './cas-map.js';
import { groundVehicles } from '../sim/ground/vehicles.js';

export class CasInterface {
  constructor(ui, world, roads, select, signal) {
    this.ui = ui;
    this.roads = roads;
    this.preview = new CasMap(ui['cas-preview'], world);
    this.map = new CasMap(ui['cas-map-canvas'], world, true);
    this.map.onSelect = select;
    const onClick = (id, handler) => ui[id].addEventListener('click', handler, { signal });
    onClick('cas-map-zoom-in', () => this.map.changeZoom(.25));
    onClick('cas-map-zoom-out', () => this.map.changeZoom(-.25));
    onClick('cas-map-objective', () => select('objective'));
    for (const id of ['cas-map-requests', 'cas-map-contacts']) {
      onClick(id, ({ target }) => {
        const row = target.closest('button[data-contact]');
        if (row) select(row.dataset.contact, row.dataset.action === 'accept');
      });
    }
  }

  briefing(plan, supported, text) {
    text('cas-mission-title', plan.label);
    text('cas-description', plan.description);
    text('cas-primary', plan.primary);
    text('cas-secondary', plan.secondary);
    const counts = new Map();
    for (const unit of plan.definitions) if (unit.faction === 'friendly') counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
    text('cas-friendly', [...counts].map(([type, count]) => `${count} × ${groundVehicles[type].name}`).join(' · '));
    text('cas-intelligence', plan.intel);
    text('cas-recommended', plan.loadout ?? 'Ground Attack');
    text('cas-aircraft-status', supported ? '' : 'Choose the F-16C or A-10C to launch. The F-15C is configured for air combat.');
    this.preview.show(plan, this.roads);
  }

  radio(director, text) {
    this.ui['cas-radio'].hidden = !director;
    if (!director) return;
    if (this.lastDirector === director && this.lastRevision === director.revision) return;
    this.lastDirector = director;
    this.lastRevision = director.revision;
    const open = director.requests.filter((item) => item.state === 'active').length;
    const radio = director.history.at(-1);
    text('cas-call-count', open ? `${open} support ${open === 1 ? 'call' : 'calls'}` : '');
    text('cas-radio-message', `${radio.sender} · ${radio.message}`);
  }

  battle(battle, flight, text, pod = null) {
    const director = battle.director;
    const { plan, primary, secondary } = director;
    const friendlies = battle.targets.filter((unit) => unit.faction === 'friendly' && unit.active && !unit.arrived);
    const requests = director.requests.filter((request) => request.state === 'active');
    const contacts = [...director.contacts.values()].reverse();
    this.map.show(plan, this.roads, { flight, time: battle.time, friendlies, contacts, requests, selected: director.selected,
      designation: pod?.hasCoordinates ? pod.designation : null, coordinates: pod?.hasCoordinates ? pod.coordinates : null });
    this.ui['cas-map-fix'].hidden = !pod?.hasCoordinates;
    if (pod?.hasCoordinates) text('cas-map-fix', `Saved fix · ${Math.round(pod.coordinates.x)}, ${Math.round(pod.coordinates.z)} · ${pod.designation.valid ? pod.designation.confidence : 'last known'}`);
    text('cas-map-objective', `${primary.label} · ${primary.state}`);
    text('cas-map-secondary', `${secondary.label} · ${secondary.state}`);
    this.rows('cas-map-requests', requests.map((item) => ({
      id: item.id, label: `${item.urgency} · ${item.classification} · ${Math.max(0, Math.ceil(item.deadline - battle.time))} s`,
      accept: !item.accepted, selected: director.selected === item.id,
    })), 'No active calls.');
    this.rows('cas-map-contacts', [
      ...contacts.map((item) => {
        const status = battle.time - item.time > 6 ? 'Last known' : item.confidence;
        const distance = (flight.position.distanceTo(item.position) / 1000).toFixed(1);
        return { id: item.id, label: `${item.faction === 'opposing' ? 'Hostile' : item.faction} · ${item.classification} · ${distance} km · ${status}` };
      }),
      ...friendlies.map((unit) => ({ id: unit.id, label: `Friendly · ${unit.classification} · ${unit.disabled ? 'immobilized' : 'operational'}` })),
    ].map((row) => ({ ...row, selected: director.selected === row.id })), 'No reported contacts.');
    const selected = director.designation(battle);
    const friendly = friendlies.find((unit) => unit.id === director.selected);
    text('cas-map-selection', selected ? `${selected.label} · ${selected.approximate ? 'Reported area' : 'Known objective'} · ${Math.round(flight.position.distanceTo(selected.position))} m`
      : friendly ? `Friendly ${friendly.classification.toLowerCase()} · ${Math.round(flight.position.distanceTo(friendly.position))} m` : '');
    const items = director.history.slice(-5).reverse().map(({ sender, message }) => {
      const item = document.createElement('li');
      item.textContent = `${sender} · ${message}`;
      return item;
    });
    this.ui['cas-map-radio'].replaceChildren(...items);
  }

  rows(id, entries, empty) {
    const container = this.ui[id];
    const focus = container.contains(document.activeElement) ? document.activeElement.dataset.contact : null;
    const rows = entries.map(({ id, label, accept, selected }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.contact = id;
      if (accept) button.dataset.action = 'accept';
      button.textContent = accept ? `Accept ${label}` : label;
      button.setAttribute('aria-pressed', String(Boolean(selected)));
      return button;
    });
    container.replaceChildren(...(rows.length ? rows : [empty]));
    if (focus) rows.find((row) => row.dataset.contact === focus)?.focus();
  }
}
