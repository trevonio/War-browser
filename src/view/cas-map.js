const area = { left: -1380, top: -385, width: 2450, depth: 3650 };
const palette = { friendly: '#91e0cb', opposing: '#f5a48d', neutral: '#e0d7aa' };

export class CasMap {
  constructor(canvas, world, interactive = false) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.terrain = document.createElement('canvas');
    this.terrain.width = 144;
    this.terrain.height = 160;
    this.zoom = 1;
    this.x = this.y = 0;
    this.markers = [];
    const context = this.terrain.getContext('2d');
    const image = context.createImageData(this.terrain.width, this.terrain.height);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const height = world.surfaceAt(area.left + x / image.width * area.width, area.top - y / image.height * area.depth);
      const elevation = Math.min(35, Math.floor(height / 14) * 3);
      image.data.set(height > 0 ? [33 + elevation, 54 + elevation, 50 + elevation, 255]
        : [25, 53, 66, 255], (y * image.width + x) * 4);
    }
    context.putImageData(image, 0, 0);
    if (!interactive) return;
    let drag = null;
    const pointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height];
    };
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.changeZoom(-Math.sign(event.deltaY) * .25);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { start: pointer(event), x: this.x, y: this.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const [x, y] = pointer(event);
      const dx = x - drag.start[0], dy = y - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      this.x = drag.x + dx;
      this.y = drag.y + dy;
      this.pan(0, 0);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!drag?.moved) {
        const [x, y] = pointer(event);
        const marker = this.markers.findLast((item) => Math.hypot(x - item.x, y - item.y) < 14);
        if (marker) this.onSelect?.(marker.id);
      }
      drag = null;
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('keydown', (event) => {
      const moves = { ArrowLeft: [26, 0], ArrowRight: [-26, 0], ArrowUp: [0, 26], ArrowDown: [0, -26] };
      if (!moves[event.key] && !['+', '=', '-'].includes(event.key)) return;
      event.preventDefault();
      if (moves[event.key]) this.pan(...moves[event.key]);
      else this.changeZoom(event.key === '-' ? -.25 : .25);
    });
  }

  changeZoom(amount) {
    this.zoom = Math.min(3.5, Math.max(1, this.zoom + amount));
    this.pan(0, 0);
  }

  pan(dx, dy) {
    const range = (this.zoom - 1) / 2;
    this.x = Math.max(-this.canvas.width * range, Math.min(this.canvas.width * range, this.x + dx));
    this.y = Math.max(-this.canvas.height * range, Math.min(this.canvas.height * range, this.y + dy));
    this.draw();
  }

  project(x, z) {
    const { width, height } = this.canvas;
    return [width * (.5 + ((x - area.left) / area.width - .5) * this.zoom) + this.x,
      height * (.5 + ((area.top - z) / area.depth - .5) * this.zoom) + this.y];
  }

  show(plan, roads, state = null) {
    this.plan = plan;
    this.roads = roads;
    this.state = state;
    this.draw();
  }

  draw() {
    const { context: ctx, canvas, zoom, plan, roads, state } = this;
    if (!plan) return;
    const { width, height } = canvas;
    this.markers.length = 0;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.terrain, (1 - zoom) * width / 2 + this.x, (1 - zoom) * height / 2 + this.y, width * zoom, height * zoom);
    ctx.strokeStyle = '#d6e1c71d';
    ctx.lineWidth = 1;
    for (let x = -1200; x < 1060; x += 250) this.line([this.project(x, area.top), this.project(x, area.top - area.depth)]);
    for (let z = -750; z > -4050; z -= 250) this.line([this.project(area.left, z), this.project(area.left + area.width, z)]);
    ctx.strokeStyle = '#a5a69784';
    for (const [a, b] of roads.edges) this.line([this.project(...roads.points[a]), this.project(...roads.points[b])]);
    if (plan.road.length && plan.targets.length) {
      ctx.strokeStyle = plan.key === 'protection' ? palette.friendly : '#ddc593';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      this.line(plan.road.map((point) => this.project(...point)));
      ctx.setLineDash([]);
    }
    const zone = plan.objective;
    this.marker('objective', zone.x, zone.z, '#f7dd9b', zone.label, 'objective', state?.selected === 'objective');
    if (!state) {
      for (const unit of plan.definitions.filter((unit) => unit.faction === 'friendly')) {
        this.marker(unit.id, unit.x, unit.z, palette.friendly, '', 'unit');
      }
      return;
    }
    for (const unit of state.friendlies) {
      this.marker(unit.id, unit.position.x, unit.position.z, palette.friendly, '', 'unit', state.selected === unit.id);
    }
    for (const contact of state.contacts) {
      const stale = state.time - contact.time > 6;
      this.marker(contact.id, contact.position.x, contact.position.z, palette[contact.faction] ?? '#ddd',
        '', stale ? 'last seen' : contact.confidence, state.selected === contact.id);
    }
    for (const request of state.requests) {
      this.marker(request.id, request.position.x, request.position.z, '#f9ca76', '', 'request', state.selected === request.id);
    }
    if (state.designation) {
      const { position: mark, valid } = state.designation;
      this.marker('pod-designation', mark.x, mark.z, '#a9dbfb', valid ? 'Pod designation' : 'Last fix', valid ? 'objective' : 'last seen');
      const fix = state.coordinates;
      if (fix.distanceToSquared(mark) > 20 ** 2) this.marker('pod-fix', fix.x, fix.z, '#b8d3ed', 'Saved coordinates', 'objective');
    }
    const { position, heading } = state.flight;
    const [x, y] = this.project(position.x, position.z);
    ctx.save();
    ctx.translate(Math.max(12, Math.min(x, width - 12)), Math.max(12, Math.min(y, height - 12)));
    ctx.rotate(-heading * Math.PI / 180);
    ctx.fillStyle = '#e9f4fa';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(7, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  marker(id, worldX, worldZ, color, label, shape, selected = false) {
    const [x, y] = this.project(worldX, worldZ);
    this.markers.push({ id, x, y });
    const ctx = this.context;
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.setLineDash(shape === 'last seen' ? [2, 2] : shape === 'reported' ? [4, 3] : []);
    ctx.beginPath();
    if (shape === 'objective' || shape === 'request') ctx.arc(x, y, shape === 'objective' ? 10 : 9, 0, Math.PI * 2);
    else ctx.rect(x - 4, y - 4, 8, 8);
    if (shape === 'unit' || shape === 'confirmed') ctx.fill();
    else ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.font = '600 12px monospace';
      ctx.fillText(label, x + 14, y - 10);
    }
  }

  line(points) {
    this.context.beginPath();
    for (const [index, [x, y]] of points.entries()) {
      if (index) this.context.lineTo(x, y);
      else this.context.moveTo(x, y);
    }
    this.context.stroke();
  }
}
