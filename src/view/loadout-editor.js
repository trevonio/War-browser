import { availablePresets, configurableStations, resolveLoadout, stores, storeWeight } from '../sim/loadouts.js';
import { AttachedStores } from './loadout-visual.js';

export class LoadoutEditor {
  constructor(ui, hangar, preview, models, book, apply, signal) {
    this.ui = ui;
    this.hangar = hangar;
    this.preview = preview;
    this.models = models;
    this.book = book;
    this.apply = apply;
    this.signal = signal;
    this.dialog = ui['loadout-dialog'];
    const on = (id, type, run) => ui[id].addEventListener(type, run, { signal });
    on('close-loadouts', 'click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.detach(), { signal });
    on('loadout-preset', 'change', () => {
      const name = ui['loadout-preset'].value;
      if (!name) return;
      this.draft = { ...this.presets[name] };
      ui['loadout-name'].value = '';
      ui['loadout-saved'].value = '';
      this.refresh();
    });
    on('loadout-saved', 'change', () => {
      const item = this.selectedSave();
      if (!item) return;
      this.draft = { ...item.assignment };
      ui['loadout-name'].value = item.name;
      ui['loadout-preset'].value = '';
      this.refresh();
    });
    on('loadout-save', 'click', () => this.save());
    on('loadout-delete', 'click', () => this.remove());
    on('loadout-apply', 'click', () => this.commit({ ...this.draft }));
    on('loadout-default', 'click', () => this.commit(null));
    on('loadout-rotate', 'click', () => {
      this.angle += 0.48;
      this.draw();
    });
    signal.addEventListener('abort', () => this.detach(), { once: true });
  }

  async open(spec) {
    if (this.dialog.open) return;
    this.spec = spec;
    this.entry = this.book.entry(spec);
    this.presets = availablePresets(spec);
    this.draft = { ...(this.entry.active ?? this.presets['Air Superiority']) };
    this.angle = 0.72;
    this.ui['loadout-title'].textContent = `${spec.shortName} loadout`;
    this.ui['loadout-name'].value = '';
    this.setOptions('loadout-preset', 'Choose a preset', Object.keys(this.presets));
    this.savedOptions();
    this.buildStations();
    this.refresh();
    if (this.entry.invalid) this.notice('Some saved entries could not be restored with the current station definitions.');
    this.dialog.showModal();
    try {
      const assets = await this.hangar.load(spec.id);
      if (!this.dialog.open || this.spec !== spec || this.signal.aborted) return;
      this.detach();
      this.aircraft = this.hangar.instantiate(assets);
      this.mounts = new AttachedStores(this.aircraft, this.models);
      this.draw();
    } catch {
      this.notice('Aircraft preview unavailable. Loadout controls are available.');
    }
  }

  setOptions(id, placeholder, options) {
    const select = this.ui[id];
    select.replaceChildren(new Option(placeholder, ''), ...options.map((name) => new Option(name, name)));
  }

  savedOptions(selected) {
    this.setOptions('loadout-saved', 'Choose a saved loadout', this.entry.saved.map(({ name }) => name));
    if (selected) this.ui['loadout-saved'].value = selected;
    this.ui['loadout-delete'].disabled = !this.selectedSave();
  }

  buildStations() {
    this.rows = new Map();
    const fragment = document.createDocumentFragment();
    this.points = configurableStations(this.spec);
    for (const point of this.points) {
      const row = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = point.label;
      const select = document.createElement('select');
      select.append(new Option('Empty', ''));
      for (const id of point.allowed) select.add(new Option(stores[id].label, id));
      select.addEventListener('focus', () => this.info(point, select.value), { signal: this.signal });
      select.addEventListener('change', () => {
        if (select.value) this.draft[point.name] = select.value;
        else delete this.draft[point.name];
        this.ui['loadout-preset'].value = '';
        this.refresh();
        this.info(point, select.value);
      }, { signal: this.signal });
      row.append(text, select);
      this.rows.set(point.name, select);
      fragment.append(row);
    }
    this.ui['loadout-stations'].replaceChildren(fragment);
  }

  info(point, id) {
    const output = this.ui['loadout-store-info'];
    if (!id) {
      output.textContent = `${point.label} · ${point.limit} kg maximum · ${point.allowed.map((value) => stores[value].category).join(', ')}`;
      return;
    }
    const store = stores[id];
    const stations = this.points.filter(({ allowed }) => allowed.includes(id)).map(({ label }) => label);
    output.textContent = `${store.label} · ${store.category} · ${store.quantity} · ${storeWeight(store)} kg. ${store.detail} Stations include ${stations.join(', ')}.`;
  }

  refresh() {
    this.candidate = resolveLoadout(this.spec, this.draft);
    for (const [name, field] of this.rows) field.value = this.draft[name] ?? '';
    const { mass, drag, errors } = this.candidate;
    const totals = this.ui['loadout-totals'];
    totals.textContent = `${Math.round(mass)} kg payload · +${drag.toFixed(4)} drag coefficient`;
    this.ui['loadout-ammo'].textContent = `${this.spec.cannon.capacity} cannon rounds · up to ${this.spec.loadouts.intercept.flare} flares / ${this.spec.loadouts.intercept.chaff} chaff`;
    this.ui['loadout-save'].disabled = this.ui['loadout-apply'].disabled = Boolean(errors.length);
    this.ui['loadout-delete'].disabled = !this.selectedSave();
    this.notice(errors.join(' '));
    this.draw();
  }

  draw() {
    if (!this.aircraft) return;
    this.mounts.reset(this.candidate.stations);
    this.mounts.update({ stores: true, customStores: true, damage: { condition: () => 1 } });
    this.ui['loadout-preview'].src = this.preview.draw({ own: this.aircraft }, this.angle, 640, 260, this.spec.previewDistance ?? 19);
  }

  selectedSave() {
    return this.entry.saved.find(({ name }) => name === this.ui['loadout-saved'].value);
  }

  save() {
    const name = this.ui['loadout-name'].value.trim();
    if (!name) return this.notice('Enter a name for this loadout.');
    if (this.candidate.errors.length) return;
    const current = this.selectedSave();
    const existing = this.entry.saved.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing && existing !== current) return this.notice('That name is already used. Choose it from Saved to edit it.');
    const item = { name, assignment: { ...this.draft } };
    if (current) this.entry.saved[this.entry.saved.indexOf(current)] = item;
    else this.entry.saved.push(item);
    this.savedOptions(name);
    this.notice(this.book.persist() ? 'Loadout saved.' : 'Loadout saved for this session.');
  }

  remove() {
    const item = this.selectedSave();
    if (!item) return;
    this.entry.saved.splice(this.entry.saved.indexOf(item), 1);
    this.ui['loadout-name'].value = '';
    this.savedOptions();
    this.notice(this.book.persist() ? 'Saved loadout deleted.' : 'Loadout removed for this session.');
  }

  commit(assignment) {
    if (assignment && this.candidate.errors.length) return;
    this.entry.active = assignment;
    this.book.persist();
    this.dialog.close();
    this.apply();
  }

  detach() {
    this.mounts?.dispose();
    this.mounts = null;
    this.aircraft = null;
  }

  notice(message) { this.ui['loadout-status'].textContent = message; }
}
